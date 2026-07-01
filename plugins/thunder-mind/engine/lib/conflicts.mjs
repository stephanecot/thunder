import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortHash } from './hash.mjs';
import { ACTIVE_STATUSES } from './decision.mjs';

// Surface latent divergence + drift so two devs' decisions stay coherent:
//  - supersede-active : an active decision supersedes another that is still active (status not flipped)
//  - conflict         : conflicts_with points at a decision that is still active
//  - dangling         : supersedes/conflicts_with points at an unknown id
//  - evidence-stale   : a cited source file changed since the decision was recorded
//  - evidence-missing : a cited source file no longer exists

const filePart = (ref) => String(ref).replace(/:\d+(-\d+)?$/, '');
// A ref is a FILE path only if it looks like one: no whitespace, not a PR/URL/issue ref, and either a
// slash or a letter-led extension. Plain "v2.0" / "RFC 7807.1" must not be flagged evidence-missing.
const isFileRef = (ref) => {
  const s = String(ref);
  if (/\s/.test(s) || /^(PR|#|https?:)/i.test(s)) return false;
  return s.includes('/') || /\.[a-z][a-z0-9]{0,5}$/i.test(filePart(s));
};

/** Content a ref actually cites: the `:N` / `:N-M` line range when present, else the whole file —
 * so an unrelated edit elsewhere in a big file no longer flags the decision as drifted. */
function citedContent(abs, ref) {
  const text = readFileSync(abs, 'utf8');
  const m = String(ref).match(/:(\d+)(?:-(\d+))?$/);
  if (!m) return text;
  const a = Math.max(1, Number(m[1])), b = m[2] ? Number(m[2]) : a;
  return text.split('\n').slice(a - 1, b).join('\n');
}

export function conflicts(model, root) {
  const out = [];
  const active = (id) => { const t = model.byId.get(id); return t && ACTIVE_STATUSES.includes(t.status); };
  for (const d of model.decisions) {
    if (ACTIVE_STATUSES.includes(d.status)) {
      if (d.supersedes) {
        if (!model.byId.has(d.supersedes)) out.push({ type: 'dangling', id: d.id, ref: d.supersedes, field: 'supersedes' });
        else if (active(d.supersedes)) out.push({ type: 'supersede-active', id: d.id, ref: d.supersedes });
      }
      for (const c of (d.conflicts_with || [])) {
        if (!model.byId.has(c)) out.push({ type: 'dangling', id: d.id, ref: c, field: 'conflicts_with' });
        else if (active(c)) out.push({ type: 'conflict', id: d.id, ref: c });
      }
    }
    const eh = d.evidence_hashes || {};
    for (const ref of (d.evidence || [])) {
      if (!isFileRef(ref)) continue;
      const rel = filePart(ref);
      const abs = join(root, rel);
      if (!existsSync(abs)) { out.push({ type: 'evidence-missing', id: d.id, ref: rel }); continue; }
      // new entries are keyed by the FULL ref (range-aware); legacy entries by the bare path (whole file)
      const recorded = eh[ref] != null ? eh[ref] : eh[rel];
      const current = eh[ref] != null ? citedContent(abs, ref) : readFileSync(abs, 'utf8');
      if (recorded && shortHash(current) !== recorded) {
        out.push({ type: 'evidence-stale', id: d.id, ref: String(ref) });
      }
    }
  }
  return out;
}

/** Hash what each file-like evidence ref cites (captured at record time), keyed by the full ref. */
export function evidenceHashes(root, evidence = []) {
  const map = {};
  for (const ref of evidence) {
    if (!isFileRef(ref)) continue;
    const abs = join(root, filePart(ref));
    try { if (existsSync(abs)) map[String(ref)] = shortHash(citedContent(abs, ref)); } catch { /* skip */ }
  }
  return map;
}
