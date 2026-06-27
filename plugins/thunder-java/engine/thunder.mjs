#!/usr/bin/env node
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './lib/build.mjs';
import { dump } from './lib/yaml.mjs';
import { appendDirty, drainDirty, cacheDir, readManifest, ensureDir, projectConfig, isInitialized } from './lib/cache.mjs';
import * as ledger from './lib/common/ledger.mjs';
import { prune } from './lib/common/prune.mjs';
import * as debug from './lib/common/debug.mjs';
const fwOf = (root) => cacheDir(root).split(/[\\/]/).pop().replace(/^thunder-/, '');
import {
  buildEvidence, staleContexts, setFunctional,
  staleModules, setModuleFunctional, moduleContextHash,
} from './lib/functional.mjs';

// ---- commands -------------------------------------------------------------

/**
 * Deterministic, self-sufficient retrieval (INLINE — no sub-agent). One payload:
 * ranked top-N context cards + the #1 hit enriched (business_rules + flows) + matching endpoints.
 * Answer from this directly; do NOT also load index.yaml or individual card files.
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
    const hay = [c.id, f.name || c.name, f.purpose || '', ...(f.capabilities || []), mod.theme || '', ...(mod.keywords || []), ...c.types.map((t) => t.n), ...c.endpoints.map((e) => e.path)].join(' ').toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score++;
    if (score) scored.push({ c, f, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));

  // R5.2: conceptual query that matches no card → fall back to the project brief, not an empty payload
  if (!scored.length) {
    const brief = join(root, '.thunder', 'java', 'project-brief.yaml');
    try { process.stdout.write(`# no card matched "${query}" — project brief (overview):\n` + readFileSync(brief, 'utf8')); }
    catch { console.log(dump({ query, matched: 0, hint: 'no match; read project-brief.yaml' })); }
    return;
  }
  // adaptive ranking: a dominant #1 hit (≥2× the #2 score) → top-1; otherwise top-3. `--top N` forces.
  let top = topOverride;
  if (top == null) top = (scored.length <= 1 || (scored[0].score >= 2 * (scored[1]?.score || 0))) ? 1 : 3;
  const sel = scored.slice(0, top);

  // --facts: lean payload for a punctual factual question — only rules + endpoint signatures.
  if (factsMode) {
    const facts = sel.map(({ c, f, score }) => ({
      score, id: c.id,
      ...(f.business_rules ? { business_rules: f.business_rules } : {}),
      endpoints: c.endpoints.map((e) => `${e.verb} ${e.path}${e.req ? ' <- ' + e.req : ''}${e.resp ? ' -> ' + e.resp : ''}`),
    }));
    console.log(dump({ query, matched: scored.length, facts }));
    return;
  }
  const cards = sel.map(({ c, f, score }, i) => ({
    score, id: c.id, name: f.name || c.name, purpose: f.purpose || null,
    ...(f.capabilities ? { capabilities: f.capabilities } : {}),
    types: c.types.map((t) => t.n),
    endpoints: c.endpoints.map((e) => `${e.verb} ${e.path}`),
    beans: Object.keys(c.beans).length, entities: Object.keys(c.entities).length,
    // enrich the #1 hit so the question is answerable WITHOUT a follow-up read
    ...(i === 0 && f.business_rules ? { business_rules: f.business_rules } : {}),
    ...(i === 0 ? { flows: c.endpoints.map((e) => e.flow).filter(Boolean) } : {}),
    detail: `modules/${c.module}/${c.packages.join(',')}.yaml`,
  }));
  // endpoints of the SHOWN contexts only — keeps the payload bounded at scale (no global dump)
  const shownIds = new Set(sel.map((s) => s.c.id));
  const endpoints = model.endpoints
    .filter((e) => shownIds.has(e.ctx))
    .map((e) => ({ verb: e.verb, path: e.path, fn: e.fn, ...(e.req ? { req: e.req } : {}), ...(e.resp ? { resp: e.resp } : {}) }));
  const payload = dump({ query, matched: scored.length, shown: cards.length, cards, endpoints });
  if (debug.debugEnabled(root, fwOf(root))) debug.trace(root, fwOf(root), { plugin: cacheDir(root).split(/[\\/]/).pop(), op: 'ask:index', detail: query, thunder: debug.tok(Buffer.byteLength(payload)), baseline: debug.rawTokens(root, sel.flatMap((s) => s.c.files)) });
  console.log(payload);
}

/** `ask --detail <id>`: print the detail shard directly (avoids a separate locate call). */
function cmdAskDetail(root, ctxId) {
  if (!ctxId) { console.error('usage: ask --detail <ctxId> <root>'); process.exit(1); }
  build(root);
  const [mod, pkg] = ctxId.split('/');
  const p = join(root, '.thunder', 'java', 'modules', mod || '', (pkg || '') + '.yaml');
  try { process.stdout.write(readFileSync(p, 'utf8')); }
  catch { console.error(`no detail shard for ${ctxId}`); process.exit(1); }
}

