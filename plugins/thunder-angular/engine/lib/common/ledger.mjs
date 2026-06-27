// SHARED · language-agnostic · byte-identical across all thunder-<lang> plugins (synced by
// shared/sync.mjs). Do NOT edit the copies under plugins/*/engine/lib/common/ — edit here.
//
// Phase 2 — Tier-3 answer cache. Caches past *answers* keyed by question terms, gated for FRESHNESS
// by the per-context `src_hash` the index already emits (+ the engine hash). Correct by construction:
// a stale answer is never returned because any source change flips the dependency hash. Zero-dep,
// deterministic, falls through safely on any miss. Lexical (BM25/cosine-idf) matching — no embeddings.

import { join } from 'node:path';
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';

const STOP = new Set(('a an the is are am be was were do does did how what why where which who whom when ' +
  'of to in on for from with by at as it its this that these those and or not no your you i we they ' +
  'show list give tell me my our their about into over under can could would should').split(/\s+/));

/** Deterministic normalization: lowercase, strip punctuation, drop stopwords, light de-plural, sort+dedupe. */
export function normalize(q) {
  const terms = String(q || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .filter((t) => !STOP.has(t) && t.length > 1)
    .map(stem);
  const uniq = [...new Set(terms)];
  return { qn: [...uniq].sort().join(' '), terms: uniq };
}
function stem(t) {
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('ses') && t.length > 4) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

export const ledgerPath = (cacheDir) => join(cacheDir, 'qa-ledger.ndjson');

export function readLedger(cacheDir) {
  const p = ledgerPath(cacheDir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Look up a fresh cached answer for `query`.
 * @param {string} cacheDir
 * @param {string} query
 * @param {{srcHashOf:(ctxId:string)=>(string|null), engineHash?:string, scope?:string, tauStrong?:number}} ctx
 * @returns {null | {entry:object, score:number, fresh:boolean, reason?:string, ctx?:string}}
 */
export function lookup(cacheDir, query, { srcHashOf, engineHash, scope, tauStrong = 0.6 } = {}) {
  const entries = readLedger(cacheDir);
  if (!entries.length) return null;
  const { terms } = normalize(query);
  if (!terms.length) return null;

  // idf over the ledger corpus (cosine of idf-weighted term sets).
  const df = new Map();
  for (const e of entries) for (const t of new Set(e.terms || [])) df.set(t, (df.get(t) || 0) + 1);
  const N = entries.length;
  const idf = (t) => Math.log(1 + N / ((df.get(t) || 0) + 0.5));

  const qset = new Set(terms);
  let qself = 0; for (const t of qset) qself += idf(t) ** 2;

  // idf-weighted OVERLAP coefficient: shared weight / min(self-weights). Favors recall (a paraphrase
  // with filler still matches), while idf keeps topic-distinguishing terms decisive (chat ≠ payment).
  // Correctness is not at stake here — the dep/engine hash gate below guarantees freshness; this only
  // decides relevance, and the scope gate + tauStrong bound false matches.
  let best = null, bestScore = 0;
  for (const e of entries) {
    if (scope && e.scope && scope !== e.scope) continue;       // scope gate (don't answer routes from flow)
    const eset = new Set(e.terms || []);
    let dot = 0, dself = 0;
    for (const t of eset) { const w = idf(t); dself += w * w; if (qset.has(t)) dot += w * w; }
    if (dot <= 0) continue;
    const score = dot / (Math.min(qself, dself) || 1);
    if (score > bestScore) { bestScore = score; best = e; }
  }
  if (!best) return null;
  if (bestScore < tauStrong) return { entry: best, score: bestScore, fresh: false, reason: 'weak' };
  if (engineHash && best.engine && best.engine !== engineHash) return { entry: best, score: bestScore, fresh: false, reason: 'engine' };
  for (const d of (best.deps || [])) {
    const cur = srcHashOf ? srcHashOf(d.ctx) : null;
    if (cur == null || cur !== d.h) return { entry: best, score: bestScore, fresh: false, reason: 'stale', ctx: d.ctx };
  }
  return { entry: best, score: bestScore, fresh: true };
}

/** Append one answer. `deps` = [{ctx, h}] (h = the context's current src_hash). `nowIso` injected for determinism in tests. */
export function writeAnswer(cacheDir, { q, answer, deps = [], scope = null, engine = null, nowIso }) {
  const { qn, terms } = normalize(q);
  const rec = { q, qn, terms, a: answer, deps, scope, engine, hits: 0, ts: nowIso || new Date().toISOString() };
  mkdirSync(cacheDir, { recursive: true });
  appendFileSync(ledgerPath(cacheDir), JSON.stringify(rec) + '\n');
  return rec;
}

/** Drop entries whose engine hash is stale (parser semantics changed). Returns {kept, dropped}. */
export function gc(cacheDir, { engineHash } = {}) {
  const all = readLedger(cacheDir);
  const kept = all.filter((e) => !engineHash || !e.engine || e.engine === engineHash);
  writeFileSync(ledgerPath(cacheDir), kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
  return { kept: kept.length, dropped: all.length - kept.length };
}

export function stats(cacheDir) {
  const all = readLedger(cacheDir);
  const hits = all.reduce((a, e) => a + (e.hits || 0), 0);
  return { entries: all.length, hits };
}
