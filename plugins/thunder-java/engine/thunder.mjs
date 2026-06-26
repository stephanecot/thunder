#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './lib/build.mjs';
import { appendDirty, drainDirty } from './lib/cache.mjs';
import {
  buildEvidence, staleContexts, setFunctional,
  staleModules, setModuleFunctional, moduleContextHash,
} from './lib/functional.mjs';

// ---- commands -------------------------------------------------------------

function cmdBuild(root) {
  const t0 = process.hrtime.bigint();
  const r = build(root);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`thunder: ${r.total} fichiers (${r.parsed} parsés, ${r.reused} réutilisés, ${r.errors} erreurs) → ` +
    `${r.model.modules.length} modules, ${r.model.contexts.length} contextes, ${r.model.endpoints.length} endpoints · ${r.changed} shards écrits · ${ms.toFixed(0)}ms`);
}

function cmdEnsure(root) {
  drainDirty(root);
  const r = build(root);
  if (r.total === 0) return; // not a Java/Maven project — stay silent (hook runs everywhere)
  console.log(`thunder: index frais (${r.model.modules.length} modules, ${r.model.contexts.length} contextes, ${r.model.endpoints.length} endpoints). /thunder-java:codemap pour explorer.`);
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
  const p = join(root, '.claude', 'cache', 'thunder-java', 'functional.json');
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
const pos = argv.filter((a) => !a.startsWith('--'));
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
    case 'build': cmdBuild(R(pos[1])); break;                       // build [root]
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
    default: console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}