function cmdBuild(root, force) {
  const t0 = process.hrtime.bigint();
  const r = build(root, { force });
  if (r.total > 0 && !isInitialized(root)) writeFileSync(projectConfig(root), INIT_CONFIG); // explicit build opts this project in
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`thunder: ${r.total} fichiers (${r.parsed} parsés, ${r.reused} réutilisés, ${r.errors} erreurs)` +
    `${r.engineBust ? ' [cache invalidé: moteur modifié ou --force]' : ''} → ` +
    `${r.model.modules.length} modules, ${r.model.contexts.length} contextes, ${r.model.endpoints.length} endpoints · ${r.changed} shards écrits · ${ms.toFixed(0)}ms`);
}

const INIT_CONFIG = `# thunder-java — committed project marker. Its presence turns indexing ON for this project.
# Without it, thunder-java stays completely idle (no .thunder/java/ dir, no tokens spent).
enabled: true
language: java
`;

// Opt-in marker: thunder-java only indexes a project once `init` has been run there
// (committed .thunder/java/config.yaml). This keeps it idle on unrelated projects.
function cmdInit(root) {
  const cfg = projectConfig(root);
  const already = existsSync(cfg);
  ensureDir(cacheDir(root));
  if (!already) writeFileSync(cfg, INIT_CONFIG);
  drainDirty(root);
  const r = build(root, { force: true });
  if (r.total === 0) {
    console.log(`thunder-java: initialized (${cfg}) — no Java sources found yet; the index will fill as you add them.`);
    return;
  }
  console.log(`thunder-java: ${already ? 're-' : ''}initialized & indexed (${r.total} files) under .thunder/java/ — commit it to share. Run /thunder-java:thunder-java-reindex to infer the functional layer.`);
}

function cmdEnsure(root) {
  if (!isInitialized(root)) return; // opt-in: idle until `thunder-java-init` runs on this project
  drainDirty(root);
  const r = build(root);
  if (r.total === 0) return; // not a Java/Maven project — stay silent (hook runs everywhere)
  console.log(`thunder: index frais (${r.model.modules.length} modules, ${r.model.contexts.length} contextes, ${r.model.endpoints.length} endpoints). /thunder-java:thunder-java-codemap pour explorer.`);
}

function cmdTouch(root, file) {
  if (file) appendDirty(root, file);
}

function cmdOverview(root) {
  const { model } = build(root);
  console.log(`# ${model.modules.length} modules · ${model.contexts.length} contextes · ${model.endpoints.length} endpoints\n`);
  for (const c of model.contexts) {
    console.log(`${c.id}  (${c.fileCount} fichiers, ${c.endpoints.length} endpoints, ${Object.keys(c.beans).length} beans, ${Object.keys(c.entities).length} entités)`);
  }
}

function cmdEndpoints(root) {
  const { model } = build(root);
  for (const e of model.endpoints) console.log(`${e.verb.padEnd(6)} ${e.path.padEnd(28)} ${e.fn}`);
}

// ---- functional layer commands (driven by the cartographer agent / reindex skill) ----

