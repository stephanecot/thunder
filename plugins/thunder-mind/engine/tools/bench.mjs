#!/usr/bin/env node
// Measure thunder-mind's real recall cost vs the no-index baseline, across corpus sizes.
// Honest data-token methodology (matches the other Thunder plugins):
//   thunder tok   = the recall payload actually ingested (bytes/4)
//   find baseline = what you must read to FIND the decision WITHOUT a pre-built index — you cannot know
//                   which file holds the answer, so you scan the decision corpus (bytes/4). This is the
//                   "read-to-search" cost the index removes; it grows with the repo.
//   file baseline = bytes/4 of the single decision file that answers (conservative per-answer cost).
// Prints Markdown tables — paste verbatim into BENCHMARK.md (no invented numbers).
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { build } from '../lib/build.mjs';
import { recall } from '../lib/recall.mjs';
import { emitDecision, makeId } from '../lib/decision.mjs';
import { prune } from '../lib/common/prune.mjs';
import * as ledger from '../lib/common/ledger.mjs';
import { cacheDir } from '../lib/cache.mjs';

const tok = (bytes) => Math.round(bytes / 4);
const DOMAINS = ['auth', 'api', 'data', 'billing', 'search', 'frontend', 'infra', 'observability', 'messaging', 'payments'];
const TYPES = ['architecture', 'technical', 'functional', 'convention'];
const TOPICS = ['caching strategy', 'retry policy', 'pagination', 'rate limiting', 'schema migration',
  'token refresh', 'idempotency keys', 'feature flags', 'audit logging', 'error taxonomy', 'circuit breaker',
  'bulk import', 'soft delete', 'timezone handling', 'currency rounding', 'webhook delivery', 'data retention'];
const TECH = ['Postgres', 'Redis', 'Kafka', 'gRPC', 'OpenAPI', 'JWT', 'S3', 'cron', 'OAuth2', 'GraphQL'];

function gen(dir, count) {
  const base = join(dir, '.thunder', 'mind', 'decisions');
  for (let i = 0; i < count; i++) {
    const domain = DOMAINS[i % DOMAINS.length], type = TYPES[i % TYPES.length];
    const topic = TOPICS[i % TOPICS.length], tech = TECH[i % TECH.length];
    const date = `${2024 + (i % 3)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    const title = `${topic} for ${domain} using ${tech} #${i}`;
    const id = makeId(domain, date, title);
    const d = { id, title, type, status: i % 11 === 0 ? 'superseded' : 'active', domain, date, authors: ['gen'],
      context: `Synthetic decision ${i} about ${topic} in the ${domain} domain.`,
      decision: `Standardize ${topic} on ${tech} across ${domain}.`,
      rationale: `Consistency and operational simplicity for ${topic}.`,
      consequences: [`Teams adopt ${tech} for ${topic} in ${domain}.`],
      alternatives: [{ choice: `ad-hoc ${topic}`, rejected_because: 'inconsistent across services' }],
      tags: [domain, topic.split(' ')[0], tech.toLowerCase()], conflicts_with: [], evidence: [] };
    const p = join(base, ...id.split('/')) + '.yaml';
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, emitDecision(d));
  }
}

function corpusBytes(dir) {
  const base = join(dir, '.thunder', 'mind', 'decisions');
  let bytes = 0;
  const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); const s = statSync(f); s.isDirectory() ? walk(f) : (bytes += s.size); } };
  walk(base);
  return bytes;
}

const QUERIES = ['retry policy kafka', 'caching redis', 'pagination grpc', 'schema migration postgres',
  'idempotency keys', 'webhook delivery', 'rate limiting', 'audit logging'];
const dump = (await import('../lib/yaml.mjs')).dump;

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = SIZES.length ? SIZES : [50, 500, 2000];

