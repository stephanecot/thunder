#!/usr/bin/env node
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './lib/build.mjs';
import { dump } from './lib/yaml.mjs';
import { appendDirty, drainDirty, readCache, cacheDir, readManifest, ensureDir, projectConfig, isInitialized } from './lib/cache.mjs';
import * as ledger from './lib/common/ledger.mjs';
import { prune } from './lib/common/prune.mjs';
import * as debug from './lib/common/debug.mjs';
const fwOf = (root) => cacheDir(root).split(/[\\/]/).pop().replace(/^thunder-/, '');
import {
  buildEvidence, staleContexts, setFunctional,
  staleModules, setModuleFunctional, moduleContextHash,
} from './lib/functional.mjs';

function cmdBuild(root, force) {
  const t0 = process.hrtime.bigint();
  const r = build(root, { force });
  if (r.total > 0 && !isInitialized(root)) writeFileSync(projectConfig(root), INIT_CONFIG); // explicit build opts this project in
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`thunder-node: ${r.total} fichiers (${r.parsed} parsés, ${r.reused} réutilisés, ${r.errors} erreurs)` +
    `${r.engineBust ? ' [cache invalidé: moteur modifié ou --force]' : ''} → ` +
    `${r.model.projects.length} projets, ${r.model.contexts.length} contextes, ${r.model.routes.length} routes · ${r.changed} shards · ${ms.toFixed(0)}ms`);
}

const INIT_CONFIG = `# thunder-node — committed project marker. Its presence turns indexing ON for this project.
# Without it, thunder-node stays completely idle (no .thunder/node/ dir, no tokens spent).
enabled: true
language: node
`;

// Opt-in marker: thunder-node only indexes a project once `init` has been run there
// (committed .thunder/node/config.yaml). This keeps it idle on unrelated projects.
function cmdInit(root) {
  const cfg = projectConfig(root);
  const already = existsSync(cfg);
  ensureDir(cacheDir(root));
  if (!already) writeFileSync(cfg, INIT_CONFIG);
  drainDirty(root);
  const r = build(root, { force: true });
  if (r.total === 0) {
    console.log(`thunder-node: initialized (${cfg}) — no Node sources found yet; the index will fill as you add them.`);
    return;
  }
  console.log(`thunder-node: ${already ? 're-' : ''}initialized & indexed (${r.total} files) under .thunder/node/ — commit it to share. Run /thunder-node:thunder-node-reindex to infer the functional layer.`);
}

function cmdEnsure(root) {
  if (!isInitialized(root)) return; // opt-in: idle until `thunder-node-init` runs on this project
  drainDirty(root);
  const r = build(root);
  if (r.total === 0) return;
  console.log(`thunder-node: index frais (${r.model.projects.length} projets, ${r.model.contexts.length} contextes, ${r.model.routes.length} routes). /thunder-node:thunder-node-codemap pour explorer.`);
}

const cmdTouch = (root, file) => { if (file) appendDirty(root, file); };

function cmdOverview(root) {
  const { model } = build(root);
  console.log(`# ${model.projects.length} projets · ${model.contexts.length} contextes · ${model.routes.length} endpoints\n`);
  for (const c of model.contexts) {
    console.log(`${c.id}  [${c.framework}]  (${c.fileCount} fichiers, ${c.components.length} controllers, ${Object.keys(c.services).length} services, ${c.routes.length} endpoints)`);
  }
}

function cmdRoutes(root) {
  const { model } = build(root);
  for (const r of model.routes) console.log(`${(r.verb || 'USE').padEnd(7)} ${(r.path || '/').padEnd(28)} ${r.target || ''}`);
}

function cmdStale(root, asJson) {
  const { model, functional } = build(root);
  const stale = staleContexts(model, root, functional);
  if (asJson) { console.log(JSON.stringify(stale)); return; }
  if (!stale.length) { console.log('thunder-node: couche fonctionnelle à jour'); return; }
  console.log(`thunder-node: ${stale.length} contexte(s) à (ré)inférer :`);
  for (const s of stale) console.log(`  ${s.id}  [${s.reason}]`);
}

