#!/usr/bin/env node
// ROUND-3 (IMPROVE) eval: DATA tokens only — bytes→tokens actually read to ANSWER a question,
// with all fixed harness overheads EXCLUDED (no sub-agent, no SKILL.md). Three retrieval tiers:
//   card-only  — read just the tier-1 card / targeted index (sym, routes.yaml)
//   full-shard — read the full <ctx>.yaml tier-2 shard
//   raw-ts     — read the relevant .ts source (the no-thunder baseline)
// Five frozen questions exercise the four IMPROVE fixes (granularity, functional guards, route
// guards, service HTTP facet). Usage: node engine/tools/data-bench.mjs [root]   (default: demo)
import { statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(here, '..', 'thunder.mjs');
const root = process.argv[2] || join(here, '..', '..', 'demo');
const C = join(root, '.claude', 'cache', 'thunder-angular');

const tok = (b) => Math.round(b / 4);
const fileTok = (...fs) => tok(fs.reduce((a, f) => { try { return a + statSync(f).size; } catch { return a; } }, 0));
const cmdTok = (...a) => tok(Buffer.byteLength(execFileSync('node', [ENGINE, ...a, root], { maxBuffer: 1 << 24 })));
const sh = (f) => join(C, 'projects', 'shop', f);
const src = (f) => join(root, 'src', 'app', f);

if (!existsSync(join(C, 'project-brief.yaml'))) { build(root, { force: true }); }

// Each question: the minimal file/command set that ANSWERS it in each tier, + whether that tier is
// CORRECT (✓) — i.e. contains the fact without falling back to source. `null` tier = not applicable.
const Q = [
  { id: 'Q1 routes+guards', fix: '#3',
    card:  { tok: () => fileTok(sh('../../routes.yaml')), ok: true },   // routes.yaml carries guards
    shard: { tok: () => fileTok(sh('app.yaml')),          ok: true },
    raw:   { tok: () => fileTok(src('app.routes.ts')),    ok: true } },
  { id: 'Q2 who-injects AuthService', fix: '#2',
    card:  { tok: () => cmdTok('sym', 'refs', 'AuthService'), ok: true },  // lists guard+interceptor
    shard: { tok: () => fileTok(sh('core.yaml')),             ok: true },
    raw:   { tok: () => fileTok(src('core/auth.service.ts'), src('core/auth.guard.ts')), ok: true } },
  { id: 'Q3 chat feature flow', fix: '#1',
    card:  { tok: () => fileTok(sh('features.chat.card.yaml')), ok: true },
    shard: { tok: () => fileTok(sh('features.chat.yaml')),      ok: true },
    raw:   { tok: () => fileTok(src('features/chat/chat.component.ts'), src('features/chat/chat-window.component.ts'), src('features/chat/chat.service.ts')), ok: true } },
  { id: 'Q4 documents HTTP endpoints', fix: '#4',
    card:  { tok: () => fileTok(sh('features.documents.card.yaml')), ok: false }, // verbs live in tier-2
    shard: { tok: () => fileTok(sh('features.documents.yaml')),      ok: true },
    raw:   { tok: () => fileTok(src('features/documents/knowledge.service.ts')), ok: true } },
  { id: 'Q5 chat context/role', fix: '#1',
    card:  { tok: () => fileTok(sh('features.chat.card.yaml')), ok: true },
    shard: { tok: () => fileTok(sh('features.chat.yaml')),      ok: true },
    raw:   { tok: () => fileTok(src('features/chat/chat.component.ts'), src('features/chat/chat-window.component.ts'), src('features/chat/chat.service.ts')), ok: true } },
];

const cell = (t) => (t ? `${t.tok()}${t.ok ? '' : ' ✗'}` : '—');
// thunder cost = cheapest CORRECT tier (card preferred, else shard); raw = raw-ts.
const best = (q) => (q.card.ok ? q.card.tok() : q.shard.tok());

console.log(`# data-token bench (root=${root})\n`);
console.log('DATA tokens only — fixed harness overheads (sub-agent ~10.6k, SKILL.md ~4.3k) EXCLUDED.\n');
console.log('| Question | fix | card-only | full-shard | raw-ts | thunder/raw |');
console.log('|---|---|---:|---:|---:|---:|');
let sumThunder = 0, sumRaw = 0;
for (const q of Q) {
  const t = best(q), r = q.raw.tok();
  sumThunder += t; sumRaw += r;
  console.log(`| ${q.id} | ${q.fix} | ${cell(q.card)} | ${cell(q.shard)} | ${cell(q.raw)} | ${Math.round((t / r) * 100)}% |`);
}
const q3 = Q.find((x) => x.id.startsWith('Q3'));
const q3card = q3.card.tok(), q3raw = q3.raw.tok();
const agg = Math.round((sumThunder / sumRaw) * 100);
const q3ratio = Math.round((q3card / q3raw) * 100);
console.log(`\n✗ = tier does not fully answer (fact lives one tier deeper).`);
console.log(`Q3 (feature flow) card-only vs raw: ${q3card} vs ${q3raw} tok → **${q3ratio}%** (target ≤ 50%).`);
console.log(`Aggregate thunder (cheapest correct tier) vs raw-ts: ${sumThunder} vs ${sumRaw} tok → **${agg}%** (target ≤ 50%).`);
const pass = q3ratio <= 50 && agg <= 50;
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
