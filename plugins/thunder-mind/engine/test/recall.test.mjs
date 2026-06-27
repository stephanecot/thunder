import { test } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../lib/build.mjs';
import { recall } from '../lib/recall.mjs';
import { conflicts } from '../lib/conflicts.mjs';

const demo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'minddemo');
const { model } = build(demo);

test('builds the demo model', () => {
  assert.ok(model.N >= 5, `expected ≥5 decisions, got ${model.N}`);
  assert.ok(model.domains.length >= 3);
  assert.ok(model.postings.size > 0, 'inverted index populated');
});

test('recall ranks the most relevant decision first, enriched', () => {
  const res = recall(model, 'tenant isolation postgres');
  assert.ok(res.cards.length);
  assert.match(res.cards[0].id, /tenant-isolation-rls/);
  assert.ok(res.cards[0].rationale, '#1 card is enriched');
});

test('recall excludes superseded decisions by default', () => {
  const res = recall(model, 'tenant isolation', { top: 10 });
  assert.ok(!res.cards.some((c) => /app-filter/.test(c.id)), 'superseded hidden');
});

test('recall --all surfaces superseded decisions', () => {
  const res = recall(model, 'tenant isolation', { top: 10, all: true });
  assert.ok(res.cards.some((c) => /app-filter/.test(c.id)), 'superseded visible with all:true');
});

test('recall --domain prefilters', () => {
  const res = recall(model, 'database', { top: 10, domain: 'data' });
  assert.ok(res.cards.every((c) => c.domain === 'data'));
});

test('candidates come from the inverted index (no postings term → no match)', () => {
  const res = recall(model, 'zzzznonexistentterm');
  assert.strictEqual(res.matched, 0);
});

test('conflicts detects the seeded active-vs-proposed contradiction', () => {
  const c = conflicts(model, demo);
  assert.ok(c.some((x) => x.type === 'conflict' && /mysql/.test(x.id)));
});