function cmdStale(root, asJson) {
  const { model, functional } = build(root);
  const stale = staleContexts(model, root, functional);
  if (asJson) { console.log(JSON.stringify(stale)); return; }
  if (!stale.length) { console.log('thunder: couche fonctionnelle à jour (0 contexte périmé)'); return; }
  console.log(`thunder: ${stale.length} contexte(s) à (ré)inférer :`);
  for (const s of stale) console.log(`  ${s.id}  [${s.reason}]`);
}

function cmdResetFunctional(root) {
  const p = join(root, '.thunder', 'java', 'functional.json');
  try { if (existsSync(p)) rmSync(p); } catch { /* ignore */ }
  build(root);
  console.log('thunder: couche fonctionnelle réinitialisée (tous les contextes redeviennent à inférer)');
}

function cmdEvidence(root, ctxId) {
  const { model } = build(root);
  const ctx = model.contexts.find((c) => c.id === ctxId);
  if (!ctx) { console.error(`unknown context: ${ctxId}`); process.exit(1); }
  console.log(JSON.stringify(buildEvidence(ctx, root)));
}

async function cmdSetFunctional(root, ctxId) {
  const { model } = build(root);
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e) { console.error('invalid JSON on stdin:', e.message); process.exit(1); }
  const entry = setFunctional(root, model, ctxId, data);
  build(root); // re-emit shards with merged functional data
  console.log(`thunder: fonctionnel mis à jour pour ${ctxId} (evidence_hash ${entry.evidence_hash})`);
}

function cmdStaleModules(root, asJson) {
  const { model, functional } = build(root);
  const stale = staleModules(model, root, functional);
  if (asJson) { console.log(JSON.stringify(stale)); return; }
  if (!stale.length) { console.log('thunder: module themes up to date'); return; }
  console.log(`thunder: ${stale.length} module theme(s) to (re)infer:`);
  for (const s of stale) console.log(`  ${s.module}  [${s.reason}]`);
}

function cmdModuleEvidence(root, moduleName) {
  const { model, functional } = build(root);
  const ctxs = model.contexts.filter((c) => c.module === moduleName);
  if (!ctxs.length) { console.error(`unknown module: ${moduleName}`); process.exit(1); }
  const contexts = ctxs.map((c) => {
    const f = functional[c.id] || {};
    return { id: c.id, name: f.name || c.name, purpose: f.purpose || null, capabilities: f.capabilities || [] };
  });
  console.log(JSON.stringify({ module: moduleName, contexts, context_hash: moduleContextHash(model, moduleName, functional) }));
}

async function cmdSetModuleFunctional(root, moduleName) {
  const { model } = build(root);
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e) { console.error('invalid JSON on stdin:', e.message); process.exit(1); }
  const entry = setModuleFunctional(root, model, moduleName, data);
  build(root);
  console.log(`thunder: module theme updated for ${moduleName}${entry.theme ? ` ("${entry.theme}")` : ''}`);
}

function cmdSym(root, sub, name) {
  const { model } = build(root);
  if (!name) { console.error('usage: sym <def|refs> <Name>'); process.exit(1); }
  const hits = [];
  for (const c of model.contexts) {
    for (const t of c.types) {
      if (sub === 'def') {
        if (t.n === name) hits.push(`${t.k} ${t.n}  ${t.file}:${t.l}`);
        for (const m of t.methods) if (m.n === name) hits.push(`method ${t.n}.${m.n}${m.sig}  ${t.file}:${m.l}`);
      } else { // refs: textual mentions in signatures, fields, extends
        const inType = [t.ext, ...t.methods.map((m) => m.sig), ...t.fields.map((f) => f.t)]
          .filter(Boolean).some((s) => new RegExp(`\\b${name}\\b`).test(s));
        if (inType && t.n !== name) hits.push(`${t.n}  ${t.file}:${t.l}`);
      }
    }
  }
  if (!hits.length) console.log(`(aucun résultat pour ${name})`);
  else hits.forEach((h) => console.log(h));
}

