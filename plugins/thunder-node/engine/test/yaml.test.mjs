import test from 'node:test';
import assert from 'node:assert';
import { dump } from '../lib/yaml.mjs';

test('root object renders in block style', () => {
  assert.strictEqual(dump({ a: 1, b: 2 }).trim(), 'a: 1\nb: 2');
});

test('nested small scalar object renders in compact flow style', () => {
  assert.strictEqual(dump({ row: { a: 1, b: 2 } }).trim(), 'row: {a: 1, b: 2}');
});

test('array of small objects uses flow per item (token-efficient)', () => {
  const out = dump({ items: [{ a: 1 }, { b: 2 }] });
  assert.ok(out.includes('- {a: 1}'));
  assert.ok(out.includes('- {b: 2}'));
});

test('strings with a colon are quoted (signatures)', () => {
  assert.ok(dump({ sig: '(X):Y' }).includes('"(X):Y"'));
});

test('paths with slashes/braces are quoted', () => {
  assert.ok(dump({ path: '/users/{id}' }).includes('"/users/{id}"'));
});

test('embedded double quotes are escaped', () => {
  const out = dump({ a: 'say "hi"' });
  assert.ok(out.includes('\\"hi\\"'));
});

test('null / numbers / booleans render unquoted', () => {
  const out = dump({ a: null, b: 3, c: true });
  assert.ok(/a: null/.test(out));
  assert.ok(/b: 3/.test(out));
  assert.ok(/c: true/.test(out));
});

test('numeric-looking strings are quoted', () => {
  assert.ok(dump({ v: '007' }).includes('"007"'));
});

test('nested structures fall back to block style', () => {
  const out = dump({ outer: { x: 1, y: 2, z: 3, w: 4, deep: { a: 1, b: 2, c: 3, d: 4, e: 5 } } });
  assert.ok(out.includes('\n'));
  assert.ok(/outer:/.test(out));
});

test('empty array and object', () => {
  assert.ok(dump({ a: [], b: {} }).includes('a: []'));
});

test('array of scalars compact', () => {
  assert.strictEqual(dump({ tags: ['x', 'y'] }).trim(), 'tags: [x, y]');
});

test('non-flowable list item hoists its first key onto the dash line (no orphan dash)', () => {
  const long = 'x'.repeat(120); // forces block style (> FLOW_MAX)
  const out = dump({ items: [{ a: long, b: 2 }] });
  assert.ok(!/^\s*-$/m.test(out), 'no dash alone on its line');
  assert.ok(new RegExp(`- a: ${long}\\n    b: 2`).test(out), 'first key on the dash, siblings aligned');
});

test('hoisted item whose first value is itself a block stays valid', () => {
  const out = dump({ items: [{ deep: [{ a: 'y'.repeat(120) }], b: 2 }] });
  assert.ok(out.includes('- deep:'), 'first key hoisted even when its value is a block');
  assert.ok(!/^\s*-$/m.test(out), 'no orphan dash');
});
