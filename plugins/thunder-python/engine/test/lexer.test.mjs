import test from 'node:test';
import assert from 'node:assert';
import { neutralize } from '../lib/lexer.mjs';

test('preserves length, newlines and leading indentation', () => {
  const s = '    x = 1  # comment\n    y = 2';
  const out = neutralize(s);
  assert.strictEqual(out.length, s.length);
  assert.ok(out.startsWith('    x = 1'), 'indentation + code kept');
  assert.ok(!out.includes('comment'), 'comment blanked');
});

test('triple-quoted docstring neutralized across lines', () => {
  const src = 'def f():\n    """doc\n    class Fake:\n    """\n    return 1';
  const out = neutralize(src);
  assert.ok(!out.includes('Fake'), 'docstring content blanked');
  assert.ok(out.includes('def f()') && out.includes('return 1'), 'code kept');
});

test('f-string interpolation neutralized', () => {
  const out = neutralize('msg = f"id={user.id} name={name}"');
  assert.ok(out.startsWith('msg ='));
  assert.ok(!out.includes('user.id'), 'f-string content blanked');
});

test('string with a colon does not break structure', () => {
  const out = neutralize('label = "key: value"');
  assert.ok(!out.includes('key'), 'string blanked');
});

test('decorator @ and def colon survive', () => {
  const out = neutralize('@app.get("/x")\ndef h():\n    pass');
  assert.ok(out.includes('@app.get'));
  assert.ok(out.includes('def h()'));
});