function cmdConfig(root) {
  const { model } = build(root);
  const out = [];
  for (const c of model.contexts) {
    for (const t of c.types) {
      if ((t.ann || []).some((a) => /@ConfigurationProperties/.test(a))) {
        const prefix = (t.ann.find((a) => /@ConfigurationProperties/.test(a)) || '').match(/"([^"]*)"/);
        out.push(`@ConfigurationProperties ${prefix ? prefix[1] : ''}  ${t.n}  ${t.file}`);
      }
      for (const f of t.fields) for (const a of (f.ann || [])) {
        if (/@Value/.test(a)) out.push(`@Value ${a.replace(/@Value/, '').trim()}  ${t.n}.${f.n}  ${t.file}`);
      }
    }
  }
  if (!out.length) console.log('(aucune propriété de configuration détectée)');
  else out.forEach((l) => console.log(l));
}

// ---- selftest -------------------------------------------------------------

async function readStdinAll() { const chunks = []; for await (const c of process.stdin) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); }
/** Persist an index-derived answer into the Tier-3 ledger. Answer text is read from stdin. */
async function cmdCacheAnswer(root, q, ctxCsv, scope) {
  if (!q || !ctxCsv) { console.error('usage: cache-answer --q "<question>" --ctx <id,id> [--scope <s>] <root>  (answer on stdin)'); process.exit(1); }
  const { model } = build(root);
  const byId = new Map(model.contexts.map((c) => [c.id, c.src_hash]));
  const deps = ctxCsv.split(',').map((s) => s.trim()).filter(Boolean).map((id) => ({ ctx: id, h: byId.get(id) ?? null }));
  const missing = deps.filter((d) => d.h == null).map((d) => d.ctx);
  if (missing.length) { console.error(`unknown context(s): ${missing.join(', ')}`); process.exit(1); }
  const answer = (await readStdinAll()).trim();
  if (!answer) { console.error('empty answer on stdin — nothing cached'); process.exit(1); }
  ledger.writeAnswer(cacheDir(root), { q, answer, deps, scope: scope || null, engine: readManifest(root).engineHash });
  console.log(`cached: "${q}" (${deps.length} dep(s))`);
}
function cmdCacheGc(root) { const r = ledger.gc(cacheDir(root), { engineHash: readManifest(root).engineHash }); console.log(`ledger gc: kept ${r.kept}, dropped ${r.dropped}`); }
function cmdCacheStats(root) { console.log(dump({ ledger: ledger.stats(cacheDir(root)) })); }
/** Prune a verbose blob (stdin or file) — keep head/tail/diagnostics, elide the middle. */
async function cmdPrune(file) {
  const text = file ? readFileSync(file, 'utf8') : await readStdinAll();
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
  const eps = model.endpoints;
  const ep = (verb, path) => eps.find((e) => e.verb === verb && e.path === path);

  assert.strictEqual(model.contexts.length, 2, 'expected 2 contexts');
  assert.deepStrictEqual(model.modules.sort(), ['order', 'user'], 'modules');
  assert.ok(ep('POST', '/users'), 'POST /users');
  assert.ok(ep('GET', '/users/{email}'), 'GET /users/{email}');
  assert.ok(ep('POST', '/orders'), 'POST /orders');
  assert.ok(ep('GET', '/orders/by-user/{userId}'), 'GET /orders/by-user/{userId}');

  const userCtx = model.contexts.find((c) => c.id.includes('user'));
  assert.ok(userCtx.beans.UserService, 'UserService bean');
  assert.deepStrictEqual(userCtx.beans.UserService.deps, ['UserRepository'], 'ctor injection deps');
  assert.ok(userCtx.entities.User, 'User entity');
  assert.strictEqual(userCtx.entities.User.repo, 'UserRepository', 'User repo link');
  assert.deepStrictEqual(userCtx.entities.User.rel, [{ OneToMany: 'Order' }], 'User->Order relation');

  const orderCtx = model.contexts.find((c) => c.id.includes('order'));
  assert.deepStrictEqual(orderCtx.beans.OrderService.deps, ['OrderRepository'], '@Autowired field injection');
  assert.strictEqual(orderCtx.entities.Order.repo, 'OrderRepository', 'Order repo link');

  // lexer survived text block / braces-in-string / braces-in-comment
  const svc = userCtx.types.find((t) => t.n === 'UserService');
  assert.ok(svc.methods.some((m) => m.n === 'register' && m.sig === '(UserDto):User'), 'register sig');
  assert.ok(svc.methods.some((m) => m.n === 'describe'), 'describe (after text block) parsed');
  assert.ok(!userCtx.types.some((t) => t.n === 'Utilisateur'), 'no phantom type from text block');

  // flow derived from wiring
  const create = ep('POST', '/users');
  assert.ok(/UserController\.create → UserService → UserRepository/.test(create.flow), `flow: ${create.flow}`);

  console.log('✅ selftest OK —', eps.length, 'endpoints,', model.contexts.length, 'contextes, lexer robuste');
}