// Batched, file-based evidence — see the reindex skill's cost model. Packs go to FILES + the Haiku
// sub-agent, never through the (Opus) orchestrator's context; N sub-agents collapse to N/batch. This is
// the fix for the O(N^2)/hundreds-of-sub-agents blow-up on the functional pass.
function cmdEvidenceBatch(root, limit, outArg) {
  const { model, functional } = build(root);
  const stale = staleContexts(model, root, functional);
  const sel = (limit && limit > 0) ? stale.slice(0, limit) : stale;
  const outDir = outArg ? resolve(outArg) : join(cacheDir(root), 'evidence');
  ensureDir(outDir);
  const contexts = [];
  for (const s of sel) {
    const ctx = model.contexts.find((c) => c.id === s.id);
    if (!ctx) continue;
    const file = join(outDir, s.id.replace(/[^\w.-]/g, '_') + '.json');
    writeFileSync(file, JSON.stringify(buildEvidence(ctx, root)));
    contexts.push({ id: s.id, reason: s.reason, path: file });
  }
  console.log(JSON.stringify({ outDir, totalStale: stale.length, written: contexts.length, contexts }));
}

async function cmdSetFunctionalBatch(root) {
  const { model } = build(root);
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e) { console.error('invalid JSON on stdin:', e.message); process.exit(1); }
  if (!Array.isArray(data)) { console.error('expected a JSON array of {id, ...} on stdin'); process.exit(1); }
  const done = [], failed = [];
  for (const d of data) {
    try { setFunctional(root, model, d.id, d); done.push(d.id); }
    catch (e) { failed.push({ id: d && d.id, error: e.message }); }
  }
  build(root); // re-emit shards once, with all merged functional data
  console.log(JSON.stringify({ set: done.length, failed }));
}

function cmdStaleModules(root, asJson) {
  const { model, functional } = build(root);
  const stale = staleModules(model, root, functional);
  if (asJson) { console.log(JSON.stringify(stale)); return; }
  if (!stale.length) { console.log('thunder-node: project themes up to date'); return; }
  for (const s of stale) console.log(`  ${s.module}  [${s.reason}]`);
}

function cmdResetFunctional(root) {
  const p = join(root, '.thunder', 'node', 'functional.json');
  try { if (existsSync(p)) rmSync(p); } catch { /* ignore */ }
  build(root);
  console.log('thunder-node: couche fonctionnelle réinitialisée');
}

