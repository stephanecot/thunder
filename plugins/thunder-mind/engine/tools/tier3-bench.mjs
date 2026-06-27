#!/usr/bin/env node
// SHARED · synced into each plugin's engine/tools/ by shared/sync.mjs. Benches the NEW Tier-3 layer
// in DATA tokens (overheads excluded): (1) answer-cache hit vs reading the dep contexts' raw source,
// (2) tool-output pruning on a verbose log. Uses a temp ledger so it never pollutes the demo cache.
// Usage: node engine/tools/tier3-bench.mjs [root]   (default: demo)
import { statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';
import { readManifest } from '../lib/cache.mjs';
import * as ledger from '../lib/common/ledger.mjs';
import { prune } from '../lib/common/prune.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || join(here, '..', '..', 'demo');
const tok = (b) => Math.round(b / 4);
const rawTok = (relFiles) => tok(relFiles.reduce((a, f) => { try { return a + statSync(join(root, f)).size; } catch { return a; } }, 0));

const { model } = build(root);
const ctx = model.contexts.filter((c) => (c.files || []).length).sort((a, b) => b.files.length - a.files.length)[0];
if (!ctx) { console.error('no context with files — build the demo first'); process.exit(1); }

// (1) Answer cache. Baseline = read the context's raw source to answer; thunder = relay the cached answer.
const tmp = mkdtempSync(join(tmpdir(), 'thunder-tier3-'));
let cacheRatio, baselineTok, cacheTok;
try {
  const answer = `${ctx.id}: ${ (ctx.components || []).map((c) => c.n).concat(Object.keys(ctx.services || {})).join(', ') || 'see shard' }. (cached synthesis relayed at ~0 retrieval/reasoning.)`;
  const deps = [{ ctx: ctx.id, h: ctx.src_hash }];
  ledger.writeAnswer(tmp, { q: `how does ${ctx.name} work`, answer, deps, scope: 'feature', engine: readManifest(root).engineHash });
  const hit = ledger.lookup(tmp, `explain how the ${ctx.name} feature works`, { srcHashOf: () => ctx.src_hash, engineHash: readManifest(root).engineHash });
  if (!hit || !hit.fresh) { console.error('cache lookup did not return a fresh hit — bench invalid'); process.exit(1); }
  cacheTok = tok(Buffer.byteLength(answer));
  baselineTok = rawTok(ctx.files);
  cacheRatio = Math.round((cacheTok / baselineTok) * 100);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// (2) Pruning. A 5000-line log with one buried error.
const log = Array.from({ length: 5000 }, (_, i) => (i === 2500 ? 'ERROR: deadlock detected at txn 4711' : `INFO worker tick ${i}`)).join('\n');
const pr = prune(log);
const pruneRatio = Math.round((tok(pr.out.length) / tok(log.length)) * 100);
const errKept = pr.out.includes('ERROR: deadlock detected at txn 4711');

console.log(`# tier-3 bench (root=${root}, sample context=${ctx.id})\n`);
console.log('| Mechanic | thunder tok | baseline tok | thunder/baseline | correctness |');
console.log('|---|---:|---:|---:|---|');
console.log(`| answer-cache hit | ${cacheTok} | ${baselineTok} | ${cacheRatio}% | fresh hit on paraphrase |`);
console.log(`| tool-output prune | ${tok(pr.out.length)} | ${tok(log.length)} | ${pruneRatio}% | error line kept: ${errKept} |`);

const pass = cacheRatio <= 40 && pruneRatio <= 20 && errKept;
console.log(`\nanswer-cache hit ≤ 40% of raw: ${cacheRatio}% ${cacheRatio <= 40 ? '✅' : '❌'}`);
console.log(`prune ≤ 20% of raw (error preserved): ${pruneRatio}% / kept=${errKept} ${pruneRatio <= 20 && errKept ? '✅' : '❌'}`);
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
