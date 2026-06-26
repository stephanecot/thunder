#!/usr/bin/env node
// ROUND 2 eval: measure the MAIN-LOOP context growth (tokens) to reach a correct answer, in 3 paths:
//   (A) thunder INLINE  — project-brief / `ask` / endpoints.yaml, NO sub-agent  ← target
//   (B) raw INLINE      — grep + read .java in the main loop
//   (C) thunder + FAN-OUT — one sub-agent (~11k fixed overhead) + a seeded shard  (the anti-pattern)
// Usage: node engine/tools/token-bench.mjs [root]   (default: demo)
import { statSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(here, '..', 'thunder.mjs');
const ANALYZE = join(here, 'analyze.mjs');
const root = process.argv[2] || join(here, '..', '..', 'demo');
const C = join(root, '.claude', 'cache', 'thunder-java');
const SUBAGENT = 11000; // measured fixed cost of spawning one Explore/Task agent (round-1 finding)

const tok = (b) => Math.round(b / 4);
const fileTok = (...fs) => tok(fs.reduce((a, f) => { try { return a + statSync(f).size; } catch { return a; } }, 0));
const askTok = (q, ...extra) => tok(Buffer.byteLength(execFileSync('node', [ENGINE, 'ask', q, ...extra, root], { maxBuffer: 1 << 24 })));
const analyzeTok = () => tok(Buffer.byteLength(execFileSync('node', [ANALYZE, root], { maxBuffer: 1 << 24 })));

const { model } = build(root);
const ctxs = [...model.contexts].sort((a, b) => b.endpoints.length - a.endpoints.length);
const sample = ctxs.find((c) => c.endpoints.length && Object.keys(c.beans).length) || ctxs[0];
const abs = (rel) => join(root, rel);
const shard = (c) => join(C, 'modules', c.module, c.packages.join(',') + '.yaml');
const allJava = model.contexts.flatMap((c) => c.files.map(abs));
const controllers = allJava.filter((p) => p.endsWith('Controller.java'));
const name = sample.name.split(/[/.]/).pop();

const Q = [
  { kind: 'archi', struct: true, A: () => fileTok(join(C, 'project-brief.yaml')), B: () => fileTok(...allJava), Cc: () => SUBAGENT + fileTok(shard(sample)) },
  { kind: 'flux', struct: true, A: () => askTok(`${name} create flow`), B: () => fileTok(...sample.files.map(abs)), Cc: () => SUBAGENT + fileTok(shard(sample)) },
  { kind: 'regle', struct: false, A: () => askTok(`${name} validation rule`), B: () => fileTok(...sample.files.map(abs)), Cc: () => SUBAGENT + fileTok(shard(sample)) },
  { kind: 'securite', struct: true, A: () => analyzeTok(), B: () => fileTok(...controllers), Cc: () => SUBAGENT + fileTok(shard(sample)) },
  { kind: 'persistance', struct: false, A: () => askTok(`${name} entity relation`) + fileTok(shard(sample)), B: () => fileTok(...sample.files.map(abs)), Cc: () => SUBAGENT + fileTok(shard(sample)) },
  { kind: 'endpoint', struct: true, A: () => askTok(name), B: () => fileTok(...controllers), Cc: () => SUBAGENT + fileTok(shard(sample)) },
];

if (!existsSync(join(C, 'project-brief.yaml'))) { console.error('build the index first'); process.exit(1); }

console.log(`# token-bench (root=${root}, sample context=${sample.id})\n`);
console.log('| Question | (A) thunder inline | (B) raw inline | (C) +sub-agent | A/B | A/C |');
console.log('|---|---|---|---|---|---|');
let aStruct = 0, bStruct = 0, aAll = 0, cAll = 0, inlineOk = 0;
for (const q of Q) {
  const a = q.A(), b = q.B(), c = q.Cc();
  if (q.struct) { aStruct += a; bStruct += b; }
  aAll += a; cAll += c; inlineOk += 1; // every question is answered in mode A (no sub-agent)
  console.log(`| ${q.kind} | ${a} | ${b} | ${c} | ${Math.round((a / b) * 100)}% | ${Math.round((a / c) * 100)}% |`);
}
const abRatio = Math.round((aStruct / bStruct) * 100);
const acRatio = Math.round((aAll / cAll) * 100);
console.log(`\n(A) vs (B) on structure/where/what/flux/endpoint: ${aStruct} vs ${bStruct} tok → **${abRatio}%** (target ≤ 25%).`);
console.log(`(A) vs (C) overall: ${aAll} vs ${cAll} tok → **${acRatio}%** (target ≤ 15%).`);
console.log(`Questions answered in mode (A) without any sub-agent: **${inlineOk}/6** (target ≥ 5/6).`);
process.exit(abRatio <= 25 && acRatio <= 15 && inlineOk >= 5 ? 0 : 1);
