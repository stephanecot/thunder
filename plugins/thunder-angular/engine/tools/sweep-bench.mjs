#!/usr/bin/env node
// ROUND 5 sweep: 20 realistic queries, each ROUTED to its cheapest entry point (sym / project-brief /
// routes.yaml / capability-map grep / ask), vs the raw cost (grep + read .ts). Usage: [root]
import { statSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';
import { readCache } from '../lib/cache.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(here, '..', 'thunder.mjs');
const root = process.argv[2] || join(here, '..', '..', 'demo');
const C = join(root, '.claude', 'cache', 'thunder-angular');
const tok = (b) => Math.round(b / 4);
const fileTok = (...fs) => tok(fs.filter(Boolean).reduce((a, f) => { try { return a + statSync(f).size; } catch { return a; } }, 0));
const eng = (...args) => tok(Buffer.byteLength(execFileSync('node', [ENGINE, ...args, root], { maxBuffer: 1 << 24 })));
const grepTok = (file, term) => { try { return tok(Buffer.byteLength(readFileSync(file, 'utf8').split('\n').filter((l) => l.toLowerCase().includes(term.toLowerCase())).join('\n'))); } catch { return 0; } };

const { model } = build(root);
const cache = readCache(root);
const sample = [...model.contexts].sort((a, b) => (b.components.length + b.routes.length) - (a.components.length + a.routes.length)).find((c) => c.components.length) || model.contexts[0];
const comp = (sample.components[0] || {}).n;
const svcNames = Object.keys(sample.services);
const svc = svcNames.find((n) => n.endsWith('Service')) || svcNames[0] || comp;
const feature = sample.feature;
const abs = (rel) => join(root, rel);
const allTs = model.contexts.flatMap((c) => c.files.map(abs));
const routeFiles = allTs.filter((p) => /\.routes\.ts$|routing/.test(p));
const featureRouteFiles = sample.files.map(abs).filter((p) => /\.routes\.ts$|routing/.test(p));
const defFile = (n) => { for (const f of cache.values()) if ((f.types || []).some((t) => t.name === n)) return abs(f.file); return null; };
const refFiles = (n) => {
  const out = []; const re = new RegExp(`\\b${n}\\b`);
  for (const f of cache.values()) {
    const hay = (f.types || []).flatMap((t) => [t.ext, ...(t.ctorDeps || []), ...(t.methods || []).map((m) => m.sig), ...(t.props || []).map((x) => x.type)]).filter(Boolean).join(' ');
    if (re.test(hay)) out.push(abs(f.file));
  }
  return out;
};
const BRIEF = join(C, 'project-brief.yaml'); const RTS = join(C, 'routes.yaml'); const CAP = join(C, 'capability-map.yaml');

const Q = [
  ['where is ' + comp + ' defined', 'sym', () => eng('sym', 'def', comp), () => fileTok(defFile(comp))],
  ['who injects ' + svc, 'sym', () => eng('sym', 'refs', svc), () => fileTok(...refFiles(svc))],
  ['find the ' + comp + ' class', 'sym', () => eng('sym', 'def', comp), () => fileTok(defFile(comp))],
  ['where is ' + svc + ' defined', 'sym', () => eng('sym', 'def', svc), () => fileTok(defFile(svc))],
  ['uses of ' + svc, 'sym', () => eng('sym', 'refs', svc), () => fileTok(...refFiles(svc))],
  ['architecture overview', 'brief', () => fileTok(BRIEF), () => fileTok(...allTs)],
  ['which projects/features exist', 'brief', () => fileTok(BRIEF), () => fileTok(...allTs)],
  ['how is the app structured', 'brief', () => fileTok(BRIEF), () => fileTok(...allTs)],
  ['list all routes', 'routes', () => fileTok(RTS), () => fileTok(...routeFiles)],
  ['routes of feature ' + feature, 'routes', () => grepTok(RTS, feature), () => fileTok(...routeFiles)],
  ['route for ' + feature, 'routes', () => grepTok(RTS, feature), () => fileTok(...featureRouteFiles)],
  ['who handles ' + feature, 'discovery', () => grepTok(CAP, feature), () => fileTok(...allTs)],
  ['where is ' + feature + ' processed', 'discovery', () => grepTok(CAP, feature), () => fileTok(...allTs)],
  ['which feature deals with ' + feature, 'discovery', () => grepTok(CAP, feature), () => fileTok(...allTs)],
  ['business rule of ' + feature, 'ask', () => eng('ask', '--facts', feature), () => fileTok(...sample.files.map(abs))],
  ['flow of ' + feature, 'ask', () => eng('ask', feature + ' flow'), () => fileTok(...sample.files.map(abs))],
  ['what does ' + svc + ' do', 'ask', () => eng('ask', '--facts', svc), () => fileTok(defFile(svc))],
  ['validation rules for ' + feature, 'ask', () => eng('ask', '--facts', feature + ' validation'), () => fileTok(...sample.files.map(abs))],
  ['how does ' + feature + ' work', 'ask', () => eng('ask', feature), () => fileTok(...sample.files.map(abs))],
  ['capabilities of ' + feature, 'ask', () => eng('ask', '--facts', feature), () => fileTok(...sample.files.map(abs))],
];

if (!existsSync(BRIEF)) { console.error('build the index first'); process.exit(1); }
console.log(`# sweep-bench (root=${root}, 20 routed queries, sample=${sample.id})\n`);
console.log('| # | Query | route | thunder | raw | factor | winner |');
console.log('|---|---|---|---|---|---|---|');
let sumA = 0, sumB = 0, wins = 0;
Q.forEach(([q, route, A, B], i) => {
  const a = A(), b = B(); sumA += a; sumB += b;
  const win = a <= b; if (win) wins++;
  console.log(`| ${i + 1} | ${q} | ${route} | ${a} | ${b} | ${b && a ? (b / a).toFixed(1) + '×' : '—'} | ${win ? 'thunder' : 'raw'} |`);
});
const economy = Math.round((1 - sumA / sumB) * 100);
console.log(`\nthunder wins **${wins}/20** · aggregate **${sumA} vs ${sumB} tok → ${economy}% saved** (targets ≥18/20, ≥70%).`);
process.exit(wins >= 18 && economy >= 70 ? 0 : 1);
