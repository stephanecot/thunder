import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dump } from './yaml.mjs';
import { shortHash } from './hash.mjs';
import { normalize } from './common/ledger.mjs';
import {
  cacheDir, decisionsDir, ensureDir,
  readCache, writeCache, readManifest, writeManifest,
} from './cache.mjs';
import { mkdirSync, readdirSync } from 'node:fs';
import {
  listDecisionFiles, parseDecision, validateDecision, idFromRel, ACTIVE_STATUSES, scopeOf,
} from './decision.mjs';

// Bump when retrieval/emit semantics change → invalidates the Tier-3 answer ledger.
export const ENGINE_VERSION = 'thunder-mind/2';
const ENGINE_HASH = shortHash(ENGINE_VERSION);

// Bounds keep the ALWAYS-INJECTED footprint flat as the corpus grows. They NEVER drop a decision:
// the full catalog (domain-map.yaml) + the inverted index (recall) always cover 100% — a capped view
// just appends a "+N more — recall / domain-map.yaml" pointer.
const CONSTITUTION_MAX = 30;  // cross-cutting invariants injected at SessionStart (global scope; few by nature)
const CARD_MAX = 25;          // active decisions shown in a per-domain card (loaded on demand)

/** Searchable text for one decision (drives both the inverted index and recall scoring). */
function haystack(d) {
  return [d.title, d.domain, d.type, ...(d.tags || []), d.decision, d.rationale, d.context,
    ...(d.consequences || [])].filter(Boolean).join(' ');
}

/** Assemble the in-memory model + inverted index from parsed decisions. */
export function buildModel(decisions) {
  const byId = new Map();
  const terms = new Map();          // id -> string[] (normalized terms)
  const postings = new Map();       // term -> Set(id)
  for (const d of decisions) {
    byId.set(d.id, d);
    const t = normalize(haystack(d)).terms;
    terms.set(d.id, t);
    for (const term of new Set(t)) {
      if (!postings.has(term)) postings.set(term, new Set());
      postings.get(term).add(d.id);
    }
  }
  const df = new Map();
  for (const [term, ids] of postings) df.set(term, ids.size);

  const domains = new Map();
  const byType = {}, byStatus = {};
  for (const d of decisions) {
    const dm = domains.get(d.domain) || { name: d.domain, count: 0, active: 0 };
    dm.count++; if (ACTIVE_STATUSES.includes(d.status)) dm.active++;
    domains.set(d.domain, dm);
    byType[d.type] = (byType[d.type] || 0) + 1;
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  }
  return {
    decisions, byId, terms, postings, df, N: decisions.length,
    domains: [...domains.values()].sort((a, b) => a.name.localeCompare(b.name)),
    byType, byStatus, engineHash: ENGINE_HASH,
  };
}

const active = (d) => ACTIVE_STATUSES.includes(d.status);
const structuring = (d) => (d.type === 'architecture' || d.type === 'convention');
const cardRel = (domain) => `domains/${domain}.card.yaml`;

/**
 * TIER-0 CONSTITUTION — the only thing injected at SessionStart. Bounded by the number of cross-cutting
 * invariants (scope:global, active), NOT by the corpus size. Everything else is on demand: per-domain
 * cards (tier-1) + recall (tier-2). NO decision is lost — domain-map.yaml lists them all, recall reaches all.
 */
function briefOf(model) {
  const invariants = model.decisions.filter((d) => active(d) && scopeOf(d) === 'global')
    .sort((a, b) => (structuring(b) - structuring(a)) || String(b.date).localeCompare(String(a.date)));
  // LEAN entries (id + type + title) keep the always-injected footprint flat; full text is one
  // `card`/`recall` away. id already carries the domain, so we don't repeat it.
  const constitution = invariants.slice(0, CONSTITUTION_MAX)
    .map((d) => ({ id: d.id, type: d.type, title: d.title }));
  return {
    meta: { decisions: model.N, domains: model.domains.length, by_status: model.byStatus },
    // every domain is listed (no loss) with a pointer to its on-demand card
    domains: model.domains.map((d) => ({ name: d.name, active: d.active, count: d.count, card: cardRel(d.name) })),
    constitution,
    ...(invariants.length > CONSTITUTION_MAX ? { constitution_note: `+${invariants.length - CONSTITUTION_MAX} more global invariants — see domain-map.yaml` } : {}),
    how_to_go_deeper: 'Working in a domain → read its `domains/<domain>.card.yaml`. Specific concern → `recall "<keywords>"`. '
      + 'Full catalog of EVERY decision → domain-map.yaml. Nothing here is dropped: recall + domain-map reach 100%.',
  };
}

