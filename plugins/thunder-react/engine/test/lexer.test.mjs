import test from 'node:test';
import assert from 'node:assert';
import { neutralize } from '../lib/lexer.mjs';

const braces = (s) => (s.match(/[{}]/g) || []).length;

test('preserves length and newlines', () => {
  const s = "const x = 1; // c\nconst y = '2';";
  assert.strictEqual(neutralize(s).length, s.length);
});

test('template literal neutralized, code brace kept', () => {
  const out = neutralize('const t = `<h1>{{ title }}</h1>`; class X {');
  assert.strictEqual(braces(out), 1); // only the class brace
});

test('template interpolation ${...} fully neutralized', () => {
  const out = neutralize('const u = `a ${ obj.x } b ${ {k: 1} } c`; y {');
  assert.strictEqual(braces(out), 1);
});

test('nested template literal inside interpolation', () => {
  const out = neutralize('const v = `${ `inner ${x}` }`; z {');
  assert.strictEqual(braces(out), 1);
});

test('brace in string and comment ignored', () => {
  assert.strictEqual(braces(neutralize('const s = "{ no }"; /* { } */ w {')), 1);
});

test('decorator @ survives', () => {
  assert.ok(neutralize('@Component({})\nexport class X {}').includes('@Component'));
});
