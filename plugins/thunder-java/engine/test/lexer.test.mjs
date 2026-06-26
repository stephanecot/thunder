import test from 'node:test';
import assert from 'node:assert';
import { neutralize } from '../lib/lexer.mjs';

const braces = (s) => (s.match(/[{}]/g) || []).length;

test('preserves length and newlines', () => {
  const s = 'int x = 1; // comment\nint y = 2;';
  const out = neutralize(s);
  assert.strictEqual(out.length, s.length);
  assert.strictEqual((out.match(/\n/g) || []).length, 1);
});

test('line comment blanked, code kept', () => {
  const out = neutralize('foo(); // }{ trailing');
  assert.ok(out.startsWith('foo();'));
  assert.strictEqual(braces(out), 0);
});

test('block comment braces ignored', () => {
  const out = neutralize('a /* } { } */ b {');
  assert.strictEqual(braces(out), 1); // only the real trailing brace
});

test('braces inside string literal are neutralized', () => {
  const out = neutralize('String s = "{ not code }"; x {');
  assert.strictEqual(braces(out), 1);
});

test('escaped quote does not end string early', () => {
  const out = neutralize('String s = "a\\"b{c"; y {');
  assert.strictEqual(braces(out), 1);
});

test('text block (""") fully neutralized', () => {
  const src = 'var t = """\n  here { is } a brace\n  """; tail {';
  const out = neutralize(src);
  assert.strictEqual(braces(out), 1);
  assert.strictEqual(out.length, src.length);
});

test('char literal with brace neutralized', () => {
  const out = neutralize("char c = '{'; z {");
  assert.strictEqual(braces(out), 1);
});

test('real code annotations survive', () => {
  const out = neutralize('@Service\npublic class X {');
  assert.ok(out.includes('@Service'));
  assert.ok(out.includes('class X'));
});
