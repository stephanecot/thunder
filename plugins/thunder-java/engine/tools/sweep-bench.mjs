#!/usr/bin/env node
// ROUND 5 sweep: 20 realistic queries, each ROUTED to its cheapest entry point (sym / project-brief /
// endpoints.yaml / capability-map grep / ask), measured against the raw cost (grep + read .java).
// Reports a per-query table + aggregate economy. Usage: node engine/tools/sweep-bench.mjs [root]
import { statSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';
import { readCache } from '../lib/cache.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(here, '..', 'thunder.mjs');
const root = process.argv[2] || join(here, '..', '..', 'demo');
const C = join(root, '.claude', 'cache', 'thunder-java');
const tok = (b) => Math.round(b / 4);
const fileTok = (...fs) => tok(fs.filter(Boolean).reduce((a, f) => { try { return a + statSync(f).size; } catch { return a; } }, 0));
const eng = (...args) => tok(Buffer.byteLength(execFileSync('node', [ENGINE, ...args, root], { maxBuffer: 1 << 24 })));
const grepTok = (file, term) => { try { return tok(Buffer.byteLength(readFileSync(file, 'utf8').split('\n').filter((l) => l.toLowerCase().includes(term.toLowerCase())).join('\n'))); } catch { return 0; } };

const { model } = build(root);
const cache = readCache(root);
const sample = [...model.contexts].sort((a, b) => b.endpoints.length - a.endpoints.length).find((c) => c.endpoints.length) || model.contexts[0];
const T = sample.types;
const svc = (T.find((t) => t.n.endsWith('Service')) || {}).n;
const ctrl = (T.find((t) => t.n.endsWith('Controller')) || {}).n;
const repo = (T.find((t) => t.n.endsWith('Repository')) || {}).n;
const entity = Object.keys(sample.entities)[0] || (T[0] || {}).n;
const moduleName = sample.module;
const cname = sample.name;
const abs = (rel) => join(root, rel);
const allJava = model.contexts.flatMap((c) => c.files.map(abs));
const controllers = allJava.filter((p) => p.endsWith('Controller.java'));
const sampleController = sample.files.map(abs).filter((p) => p.endsWith('Controller.java'));
const moduleControllers = model.contexts.filter((c) => c.module === moduleName).flatMap((c) => c.files.map(abs)).filter((p) => p.endsWith('Controller.java'));
const defFile = (n) => { for (const c of model.contexts) for (const t of c.types) if (t.n === n) return abs(t.file); return null; };
const refFiles = (n) => {
  const out = [];
  const re = new RegExp(`\\b${n}\\b`);
  for (const f of cache.values()) {
    const hay = (f.types || []).flatMap((t) => [t.ext, ...(t.methods || []).map((m) => m.sig), ...(t.fields || []).map((x) => x.t)]).filter(Boolean).join(' ');
    if (re.test(hay)) out.push(abs(f.file));
  }
  return out;
};
const BRIEF = join(C, 'project-brief.yaml');
const EPS = join(C, 'endpoints.yaml');
const CAP = join(C, 'capability-map.yaml');

const Q = [
  ['where is ' + svc + ' defined', 'sym', () => eng('sym', 'def', svc), () => fileTok(defFile(svc))],
  ['who uses ' + repo, 'sym', () => eng('sym', 'refs', repo), () => fileTok(...refFiles(repo))],
  ['find the ' + ctrl + ' class', 'sym', () => eng('sym', 'def', ctrl), () => fileTok(defFile(ctrl))],
  ['where is ' + entity + ' defined', 'sym', () => eng('sym', 'def', entity), () => fileTok(defFile(entity))],
  ['callers of ' + svc, 'sym', () => eng('sym', 'refs', svc), () => fileTok(...refFiles(svc))],
  ['architecture overview', 'brief', () => fileTok(BRIEF), () => fileTok(...allJava)],
  ['which modules exist', 'brief', () => fileTok(BRIEF), () => fileTok(...allJava)],
  ['how is the app structured', 'brief', () => fileTok(BRIEF), () => fileTok(...allJava)],
  ['list all endpoints', 'endpoints', () => fileTok(EPS), () => fileTok(...controllers)],
  ['endpoints of module ' + moduleName, 'endpoints', () => grepTok(EPS, moduleName), () => fileTok(...moduleControllers)],
  ['endpoint for ' + cname, 'endpoints', () => grepTok(EPS, cname), () => fileTok(...sampleController)],
  ['who handles ' + cname, 'discovery', () => grepTok(CAP, cname), () => fileTok(...allJava)],
  ['where is ' + cname + ' processed', 'discovery', () => grepTok(CAP, cname), () => fileTok(...allJava)],
  ['which context deals with ' + cname, 'discovery', () => grepTok(CAP, cname), () => fileTok(...allJava)],
  ['business rule of ' + cname, 'ask', () => eng('ask', '--facts', cname), () => fileTok(...sample.files.map(abs))],
  ['flow of creating ' + cname, 'ask', () => eng('ask', cname + ' create flow'), () => fileTok(...sample.files.map(abs))],
  ['what does ' + svc + ' do', 'ask', () => eng('ask', '--facts', svc), () => fileTok(defFile(svc))],
  ['validation rules for ' + cname, 'ask', () => eng('ask', '--facts', cname + ' validation'), () => fileTok(...sample.files.map(abs))],
  ['how does ' + cname + ' work', 'ask', () => eng('ask', cname), () => fileTok(...sample.files.map(abs))],
  ['capabilities of ' + cname, 'ask', () => eng('ask', '--facts', cname), () => fileTok(...sample.files.map(abs))],
];

if (!existsSync(BRIEF)) { console.error('build the index first'); process.exit(1); }
console.log(`# sweep-bench (root=${root}, 20 routed queries, sample=${sample.id})\n`);
console.log('| # | Query | route | thunder | raw | factor | winner |');
console.log('|---|---|---|---|---|---|---|');
let sumA = 0, sumB = 0, wins = 0;
Q.forEach(([q, route, A, B], i) => {
  const a = A(), b = B();
  sumA += a; sumB += b;
  const win = a <= b;
  if (win) wins++;
  console.log(`| ${i + 1} | ${q} | ${route} | ${a} | ${b} | ${b && a ? (b / a).toFixed(1) + '×' : '—'} | ${win ? 'thunder' : 'raw'} |`);
});
const economy = Math.round((1 - sumA / sumB) * 100);
console.log(`\nthunder wins **${wins}/20** · aggregate **${sumA} vs ${sumB} tok → ${economy}% saved** (targets ≥18/20, ≥70%).`);
process.exit(wins >= 18 && economy >= 70 ? 0 : 1);
