import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';
import { scopeOf } from '../lib/decision.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'thunder.mjs');

function project(decisions) {
  const dir = mkdtempSync(join(tmpdir(), 'mind-tier-'));
  for (const d of decisions) {
    const p = join(dir, '.thunder', 'mind', 'decisions', d.domain, `${d.date}-${d.slug}.yaml`);
    mkdirSync(dirname(p), { recursive: true });
    const lines = [`title: ${JSON.stringify(d.title)}`, `type: ${d.type}`, `status: ${d.status || 'active'}`,
      `domain: ${d.domain}`, `date: ${d.date}`, `decision: ${JSON.stringify(d.decision || d.title)}`];
    if (d.scope) lines.push(`scope: ${d.scope}`);
    writeFileSync(p, lines.join('\n') + '\n');
  }
  return dir;
}

test('scopeOf: architecture/convention infer global; others infer domain; explicit wins', () => {
  assert.equal(scopeOf({ type: 'architecture' }), 'global');
  assert.equal(scopeOf({ type: 'convention' }), 'global');
  assert.equal(scopeOf({ type: 'technical' }), 'domain');
  assert.equal(scopeOf({ type: 'architecture', scope: 'local' }), 'local');
});

test('tier-0 constitution holds ONLY global invariants; size is flat, not corpus-bound', () => {
  // 2 global invariants + 200 domain/local tactical decisions
  const ds = [
    { domain: 'arch', date: '2026-01-01', slug: 'a', title: 'Layered architecture', type: 'architecture' },
    { domain: 'api', date: '2026-01-02', slug: 'c', title: 'REST naming', type: 'convention' },
  ];
  for (let i = 0; i < 200; i++) ds.push({ domain: 'feat' + (i % 10), date: '2026-02-01', slug: 'd' + i, title: 'tactical ' + i, type: 'technical' });
  const dir = project(ds);
  try {
    const { model } = build(dir);
    const brief = readFileSync(join(dir, '.claude', 'cache', 'thunder-mind', 'brief.yaml'), 'utf8');
    // constitution = exactly the 2 global ones, never the 200 tactical
    assert.match(brief, /Layered architecture/);
    assert.match(brief, /REST naming/);
    assert.ok(!/tactical \d/.test(brief), 'tactical decisions are NOT in the always-injected constitution');
    assert.equal(model.N, 202, 'all 202 decisions in the model');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('NO LOSS: domain-map lists every decision; recall reaches each one', () => {
  const ds = [];
  for (let i = 0; i < 60; i++) ds.push({ domain: 'd' + (i % 6), date: '2026-03-01', slug: 's' + i, title: 'uniqueword' + i + ' decision', type: i ? 'technical' : 'architecture', decision: 'do uniqueword' + i });
  const dir = project(ds);
  try {
    build(dir);
    const C = join(dir, '.claude', 'cache', 'thunder-mind');
    const map = readFileSync(join(C, 'domain-map.yaml'), 'utf8');
    assert.equal((map.match(/^  d\d+\//gm) || []).length, 60, 'domain-map has ALL 60 decisions, one line each');
    assert.match(map, /uniqueword0 decision/, 'a grep hit carries the title on the id line');
    // a tactical decision NOT in the constitution is still retrievable by recall
    const out = execFileSync('node', [ENGINE, 'recall', 'uniqueword42', dir], { encoding: 'utf8' });
    assert.match(out, /uniqueword42/, 'recall reaches a non-constitution decision');
    assert.match(out, /matched: [1-9]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('per-domain cards are emitted (one per domain), loaded on demand', () => {
  const dir = project([
    { domain: 'auth', date: '2026-01-01', slug: 'a', title: 'RLS', type: 'architecture' },
    { domain: 'data', date: '2026-01-02', slug: 'b', title: 'Postgres', type: 'technical' },
  ]);
  try {
    build(dir);
    const cards = readdirSync(join(dir, '.claude', 'cache', 'thunder-mind', 'domains'));
    assert.deepStrictEqual(cards.sort(), ['auth.card.yaml', 'data.card.yaml']);
    const out = execFileSync('node', [ENGINE, 'card', 'auth', dir], { encoding: 'utf8' });
    assert.match(out, /domain: auth/);
    assert.match(out, /RLS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('add tolerates ```json fences (IMPROVE-decision-capture 3a)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mind-fence-'));
  mkdirSync(join(dir, '.thunder', 'mind', 'decisions'), { recursive: true });
  try {
    const fenced = '```json\n' + JSON.stringify({ title: 'Use strict TS', type: 'convention', domain: 'quality', decision: 'Enable TS strict mode in CI.' }) + '\n```';
    const out = execFileSync('node', [ENGINE, 'add', dir], { input: fenced, encoding: 'utf8' });
    assert.match(out, /recorded quality\//, 'fenced JSON was recorded');
    assert.ok(existsSync(join(dir, '.thunder', 'mind', 'decisions', 'quality')), 'decision file written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
