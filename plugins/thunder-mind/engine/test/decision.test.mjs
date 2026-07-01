import { test } from 'node:test';
import assert from 'node:assert';
import {
  emitDecision, parseDecision, validateDecision, slugify, makeId, idFromRel,
} from '../lib/decision.mjs';

const sample = {
  id: 'auth/x', title: 'Tricky: with, "quotes" & colon: here', type: 'architecture', status: 'active',
  domain: 'auth', date: '2026-06-27', authors: ['stephane', 'other'],
  context: 'A context with, commas and: colons.', decision: 'D', rationale: 'R',
  consequences: ['c1, with comma', 'c2: with colon'],
  alternatives: [{ choice: 'schema per tenant', rejected_because: 'explosion: at scale' }],
  tags: ['postgres', 'rls'], conflicts_with: [], evidence: ['src/x.ts:12'],
};

test('emit/parse round-trips scalars, quoted lists and flow-map lists', () => {
  const r = parseDecision(emitDecision(sample));
  assert.strictEqual(r.title, sample.title);
  assert.strictEqual(r.context, sample.context);
  assert.deepStrictEqual(r.consequences, sample.consequences);
  assert.deepStrictEqual(r.alternatives, sample.alternatives);
  assert.deepStrictEqual(r.tags, sample.tags);
  assert.deepStrictEqual(r.evidence, sample.evidence);
  assert.deepStrictEqual(r.authors, sample.authors);
  assert.deepStrictEqual(r.conflicts_with, []);
});

test('empty lists emit and parse as []', () => {
  const r = parseDecision(emitDecision({ ...sample, tags: [], evidence: [] }));
  assert.deepStrictEqual(r.tags, []);
  assert.deepStrictEqual(r.evidence, []);
});

test('evidence_hashes map round-trips', () => {
  const r = parseDecision(emitDecision({ ...sample, evidence_hashes: { 'src/x.ts': 'ab12cd34' } }));
  assert.deepStrictEqual(r.evidence_hashes, { 'src/x.ts': 'ab12cd34' });
});

test('validate flags missing required fields and bad enums', () => {
  assert.ok(validateDecision(sample).ok);
  const bad = validateDecision({ title: 'x', type: 'bogus', status: 'nope', domain: 'd', date: '2026-1-1' });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => /type/.test(e)));
  assert.ok(bad.errors.some((e) => /status/.test(e)));
  assert.ok(bad.errors.some((e) => /date/.test(e)));
  assert.ok(bad.errors.some((e) => /decision/.test(e)));
});

test('validate warns on likely non-English prose', () => {
  const v = validateDecision({ ...sample, rationale: 'Décision pour la gestion des données.' });
  assert.ok(v.warnings.length, 'expected a non-English warning');
});

test('slug + id helpers', () => {
  assert.strictEqual(slugify('Tenant Isolation via Postgres RLS!'), 'tenant-isolation-via-postgres-rls');
  assert.strictEqual(makeId('Auth', '2026-06-27', 'Tenant Isolation'), 'auth/2026-06-27-tenant-isolation');
  assert.strictEqual(idFromRel('auth/2026-06-27-x.yaml'), 'auth/2026-06-27-x');
});

test('hand-edited folded block scalar (`key: >`) parses to the real text, not ">"', () => {
  const d = parseDecision('title: T\ndecision: >\n  Use RLS for isolation\n  everywhere.\n');
  assert.strictEqual(d.decision, 'Use RLS for isolation everywhere.');
});

test('hand-edited literal block scalar (`key: |`) keeps line breaks', () => {
  const d = parseDecision('note: |\n  line one\n  line two\n');
  assert.strictEqual(d.note, 'line one\nline two');
});

test('YAML inline comment on a bare scalar is stripped (like a real parser)', () => {
  const d = parseDecision('decision: use RLS  # important\n');
  assert.strictEqual(d.decision, 'use RLS');
});

test('a # without leading whitespace stays part of the value', () => {
  const d = parseDecision('evidence:\n  - "PR #245"\n');
  assert.deepStrictEqual(d.evidence, ['PR #245']);
});
