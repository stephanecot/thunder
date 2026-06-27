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

const isFileRef = (ref) => /[\/.]/.test(String(ref)) && !/^(PR|#|https?:)/i.test(String(ref));
const filePart = (ref) => String(ref).replace(/:\d+(-\d+)?$/, '');

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
      const recorded = eh[rel];
      if (recorded && shortHash(readFileSync(abs, 'utf8')) !== recorded) {
        out.push({ type: 'evidence-stale', id: d.id, ref: rel });
      }
    }
  }
  return out;
}

/** Hash the current content of each file-like evidence ref (captured at record time). */
export function evidenceHashes(root, evidence = []) {
  const map = {};
  for (const ref of evidence) {
    if (!isFileRef(ref)) continue;
    const rel = filePart(ref);
    const abs = join(root, rel);
    try { if (existsSync(abs)) map[rel] = shortHash(readFileSync(abs, 'utf8')); } catch { /* skip */ }
  }
  return map;
}
