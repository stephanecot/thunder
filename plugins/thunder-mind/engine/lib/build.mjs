import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dump } from './yaml.mjs';
import { shortHash } from './hash.mjs';
import { normalize } from './common/ledger.mjs';
import {
  cacheDir, decisionsDir, ensureDir,
  readCache, writeCache, readManifest, writeManifest,
} from './cache.mjs';
import {
  listDecisionFiles, parseDecision, validateDecision, idFromRel, ACTIVE_STATUSES,
} from './decision.mjs';

// Bump when retrieval/emit semantics change → invalidates the Tier-3 answer ledger.
export const ENGINE_VERSION = 'thunder-mind/1';
const ENGINE_HASH = shortHash(ENGINE_VERSION);

const BRIEF_PER_DOMAIN = 6;   // cap structuring decisions shown per domain in the brief
const BRIEF_MAX = 40;         // hard cap on brief entries (keeps SessionStart injection bounded)

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

/** Bounded alignment digest: per-domain counts + the most structuring ACTIVE decisions. */
function briefOf(model) {
  const structuring = (d) => (d.type === 'architecture' || d.type === 'convention');
  const picks = [];
  for (const dm of model.domains) {
    const active = model.decisions
      .filter((d) => d.domain === dm.name && ACTIVE_STATUSES.includes(d.status))
      .sort((a, b) => (structuring(b) - structuring(a)) || String(b.date).localeCompare(String(a.date)))
      .slice(0, BRIEF_PER_DOMAIN);
    for (const d of active) picks.push({ id: d.id, type: d.type, domain: d.domain, title: d.title, decision: d.decision });
  }
  return {
    meta: { decisions: model.N, domains: model.domains.length, by_status: model.byStatus },
    domains: model.domains.map((d) => ({ name: d.name, count: d.count, active: d.active })),
    key_decisions: picks.slice(0, BRIEF_MAX),
    note: picks.length > BRIEF_MAX ? `+${picks.length - BRIEF_MAX} more — use recall "<keywords>"` : 'use recall "<keywords>" before deciding',
  };
}

/** Emit the derived index to cache/ (free, deterministic — no model tokens). */
export function emit(root, model) {
  const dir = cacheDir(root);
  ensureDir(dir);

  writeFileSync(join(dir, 'index.yaml'), dump({
    meta: { decisions: model.N, domains: model.domains.length, by_type: model.byType, by_status: model.byStatus,
      drill: 'domain-map.yaml (grep) · brief.yaml (overview) · recall "<keywords>"' },
    domains: model.domains,
  }));

  writeFileSync(join(dir, 'domain-map.yaml'), dump(
    model.decisions.map((d) => ({ id: d.id, type: d.type, status: d.status, domain: d.domain, title: d.title }))
  ));

  writeFileSync(join(dir, 'brief.yaml'), dump(briefOf(model)));

  // inverted index, one term per line: {"t":"rls","ids":["auth/...","..."]}
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
}