// ---- entry ----------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const VALUE_FLAGS = new Set(['--root', '--top', '--q', '--ctx', '--scope']); // their following token is a value, not a positional
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const cmd = pos[0] || 'build';
const rootArg = (() => {
  const i = argv.indexOf('--root');
  if (i >= 0) return argv[i + 1];
  return null;
})();

// Root is resolved per command: --root wins, else the documented positional, else cwd.
const R = (positional) => resolve(rootArg || positional || process.cwd());

if (flags.has('--selftest')) {
  selftest().catch((e) => { console.error('❌ selftest FAILED:', e.message); process.exit(1); });
} else {
  switch (cmd) {
    case 'build': cmdBuild(R(pos[1]), flags.has('--force')); break; // build [root] [--force]
    case 'init': cmdInit(R(pos[1])); break;                       // init [root] — opt this project in
    case 'ensure': cmdEnsure(R(pos[1])); break;                     // ensure [root]
    case 'overview': cmdOverview(R(pos[1])); break;                 // overview [root]
    case 'endpoints': cmdEndpoints(R(pos[1])); break;              // endpoints [root]
    case 'stale': cmdStale(R(pos[1]), flags.has('--json')); break; // stale [root]
    case 'stale-modules': cmdStaleModules(R(pos[1]), flags.has('--json')); break; // stale-modules [root]
    case 'reset-functional': cmdResetFunctional(R(pos[1])); break; // reset-functional [root]
    case 'module-evidence': cmdModuleEvidence(R(pos[2]), pos[1]); break; // module-evidence <module> [root]
    case 'set-module-functional': cmdSetModuleFunctional(R(pos[2]), pos[1]); break; // set-module-functional <module> [root]
    case 'config': cmdConfig(R(pos[1])); break;                    // config [root]
    case 'touch': cmdTouch(R(pos[2]), pos[1]); break;              // touch <file> [root]
    case 'evidence': cmdEvidence(R(pos[2]), pos[1]); break;        // evidence <ctxId> [root]
    case 'set-functional': cmdSetFunctional(R(pos[2]), pos[1]); break; // set-functional <ctxId> [root]
    case 'sym': cmdSym(R(pos[3]), pos[1], pos[2]); break;          // sym <def|refs> <Name> [root]
    case 'cache-answer': cmdCacheAnswer(R(pos[1]), flagVal('--q'), flagVal('--ctx'), flagVal('--scope')); break;
    case 'cache-gc': cmdCacheGc(R(pos[1])); break;
    case 'cache-stats': cmdCacheStats(R(pos[1])); break;
    case 'prune': cmdPrune(pos[1]); break;
    case 'ask':                                                    // ask "<keywords>" [--top N] [root]  |  ask --detail <id> [root]
      if (flags.has('--detail')) cmdAskDetail(R(pos[2]), pos[1]);
      else cmdAsk(R(pos[2]), pos[1], (() => { const i = argv.indexOf('--top'); return i >= 0 ? Number(argv[i + 1]) || 3 : undefined; })(), flags.has('--facts'));
      break;
    default: console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}