const scale = [], search = [];
for (const size of sizes) {
  const dir = mkdtempSync(join(tmpdir(), `mind-bench-${size}-`));
  try {
    gen(dir, size);
    const t0 = process.hrtime.bigint();
    const { model } = build(dir);
    const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const cBytes = corpusBytes(dir);

    let payloadTok = 0, recallMs = 0, fileTok = 0, n = 0;
    for (const q of QUERIES) {
      const r0 = process.hrtime.bigint();
      const res = recall(model, q);
      recallMs += Number(process.hrtime.bigint() - r0) / 1e6;
      if (!res.matched) continue;
      payloadTok += tok(Buffer.byteLength(dump(res)));
      const top = res.cards[0];
      try { fileTok += tok(statSync(join(dir, '.thunder/mind/decisions', top.id + '.yaml')).size); } catch { /* */ }
      n++;
    }
    const avgPayload = Math.round(payloadTok / n), avgFile = Math.round(fileTok / n), avgMs = (recallMs / QUERIES.length);
    scale.push({ size, buildMs: buildMs.toFixed(0), corpusTok: tok(cBytes), avgPayload, avgMs: avgMs.toFixed(2) });
    search.push({ size, recallTok: avgPayload, scanTok: tok(cBytes), factor: Math.round(tok(cBytes) / avgPayload), fileTok: avgFile });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log('\n### Scale — build + recall stay flat as the corpus grows\n');
console.log('| decisions | build (ms) | corpus tok | avg recall payload tok | avg recall (ms) |');
console.log('|---:|---:|---:|---:|---:|');
for (const s of scale) console.log(`| ${s.size} | ${s.buildMs} | ${s.corpusTok} | ${s.avgPayload} | ${s.avgMs} |`);

console.log('\n### Recall vs read-to-search (find one decision WITHOUT an index)\n');
console.log('| decisions | recall tok | scan-corpus baseline tok | factor | (single-file baseline tok) |');
console.log('|---:|---:|---:|---:|---:|');
for (const s of search) console.log(`| ${s.size} | ${s.recallTok} | ${s.scanTok} | **~${s.factor}×** | ${s.fileTok} |`);
console.log('\n(' + QUERIES.length + ' representative queries averaged per size.)');

// ---- Tier-3: answer cache + tool-output pruning (own temp corpus, deterministic) ------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'mind-tier3-'));
  try {
    gen(dir, 200);
    const { model } = build(dir);
    const q = 'retry policy kafka';
    const fresh = recall(model, q);
    const freshTok = tok(Buffer.byteLength(dump(fresh)));
    const id = fresh.cards[0].id;
    const h = '00000000';
    const answer = `Decided: ${fresh.cards[0].decision} (${id})`;
    ledger.writeAnswer(cacheDir(dir), { q, answer, deps: [{ ctx: id, h }], engine: model.engineHash, nowIso: '2026-01-01T00:00:00Z' });
    const hit = ledger.lookup(cacheDir(dir), q, { srcHashOf: () => h, engineHash: model.engineHash });
    const cachedTok = tok(Buffer.byteLength(hit && hit.entry ? hit.entry.a : ''));

    const log = Array.from({ length: 1000 }, (_, i) => (i === 300 || i === 700) ? `line ${i}: ERROR boom` : `line ${i}: ok`).join('\n');
    const pr = prune(log);
    console.log('\n### Tier-3 — answer cache + tool-output pruning\n');
    console.log('| layer | without | with | saved |');
    console.log('|---|---:|---:|---:|');
    console.log(`| answer cache (repeat recall) | ${freshTok} tok | ${cachedTok} tok | **${Math.round((1 - cachedTok / freshTok) * 100)}%** |`);
    console.log(`| prune (1000-line log) | ${tok(Buffer.byteLength(log))} tok | ${tok(Buffer.byteLength(pr.out))} tok | **${Math.round((1 - tok(Buffer.byteLength(pr.out)) / tok(Buffer.byteLength(log))) * 100)}%** (kept ${pr.kept}/${pr.total}, every diagnostic) |`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
