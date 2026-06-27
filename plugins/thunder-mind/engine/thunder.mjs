#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, resetIndex } from './lib/build.mjs';
import { recall } from './lib/recall.mjs';
import { conflicts, evidenceHashes } from './lib/conflicts.mjs';
import { dump } from './lib/yaml.mjs';
import {
  cacheDir, decisionsDir, appendDirty, drainDirty, readManifest, ensureDir,
} from './lib/cache.mjs';
import {
  emitDecision, validateDecision, makeId, fileForId, listDecisionFiles,
  parseDecision, idFromRel,
} from './lib/decision.mjs';
import * as ledger from './lib/common/ledger.mjs';
import { prune } from './lib/common/prune.mjs';
import * as debug from './lib/common/debug.mjs';

// framework key for the per-framework DEBUG config (.thunder/<fw>/.config) — same derivation as the
// other Thunder plugins: cache dir basename without the `thunder-` prefix → "mind".
const fwOf = (root) => cacheDir(root).split(/[\\/]/).pop().replace(/^thunder-/, '');
const relDecisionFiles = (model) => model.decisions.map((d) => `.thunder/mind/decisions/${d.id}.yaml`);

function cmdBuild(root, force) {
  const t0 = process.hrtime.bigint();
  const r = build(root, { force });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`thunder-mind: ${r.total} décision(s) (${r.parsed} parsées, ${r.reused} réutilisées, ${r.errors} erreur(s)) → ` +
    `${r.model.N} décisions · ${r.model.domains.length} domaines · ${ms.toFixed(0)}ms`);
}

function cmdEnsure(root) {
  drainDirty(root);
  if (!existsSync(decisionsDir(root))) return;           // not a thunder-mind project — stay silent
  const r = build(root);
  if (r.total === 0) return;
  const c = conflicts(r.model, root);
  console.log(`thunder-mind: index frais (${r.model.N} décisions, ${r.model.domains.length} domaines` +
    `${c.length ? `, ${c.length} conflit(s)/dérive(s) — /thunder-mind:thunder-mind-review` : ''}). ` +
    `recall AVANT de décider · /thunder-mind:thunder-mind-recall · /thunder-mind:thunder-mind-record`);
  // inject the bounded alignment brief so both devs' AI starts aligned
  try { process.stdout.write('\n' + readFileSync(join(cacheDir(root), 'brief.yaml'), 'utf8')); } catch { /* none */ }
}

const cmdTouch = (root, file) => { if (file) appendDirty(root, file); };

function cmdRecall(root, query, opts) {
  if (!query) { console.error('usage: recall "<keywords>" [--top N] [--domain D] [--all] <root>'); process.exit(1); }
  const { model } = build(root);

  // Tier-3: a fresh prior answer is relayed at ~0 cost; any decision change flips a dep hash → STALE.
  const byId = new Map(model.decisions.map((d) => [d.id, d.id /*hash via deps below*/]));
  const srcHashOf = (id) => model.byId.has(id) ? hashOfDecision(root, id) : null;
  const hit = ledger.lookup(cacheDir(root), query, { srcHashOf, engineHash: model.engineHash });
  if (hit && hit.fresh) {
    if (debug.debugEnabled(root, fwOf(root))) debug.trace(root, fwOf(root), { plugin: 'thunder-mind', op: 'recall:cache-hit', detail: query,
      thunder: debug.tok(Buffer.byteLength(hit.entry.a)), baseline: debug.rawTokens(root, relDecisionFiles(model)) });
    process.stdout.write(`# tier-3 cached answer (fresh, score ${hit.score.toFixed(2)})\n${hit.entry.a}\n`);
    return;
  }

  const res = recall(model, query, opts);
  if (!res.matched) {
    process.stdout.write(`# no decision matched "${query}" — overview:\n`);
    try { process.stdout.write(readFileSync(join(cacheDir(root), 'brief.yaml'), 'utf8')); } catch { console.log(dump({ query, matched: 0 })); }
    return;
  }
  const payload = dump(res);
  if (debug.debugEnabled(root, fwOf(root))) {
    const files = res.cards.map((c) => `.thunder/mind/decisions/${c.id}.yaml`);
    debug.trace(root, fwOf(root), { plugin: 'thunder-mind', op: 'recall', detail: query,
      thunder: debug.tok(Buffer.byteLength(payload)), baseline: debug.rawTokens(root, files) });
  }
  process.stdout.write(payload);
}

function hashOfDecision(root, id) {
  try { return String(readManifest(root).files[`${id}.yaml`] || null); } catch { return null; }
}

function cmdRecallDetail(root, id) {
  if (!id) { console.error('usage: recall --detail <id> <root>'); process.exit(1); }
  const p = fileForId(root, id);
  try { process.stdout.write(readFileSync(p, 'utf8')); }
  catch { console.error(`no decision: ${id}`); process.exit(1); }
}

