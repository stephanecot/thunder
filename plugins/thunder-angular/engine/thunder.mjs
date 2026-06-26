#!/usr/bin/env node
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './lib/build.mjs';
import { dump } from './lib/yaml.mjs';
import { appendDirty, drainDirty, readCache } from './lib/cache.mjs';
import {
  buildEvidence, staleContexts, setFunctional,
  staleModules, setModuleFunctional, moduleContextHash,
} from './lib/functional.mjs';

function cmdBuild(root) {
  const t0 = process.hrtime.bigint();
  const r = build(root);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`thunder-angular: ${r.total} fichiers (${r.parsed} parsés, ${r.reused} réutilisés, ${r.errors} erreurs) → ` +
    `${r.model.projects.length} projets, ${r.model.contexts.length} contextes, ${r.model.routes.length} routes · ${r.changed} shards · ${ms.toFixed(0)}ms`);
}

function cmdEnsure(root) {
  drainDirty(root);
  const r = build(root);
  if (r.total === 0) return;
  console.log(`thunder-angular: index frais (${r.model.projects.length} projets, ${r.model.contexts.length} contextes, ${r.model.routes.length} routes). /thunder-angular:thunder-angular-codemap pour explorer.`);
}

const cmdTouch = (root, file) => { if (file) appendDirty(root, file); };

function cmdOverview(root) {
  const { model } = build(root);
  console.log(`# ${model.projects.length} projets · ${model.contexts.length} contextes · ${model.routes.length} routes\n`);
  for (const c of model.contexts) {
    console.log(`${c.id}  (${c.fileCount} fichiers, ${c.components.length} composants, ${Object.keys(c.services).length} services, ${c.routes.length} routes)`);
  }
}

function cmdRoutes(root) {
  const { model } = build(root);
  for (const r of model.routes) console.log(`${('/' + (r.path || '')).padEnd(28)} ${r.kind.padEnd(14)} ${r.target || ''}`);
}

function cmdStale(root, asJson) {
  const { model, functional } = build(root);
  const stale = staleContexts(model, root, functional);
  if (asJson) { console.log(JSON.stringify(stale)); return; }
  if (!stale.length) { console.log('thunder-angular: couche fonctionnelle à jour'); return; }
  console.log(`thunder-angular: ${stale.length} contexte(s) à (ré)inférer :`);
  for (const s of stale) console.log(`  ${s.id}  [${s.reason}]`);
}

function cmdStaleModules(root, asJson) {
  const { model, functional } = build(root);
  const stale = staleModules(model, root, functional);
  if (asJson) { console.log(JSON.stringify(stale)); return; }
  if (!stale.length) { console.log('thunder-angular: project themes up to date'); return; }
  for (const s of stale) console.log(`  ${s.module}  [${s.reason}]`);
}

function cmdResetFunctional(root) {
  const p = join(root, '.claude', 'cache', 'thunder-angular', 'functional.json');
  try { if (existsSync(p)) rmSync(p); } catch { /* ignore */ }
  build(root);
  console.log('thunder-angular: couche fonctionnelle réinitialisée');
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
  console.log(`thunder-angular: fonctionnel mis à jour pour ${ctxId} (evidence_hash ${entry.evidence_hash})`);
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
  console.log(`thunder-angular: project theme updated for ${name}${entry.theme ? ` ("${entry.theme}")` : ''}`);
}

/**
 * Deterministic, self-sufficient retrieval (INLINE — no sub-agent). One payload:
 * ranked top-N feature cards + the #1 hit enriched (business_rules + route flows) + routes of shown contexts.
 */