/** TIER-1 per-domain cards — active decisions of one domain (structuring first), loaded on demand. */
function domainCard(model, dm) {
  const all = model.decisions.filter((d) => d.domain === dm.name && active(d))
    .sort((a, b) => (structuring(b) - structuring(a)) || String(b.date).localeCompare(String(a.date)));
  return {
    card: {
      domain: dm.name, active: dm.active, total: dm.count,
      decisions: all.slice(0, CARD_MAX).map((d) => ({ id: d.id, type: d.type, scope: scopeOf(d), title: d.title, decision: d.decision })),
      ...(all.length > CARD_MAX ? { note: `+${all.length - CARD_MAX} more active in this domain — recall "${dm.name} <keywords>" or grep domain-map.yaml` }
        : { note: `grep domain-map.yaml for superseded/deprecated; recall "<keywords>" for any concern` }),
    },
  };
}

/** Emit the derived index to cache/ (free, deterministic — no model tokens). */
export function emit(root, model) {
  const dir = cacheDir(root);
  ensureDir(dir);

  writeFileSync(join(dir, 'index.yaml'), dump({
    meta: { decisions: model.N, domains: model.domains.length, by_type: model.byType, by_status: model.byStatus,
      drill: 'brief.yaml (tier-0 constitution) · domains/<domain>.card.yaml (tier-1, on demand) · recall "<keywords>" (tier-2) · domain-map.yaml (full catalog)' },
    domains: model.domains,
  }));

  // FULL catalog — EVERY decision, ONE line each (id is the key), so a single grep hit is
  // self-sufficient: id + status + type + scope + title together. The "no loss" backbone.
  const catalog = {};
  for (const d of model.decisions) catalog[d.id] = `${d.status} ${d.type} ${scopeOf(d)} — ${d.title}`;
  writeFileSync(join(dir, 'domain-map.yaml'), dump({
    format: '<id>: "<status> <type> <scope> — <title>"',
    decisions: catalog,
  }));

  // tier-0 constitution (the only thing injected at SessionStart)
  writeFileSync(join(dir, 'brief.yaml'), dump(briefOf(model)));

  // tier-1 per-domain cards (loaded on demand). Prune stale ones so removed domains don't linger.
  const cardsDir = join(dir, 'domains');
  mkdirSync(cardsDir, { recursive: true });
  const wanted = new Set(model.domains.map((d) => `${d.name}.card.yaml`));
  try { for (const f of readdirSync(cardsDir)) if (f.endsWith('.card.yaml') && !wanted.has(f)) rmSync(join(cardsDir, f)); } catch { /* none */ }
  for (const dm of model.domains) writeFileSync(join(cardsDir, `${dm.name}.card.yaml`), dump(domainCard(model, dm)));

  // inverted index, one term per line: {"t":"rls","ids":["auth/...","..."]} — covers ALL decisions (recall reaches 100%)
  const lines = [...model.postings.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, ids]) => JSON.stringify({ t, ids: [...ids].sort() }));
  writeFileSync(join(dir, 'postings.ndjson'), lines.join('\n') + (lines.length ? '\n' : ''));
}

/**
 * Incremental build: parse only changed decision files (by content hash), reuse the rest from
 * cache.ndjson, then (re)derive the whole index. Returns { model, total, parsed, reused, errors }.
 */
export function build(root, { force = false } = {}) {
  const files = listDecisionFiles(root);
  if (!files.length && !existsSync(decisionsDir(root))) {
    return { model: buildModel([]), total: 0, parsed: 0, reused: 0, errors: 0 };
  }
  const prev = readCache(root);
  const prevManifest = readManifest(root);
  const engineBust = force || prevManifest.engineHash !== ENGINE_HASH;

  const next = new Map();
  let parsed = 0, reused = 0, errors = 0;
  const manifestFiles = {};
  for (const rel of files) {
    const text = readFileSync(join(decisionsDir(root), rel), 'utf8');
    const h = shortHash(text);
    manifestFiles[rel] = h;
    const cached = prev.get(rel);
    if (!engineBust && cached && cached.hash === h && cached.d) { next.set(rel, cached); reused++; continue; }
    try {
      const d = parseDecision(text);
      d.id = idFromRel(rel);
      if (!d.domain) d.domain = rel.split('/')[0];
      const v = validateDecision(d);
      next.set(rel, { file: rel, hash: h, d, errors: v.errors, warnings: v.warnings });
      if (v.errors.length) errors++;
      parsed++;
    } catch (e) {
      next.set(rel, { file: rel, hash: h, error: String(e.message) });
      errors++; parsed++;
    }
  }
  writeCache(root, next);
  ensureDir(cacheDir(root));
  writeManifest(root, { engineHash: ENGINE_HASH, files: manifestFiles });

  const decisions = [...next.values()].filter((v) => v.d).map((v) => v.d);
  const model = buildModel(decisions);
  emit(root, model);
  return { model, total: files.length, parsed, reused, errors };
}

export function resetIndex(root) {
  const dir = cacheDir(root);
  for (const f of ['cache.ndjson', 'manifest.json', 'index.yaml', 'domain-map.yaml', 'brief.yaml', 'postings.ndjson']) {
    try { const p = join(dir, f); if (existsSync(p)) rmSync(p); } catch { /* ignore */ }
  }
  try { rmSync(join(dir, 'domains'), { recursive: true, force: true }); } catch { /* ignore */ }
}