function cmdBrief(root) {
  build(root);
  try { process.stdout.write(readFileSync(join(cacheDir(root), 'brief.yaml'), 'utf8')); }
  catch { console.log('thunder-mind: no decisions yet'); }
}

function cmdConflicts(root, asJson) {
  const { model } = build(root);
  const c = conflicts(model, root);
  if (asJson) { console.log(JSON.stringify(c)); return; }
  if (!c.length) { console.log('thunder-mind: no conflicts or drift'); return; }
  console.log(`thunder-mind: ${c.length} item(s) to review:`);
  for (const x of c) console.log(`  [${x.type}] ${x.id}${x.ref ? ` → ${x.ref}` : ''}`);
}

function cmdValidate(root, asJson) {
  const files = listDecisionFiles(root);
  const report = [];
  for (const rel of files) {
    let v, parseErr = null;
    try { const d = parseDecision(readFileSync(join(decisionsDir(root), rel), 'utf8')); d.id = idFromRel(rel); if (!d.domain) d.domain = rel.split('/')[0]; v = validateDecision(d); }
    catch (e) { parseErr = String(e.message); v = { ok: false, errors: [`parse error: ${parseErr}`], warnings: [] }; }
    if (!v.ok || v.warnings.length) report.push({ file: rel, errors: v.errors, warnings: v.warnings });
  }
  if (asJson) { console.log(JSON.stringify(report)); return; }
  if (!report.length) { console.log(`thunder-mind: ${files.length} decision(s) valid`); return; }
  for (const r of report) {
    for (const e of r.errors) console.log(`  ✗ ${r.file}: ${e}`);
    for (const w of r.warnings) console.log(`  ⚠ ${r.file}: ${w}`);
  }
  if (report.some((r) => r.errors.length)) process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const today = () => new Date().toISOString().slice(0, 10);

/** Record a decision: JSON on stdin (scribe output) → validated YAML file → rebuild. */
async function cmdAdd(root, { date, author, force }) {
  let d;
  try { d = JSON.parse(await readStdin()); } catch (e) { console.error('invalid JSON on stdin:', e.message); process.exit(1); }
  d.date = d.date || date || today();
  d.status = d.status || 'active';
  d.domain = d.domain || 'general';
  d.authors = d.authors || (author ? [author] : ['unknown']);
  for (const k of ['consequences', 'alternatives', 'tags', 'conflicts_with', 'evidence']) if (!d[k]) d[k] = [];
  d.id = makeId(d.domain, d.date, d.title || 'decision');

  const v = validateDecision(d);
  if (!v.ok) { console.error('invalid decision:\n  ' + v.errors.join('\n  ')); process.exit(1); }
  for (const w of v.warnings) console.error(`⚠ ${w}`);

  // dedup gate: refuse a near-duplicate active decision unless it supersedes or --force
  const { model } = build(root);
  if (!force && !d.supersedes) {
    const res = recall(model, `${d.title} ${d.decision} ${(d.tags || []).join(' ')}`, { top: 1 });
    const top = res.cards[0];
    if (top && top.score >= 0.5 && top.domain === d.domain) {
      console.error(`refused: very similar to existing "${top.id}" (score ${top.score}). ` +
        `Set "supersedes": "${top.id}" to replace it, or re-run with --force.`);
      process.exit(2);
    }
  }
  d.evidence_hashes = evidenceHashes(root, d.evidence);

  const p = fileForId(root, d.id);
  ensureDir(dirname(p));
  if (existsSync(p) && !force) { console.error(`already exists: ${d.id} (use --force to overwrite)`); process.exit(2); }
  writeFileSync(p, emitDecision(d));
  build(root);
  console.log(`thunder-mind: recorded ${d.id}`);
}

async function cmdCacheAnswer(root, q, idsCsv) {
  if (!q || !idsCsv) { console.error('usage: cache-answer --q "<question>" --ctx <id,id> <root>  (answer on stdin)'); process.exit(1); }
  const { model } = build(root);
  const deps = idsCsv.split(',').map((s) => s.trim()).filter(Boolean)
    .map((id) => ({ ctx: id, h: hashOfDecision(root, id) }));
  const missing = deps.filter((x) => !model.byId.has(x.ctx)).map((x) => x.ctx);
  if (missing.length) { console.error(`unknown decision(s): ${missing.join(', ')}`); process.exit(1); }
  const answer = (await readStdin()).trim();
  if (!answer) { console.error('empty answer on stdin'); process.exit(1); }
  ledger.writeAnswer(cacheDir(root), { q, answer, deps, engine: model.engineHash });
  console.log(`cached: "${q}" (${deps.length} dep(s))`);
}
const cmdCacheGc = (root) => { const { model } = build(root); const r = ledger.gc(cacheDir(root), { engineHash: model.engineHash }); console.log(`ledger gc: kept ${r.kept}, dropped ${r.dropped}`); };
const cmdCacheStats = (root) => console.log(dump({ ledger: ledger.stats(cacheDir(root)) }));

async function cmdPrune(file, root) {
  const text = file ? readFileSync(file, 'utf8') : await readStdin();
  const r = prune(text);
  if (debug.debugEnabled(root, fwOf(root))) debug.trace(root, fwOf(root), { plugin: 'thunder-mind', op: 'prune', detail: file || 'stdin',
    thunder: debug.tok(Buffer.byteLength(r.out)), baseline: debug.tok(Buffer.byteLength(text)) });
  process.stdout.write(r.out + (r.out.endsWith('\n') ? '' : '\n'));
  if (r.elided) process.stderr.write(`# pruned ${r.total}→${r.kept} lines (${r.elided} elided)\n`);
}

async function selftest() {
  const assert = (await import('node:assert')).default;
  const demo = join(dirname(fileURLToPath(import.meta.url)), '..', 'minddemo');

  // round-trip emit/parse
  const sample = { id: 'auth/x', title: 'A: tricky, "quoted"', type: 'architecture', status: 'active',
    domain: 'auth', date: '2026-06-27', authors: ['stephane'], context: 'C', decision: 'D', rationale: 'R',
    consequences: ['c1, with comma', 'c2'], alternatives: [{ choice: 'alt', rejected_because: 'why: x' }],
    tags: ['a', 'b'], conflicts_with: [], evidence: ['src/x.ts:1'] };
  const round = parseDecision(emitDecision(sample));
  assert.strictEqual(round.title, sample.title, 'title round-trips');
  assert.deepStrictEqual(round.consequences, sample.consequences, 'list round-trips');
  assert.deepStrictEqual(round.alternatives, sample.alternatives, 'flow-map list round-trips');

  const { model, errors } = build(demo);
  assert.strictEqual(errors, 0, 'demo decisions all valid');
  assert.ok(model.N >= 4, `expected ≥4 demo decisions, got ${model.N}`);

  // recall finds the RLS decision as #1
  const res = recall(model, 'tenant isolation postgres');
  assert.ok(res.cards.length, 'recall returned a card');
  assert.match(res.cards[0].id, /tenant-isolation-rls/, `#1 is RLS, got ${res.cards[0].id}`);
  assert.ok(res.cards[0].rationale, '#1 card is enriched (rationale present)');

  // superseded decision is excluded from default recall
  const ids = res.cards.map((c) => c.id);
  assert.ok(!ids.some((i) => /app-filter/.test(i)), 'superseded decision not surfaced by default');

  // a seeded conflict is detected
  const c = conflicts(model, demo);
  assert.ok(c.some((x) => x.type === 'conflict' || x.type === 'supersede-active'), 'a conflict/drift is flagged');

  console.log('✅ selftest OK —', model.N, 'decisions,', model.domains.length, 'domaines,', c.length, 'review item(s)');
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const VALUE_FLAGS = new Set(['--root', '--top', '--domain', '--author', '--date', '--q', '--ctx']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));
const cmd = pos[0] || 'build';
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const rootArg = flagVal('--root');
const R = (p) => resolve(rootArg || p || process.cwd());
const numFlag = (name) => { const v = flagVal(name); return v != null ? Number(v) : undefined; };

if (flags.has('--selftest')) {
  selftest().catch((e) => { console.error('❌ selftest FAILED:', e.message); process.exit(1); });
} else {
  switch (cmd) {
    case 'build': cmdBuild(R(pos[1]), flags.has('--force')); break;
    case 'ensure': cmdEnsure(R(pos[1])); break;
    case 'recall':
      if (flags.has('--detail')) cmdRecallDetail(R(pos[2]), pos[1]);
      else cmdRecall(R(pos[2]), pos[1], { top: numFlag('--top'), domain: flagVal('--domain'), all: flags.has('--all') });
      break;
    case 'brief': cmdBrief(R(pos[1])); break;
    case 'add': cmdAdd(R(pos[1]), { date: flagVal('--date'), author: flagVal('--author'), force: flags.has('--force') }); break;
    case 'conflicts': cmdConflicts(R(pos[1]), flags.has('--json')); break;
    case 'validate': cmdValidate(R(pos[1]), flags.has('--json')); break;
    case 'touch': cmdTouch(R(pos[2]), pos[1]); break;
    case 'reset': resetIndex(R(pos[1])); build(R(pos[1])); console.log('thunder-mind: index reset'); break;
    case 'cache-answer': cmdCacheAnswer(R(pos[1]), flagVal('--q'), flagVal('--ctx')); break;
    case 'cache-gc': cmdCacheGc(R(pos[1])); break;
    case 'cache-stats': cmdCacheStats(R(pos[1])); break;
    case 'prune': cmdPrune(pos[1], R(pos[2])); break;
    default: console.error(`unknown command: ${cmd}`); process.exit(1);
  }
}