function cmdAsk(root, query, topOverride) {
  if (!query) { console.error('usage: ask "<keywords>" [--top N] <root>'); process.exit(1); }
  const { model, functional } = build(root);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const c of model.contexts) {
    const f = functional[c.id] || {};
    const hay = [c.id, f.name || c.name, f.purpose || '', ...(f.capabilities || []), ...c.components.map((cp) => cp.n), ...Object.keys(c.services), ...c.routes.map((r) => r.path)].join(' ').toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score++;
    if (score) scored.push({ c, f, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  // adaptive ranking: a dominant #1 hit (≥2× the #2 score) → top-1; otherwise top-3. `--top N` forces.
  let top = topOverride;
  if (top == null) top = (scored.length <= 1 || (scored[0].score >= 2 * (scored[1]?.score || 0))) ? 1 : 3;
  const sel = scored.slice(0, top);
  const cards = sel.map(({ c, f, score }, i) => ({
    score, id: c.id, name: f.name || c.name, purpose: f.purpose || null,
    ...(f.capabilities ? { capabilities: f.capabilities } : {}),
    components: c.components.map((cp) => cp.n),
    services: Object.keys(c.services),
    routes: c.routes.map((r) => `${r.path || '/'} → ${r.target || r.kind}`),
    ...(i === 0 && f.business_rules ? { business_rules: f.business_rules } : {}),
    ...(i === 0 ? { flows: c.routes.map((r) => r.flow).filter(Boolean) } : {}),
    detail: `projects/${c.project}/${c.packages.join(',')}.yaml`,
  }));
  const shownIds = new Set(sel.map((s) => s.c.id));
  const routes = model.routes.filter((r) => shownIds.has(r.ctx)).map((r) => ({ path: r.path, target: r.target, kind: r.kind }));
  console.log(dump({ query, matched: scored.length, shown: cards.length, cards, routes }));
}

/** `ask --detail <id>`: print the detail shard directly. */
function cmdAskDetail(root, ctxId) {
  if (!ctxId) { console.error('usage: ask --detail <ctxId> <root>'); process.exit(1); }
  build(root);
  const [proj, feat] = ctxId.split('/');
  const p = join(root, '.claude', 'cache', 'thunder-angular', 'projects', proj || '', (feat || '') + '.yaml');
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
  }
  if (!hits.length) console.log(`(aucun résultat pour ${name})`);
  else hits.forEach((h) => console.log(h));
}

async function selftest() {
  const assert = (await import('node:assert')).default;
  const demo = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo');
  const { model } = build(demo);
  const ctx = (id) => model.contexts.find((c) => c.id.endsWith(id));
  const route = (p) => model.routes.find((r) => r.path === p);

  assert.ok(model.projects.includes('shop'), 'project shop');
  assert.ok(model.routes.length >= 3, 'routes found');
  assert.ok(route('users'), 'route users');
  assert.ok(route('orders'), 'route orders');

  const users = ctx('users');
  assert.ok(users, 'users context');
  const list = users.components.find((c) => c.n === 'UserListComponent');
  assert.ok(list, 'UserListComponent');
  assert.deepStrictEqual(list.deps, ['UserService'], 'component injects UserService');
  assert.ok(users.services.UserService, 'UserService');
  assert.deepStrictEqual(users.services.UserService.deps, ['HttpClient'], 'service injects HttpClient');
  assert.ok(list.inputs.includes('title'), '@Input title');

  // NgModule flavor (orders uses a module)
  const orders = ctx('orders');
  assert.ok(orders.modules.find((m) => m.n === 'OrdersModule'), 'OrdersModule parsed');

  // flow derived from route → component → service
  const r = route('users');
  assert.match(r.flow, /UserListComponent → UserService/, `flow: ${r.flow}`);

  console.log('✅ selftest OK —', model.routes.length, 'routes,', model.contexts.length, 'contextes,', model.projects.length, 'projet(s)');
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const VALUE_FLAGS = new Set(['--root', '--top']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));
const cmd = pos[0] || 'build';
const rootArg = (() => { const i = argv.indexOf('--root'); return i >= 0 ? argv[i + 1] : null; })();
const R = (p) => resolve(rootArg || p || process.cwd());

if (flags.has('--selftest')) {
  selftest().catch((e) => { console.error('❌ selftest FAILED:', e.message); process.exit(1); });
} else {
  switch (cmd) {
    case 'build': cmdBuild(R(pos[1])); break;
    case 'ensure': cmdEnsure(R(pos[1])); break;
    case 'overview': cmdOverview(R(pos[1])); break;
    case 'routes': cmdRoutes(R(pos[1])); break;
    case 'ask':
      if (flags.has('--detail')) cmdAskDetail(R(pos[2]), pos[1]);
      else cmdAsk(R(pos[2]), pos[1], (() => { const i = argv.indexOf('--top'); return i >= 0 ? Number(argv[i + 1]) || 3 : undefined; })());
      break;
    case 'stale': cmdStale(R(pos[1]), flags.has('--json')); break;
    case 'stale-modules': cmdStaleModules(R(pos[1]), flags.has('--json')); break;
    case 'reset-functional': cmdResetFunctional(R(pos[1])); break;
    case 'touch': cmdTouch(R(pos[2]), pos[1]); break;
    case 'evidence': cmdEvidence(R(pos[2]), pos[1]); break;
    case 'set-functional': cmdSetFunctional(R(pos[2]), pos[1]); break;
    case 'module-evidence': cmdModuleEvidence(R(pos[2]), pos[1]); break;
    case 'set-module-functional': cmdSetModuleFunctional(R(pos[2]), pos[1]); break;
    case 'sym': cmdSym(R(pos[3]), pos[1], pos[2]); break;
    default: console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}