function cmdEvidence(root, ctxId) {
  const { model } = build(root);
  const ctx = model.contexts.find((c) => c.id === ctxId);
  if (!ctx) { console.error(`unknown context: ${ctxId}`); process.exit(1); }
  console.log(JSON.stringify(buildEvidence(ctx, root)));
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function cmdSetFunctional(root, ctxId) {
  const { model } = build(root);
  let data;
  try { data = JSON.parse(await readStdin()); } catch (e) { console.error('invalid JSON:', e.message); process.exit(1); }
  const entry = setFunctional(root, model, ctxId, data);
  build(root);
  console.log(`thunder-node: fonctionnel mis à jour pour ${ctxId} (evidence_hash ${entry.evidence_hash})`);
}

function cmdModuleEvidence(root, name) {
  const { model, functional } = build(root);
  const ctxs = model.contexts.filter((c) => c.project === name);
  if (!ctxs.length) { console.error(`unknown project: ${name}`); process.exit(1); }
  const contexts = ctxs.map((c) => ({ id: c.id, name: functional[c.id]?.name || c.name, purpose: functional[c.id]?.purpose || null, capabilities: functional[c.id]?.capabilities || [] }));
  console.log(JSON.stringify({ project: name, contexts, context_hash: moduleContextHash(model, name, functional) }));
}

async function cmdSetModuleFunctional(root, name) {
  const { model } = build(root);
  let data;
  try { data = JSON.parse(await readStdin()); } catch (e) { console.error('invalid JSON:', e.message); process.exit(1); }
  const entry = setModuleFunctional(root, model, name, data);
  build(root);
  console.log(`thunder-node: project theme updated for ${name}${entry.theme ? ` ("${entry.theme}")` : ''}`);
}

/**
 * Deterministic, self-sufficient retrieval (INLINE — no sub-agent). One payload:
 * ranked top-N feature cards + the #1 hit enriched (business_rules + route flows) + routes of shown contexts.
 */
function cmdAsk(root, query, topOverride, factsMode = false) {
  if (!query) { console.error('usage: ask "<keywords>" [--top N] [--facts] <root>'); process.exit(1); }
  const { model, functional } = build(root);
  // Tier-3: hash-validated answer cache. A fresh prior answer is relayed with ~0 retrieval/reasoning;
  // any source change flips a dep's src_hash → STALE → falls through to normal retrieval below.
  if (!factsMode) {
    const byId = new Map(model.contexts.map((c) => [c.id, c.src_hash]));
    const hit = ledger.lookup(cacheDir(root), query, {
      srcHashOf: (id) => byId.get(id) ?? null, engineHash: readManifest(root).engineHash,
    });
    if (hit && hit.fresh) {
      if (debug.debugEnabled(root, fwOf(root))) {
        const depFiles = (hit.entry.deps || []).flatMap((d) => model.contexts.find((c) => c.id === d.ctx)?.files || []);
        debug.trace(root, fwOf(root), { plugin: cacheDir(root).split(/[\\/]/).pop(), op: 'ask:cache-hit', detail: query, thunder: debug.tok(Buffer.byteLength(hit.entry.a)), baseline: debug.rawTokens(root, depFiles) });
      }
      process.stdout.write(`# tier-3 cached answer (fresh, score ${hit.score.toFixed(2)})\n${hit.entry.a}\n`); return;
    }
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const mods = functional.__modules__ || {};
  const scored = [];
  for (const c of model.contexts) {
    const f = functional[c.id] || {};
    const mod = mods[c.module] || {};
    const hay = [c.id, f.name || c.name, f.purpose || '', ...(f.capabilities || []), mod.theme || '', ...(mod.keywords || []), ...c.components.map((cp) => cp.n), ...Object.keys(c.services), ...c.routes.map((r) => r.path)].join(' ').toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score++;
    if (score) scored.push({ c, f, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));

  // R5.2: conceptual query that matches no card → fall back to the project brief
  if (!scored.length) {
    const brief = join(root, '.thunder', 'node', 'project-brief.yaml');
    try { process.stdout.write(`# no card matched "${query}" — project brief (overview):\n` + readFileSync(brief, 'utf8')); }
    catch { console.log(dump({ query, matched: 0, hint: 'no match; read project-brief.yaml' })); }
    return;
  }
  // adaptive ranking: a dominant #1 hit (≥2× the #2 score) → top-1; otherwise top-3. `--top N` forces.
  let top = topOverride;
  if (top == null) top = (scored.length <= 1 || (scored[0].score >= 2 * (scored[1]?.score || 0))) ? 1 : 3;
  const sel = scored.slice(0, top);

  // --facts: lean payload for a punctual factual question — only rules + route signatures.
  if (factsMode) {
    const facts = sel.map(({ c, f, score }) => ({
      score, id: c.id,
      ...(f.business_rules ? { business_rules: f.business_rules } : {}),
      endpoints: c.routes.map((r) => `${r.verb ? r.verb + ' ' : ''}${r.path || '/'} → ${r.target || r.kind}`),
    }));
    console.log(dump({ query, matched: scored.length, facts }));
    return;
  }
  const cards = sel.map(({ c, f, score }, i) => ({
    score, id: c.id, name: f.name || c.name, framework: c.framework, purpose: f.purpose || null,
    ...(f.capabilities ? { capabilities: f.capabilities } : {}),
    controllers: c.components.map((cp) => cp.n),
    services: Object.keys(c.services),
    endpoints: c.routes.map((r) => `${r.verb ? r.verb + ' ' : ''}${r.path || '/'} → ${r.target || r.kind}`),
    ...(i === 0 && f.business_rules ? { business_rules: f.business_rules } : {}),
    ...(i === 0 ? { flows: c.routes.map((r) => r.flow).filter(Boolean) } : {}),
    detail: `projects/${c.project}/${c.packages.join(',')}.yaml`,
  }));
  const shownIds = new Set(sel.map((s) => s.c.id));
  const endpoints = model.routes.filter((r) => shownIds.has(r.ctx)).map((r) => ({ verb: r.verb, path: r.path, handler: r.target }));
  const payload = dump({ query, matched: scored.length, shown: cards.length, cards, endpoints });
  if (debug.debugEnabled(root, fwOf(root))) debug.trace(root, fwOf(root), { plugin: cacheDir(root).split(/[\\/]/).pop(), op: 'ask:index', detail: query, thunder: debug.tok(Buffer.byteLength(payload)), baseline: debug.rawTokens(root, sel.flatMap((s) => s.c.files)) });
  console.log(payload);
}

/** `ask --detail <id>`: print the detail shard directly. */
function cmdAskDetail(root, ctxId) {
  if (!ctxId) { console.error('usage: ask --detail <ctxId> <root>'); process.exit(1); }
  build(root);
  const [proj, feat] = ctxId.split('/');
  const p = join(root, '.thunder', 'node', 'projects', proj || '', (feat || '') + '.yaml');
  try { process.stdout.write(readFileSync(p, 'utf8')); }
  catch { console.error(`no detail shard for ${ctxId}`); process.exit(1); }
}

function cmdSym(root, sub, name) {
  if (!name) { console.error('usage: sym <def|refs> <Name>'); process.exit(1); }
  const cache = readCache(root);
  const hits = [];
  for (const fact of cache.values()) {
    for (const t of (fact.types || [])) {
      if (sub === 'def') {
        if (t.name === name) hits.push(`${t.kind} ${t.name}  ${fact.file}:${t.line}`);
        for (const m of (t.methods || [])) if (m.name === name) hits.push(`method ${t.name}.${m.name}${m.sig}  ${fact.file}:${m.line}`);
      } else {
        const hay = [t.ext, t.impls, ...(t.ctorDeps || []), ...(t.methods || []).map((m) => m.sig), ...(t.props || []).map((p) => p.type)].filter(Boolean);
        if (t.name !== name && hay.some((s) => new RegExp(`\\b${name}\\b`).test(s))) hits.push(`${t.name}  ${fact.file}:${t.line}`);
      }
    }
    // functional guards / interceptors / resolvers are symbols too
    for (const fn of (fact.functionals || [])) {
      if (sub === 'def') { if (fn.name === name) hits.push(`${fn.kind} ${fn.name}  ${fact.file}:${fn.line}`); }
      else if (fn.name !== name && (fn.deps || []).includes(name)) hits.push(`${fn.kind} ${fn.name}  ${fact.file}:${fn.line}  (injects ${name})`);
    }
  }
  if (!hits.length) console.log(`(aucun résultat pour ${name})`);
  else hits.forEach((h) => console.log(h));
}

/** Persist an index-derived answer into the Tier-3 ledger. Answer text is read from stdin. */
async function cmdCacheAnswer(root, q, ctxCsv, scope) {
  if (!q || !ctxCsv) { console.error('usage: cache-answer --q "<question>" --ctx <id,id> [--scope <s>] <root>  (answer on stdin)'); process.exit(1); }
  const { model } = build(root);
  const byId = new Map(model.contexts.map((c) => [c.id, c.src_hash]));
  const deps = ctxCsv.split(',').map((s) => s.trim()).filter(Boolean)
    .map((id) => ({ ctx: id, h: byId.get(id) ?? null }));
  const missing = deps.filter((d) => d.h == null).map((d) => d.ctx);
  if (missing.length) { console.error(`unknown context(s): ${missing.join(', ')}`); process.exit(1); }
  const answer = (await readStdin()).trim();
  if (!answer) { console.error('empty answer on stdin — nothing cached'); process.exit(1); }
  ledger.writeAnswer(cacheDir(root), { q, answer, deps, scope: scope || null, engine: readManifest(root).engineHash });
  console.log(`cached: "${q}" (${deps.length} dep(s))`);
}
function cmdCacheGc(root) { const r = ledger.gc(cacheDir(root), { engineHash: readManifest(root).engineHash }); console.log(`ledger gc: kept ${r.kept}, dropped ${r.dropped}`); }
function cmdCacheStats(root) { console.log(dump({ ledger: ledger.stats(cacheDir(root)) })); }
/** Prune a verbose blob (stdin or file) — keep head/tail/diagnostics, elide the middle. */
async function cmdPrune(file) {
  const text = file ? readFileSync(file, 'utf8') : await readStdin();
  const r = prune(text);
  const root = process.cwd();
  if (debug.debugEnabled(root, fwOf(root))) debug.trace(root, fwOf(root), { plugin: 'thunder', op: 'prune', detail: file || 'stdin', thunder: debug.tok(Buffer.byteLength(r.out)), baseline: debug.tok(Buffer.byteLength(text)) });
  process.stdout.write(r.out + (r.out.endsWith('\n') ? '' : '\n'));
  if (r.elided) process.stderr.write(`# pruned ${r.total}→${r.kept} lines (${r.elided} elided)\n`);
}

async function selftest() {
  const assert = (await import('node:assert')).default;
  const demo = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo');
  const { model } = build(demo);
  const ctx = (id) => model.contexts.find((c) => c.id.endsWith(id));
  const ep = (verb, path) => model.routes.find((r) => r.verb === verb && r.path === path);

  assert.ok(model.routes.length >= 9, 'endpoints found across frameworks');

  // NestJS feature: controller endpoints + constructor DI + service
  const users = ctx('users');
  assert.ok(users, 'users context');
  assert.equal(users.framework, 'nestjs', 'nestjs detected');
  const ctrl = users.components.find((c) => c.n === 'UsersController');
  assert.ok(ctrl && ctrl.basePath === 'users', 'UsersController with basePath');
  assert.deepStrictEqual(ctrl.deps, ['UsersService'], 'controller injects UsersService');
  assert.ok(users.services.UsersService, 'UsersService');
  assert.ok(ep('GET', '/users') && ep('POST', '/users') && ep('DELETE', '/users/:id'), 'NestJS endpoints');
  assert.match(ep('GET', '/users').flow, /GET \/users → UsersController.findAll → UsersService/, 'flow');

  // Express + Fastify features
  assert.equal(ctx('orders').framework, 'express', 'express detected');
  assert.ok(ep('GET', '/orders') && ep('DELETE', '/orders/:id'), 'Express endpoints');
  assert.equal(ctx('health').framework, 'fastify', 'fastify detected');
  assert.ok(ep('GET', '/health'), 'Fastify endpoint');

  console.log('✅ selftest OK —', model.routes.length, 'endpoints,', model.contexts.length, 'contextes, frameworks:',
    [...new Set(model.contexts.map((c) => c.framework))].sort().join('/'));
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const VALUE_FLAGS = new Set(['--root', '--top', '--q', '--ctx', '--scope', '--limit', '--out']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));
const cmd = pos[0] || 'build';
const rootArg = (() => { const i = argv.indexOf('--root'); return i >= 0 ? argv[i + 1] : null; })();
const R = (p) => resolve(rootArg || p || process.cwd());
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (flags.has('--selftest')) {
  selftest().catch((e) => { console.error('❌ selftest FAILED:', e.message); process.exit(1); });
} else {
  switch (cmd) {
    case 'build': cmdBuild(R(pos[1]), flags.has('--force')); break;
    case 'init': cmdInit(R(pos[1])); break;                       // init [root] — opt this project in
    case 'ensure': cmdEnsure(R(pos[1])); break;
    case 'overview': cmdOverview(R(pos[1])); break;
    case 'routes': cmdRoutes(R(pos[1])); break;
    case 'ask':
      if (flags.has('--detail')) cmdAskDetail(R(pos[2]), pos[1]);
      else cmdAsk(R(pos[2]), pos[1], (() => { const i = argv.indexOf('--top'); return i >= 0 ? Number(argv[i + 1]) || 3 : undefined; })(), flags.has('--facts'));
      break;
    case 'stale': cmdStale(R(pos[1]), flags.has('--json')); break;
    case 'stale-modules': cmdStaleModules(R(pos[1]), flags.has('--json')); break;
    case 'reset-functional': cmdResetFunctional(R(pos[1])); break;
    case 'touch': cmdTouch(R(pos[2]), pos[1]); break;
    case 'evidence': cmdEvidence(R(pos[2]), pos[1]); break;
    case 'evidence-batch': cmdEvidenceBatch(R(pos[1]), Number(flagVal('--limit')) || 0, flagVal('--out')); break;
    case 'set-functional': cmdSetFunctional(R(pos[2]), pos[1]); break;
    case 'set-functional-batch': cmdSetFunctionalBatch(R(pos[1])); break;
    case 'module-evidence': cmdModuleEvidence(R(pos[2]), pos[1]); break;
    case 'set-module-functional': cmdSetModuleFunctional(R(pos[2]), pos[1]); break;
    case 'sym': cmdSym(R(pos[3]), pos[1], pos[2]); break;
    case 'cache-answer': cmdCacheAnswer(R(pos[1]), flagVal('--q'), flagVal('--ctx'), flagVal('--scope')); break;
    case 'cache-gc': cmdCacheGc(R(pos[1])); break;
    case 'cache-stats': cmdCacheStats(R(pos[1])); break;
    case 'prune': cmdPrune(pos[1]); break;
    default: console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}
