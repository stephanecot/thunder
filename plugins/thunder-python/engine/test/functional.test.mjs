import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { derive } from '../lib/derive.mjs';
import { parseFile } from '../lib/parser.mjs';
import { buildEvidence, evidenceHash, setFunctional, staleContexts, loadFunctional } from '../lib/functional.mjs';

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-py-func-'));
  mkdirSync(join(dir, 'app', 'users'), { recursive: true });
  writeFileSync(join(dir, 'app/users/service.py'), 'class UserService:\n    def limit(self):\n        return 18\n');
  return dir;
}

function model(dir) {
  const f = parseFile(readFileSync(join(dir, 'app/users/service.py'), 'utf8'), 'app/users/service.py');
  f.project = 'app'; f.package = 'app.users'; f.hash = 'h1';
  return derive([f]);
}

test('evidence hash changes when a function BODY changes (problem C)', () => {
  const dir = tmpProject();
  try {
    const ctx = model(dir).contexts[0];
    const h1 = evidenceHash(buildEvidence(ctx, dir));
    const file = join(dir, 'app/users/service.py');
    writeFileSync(file, readFileSync(file, 'utf8').replace('return 18', 'return 21'));
    assert.notStrictEqual(h1, evidenceHash(buildEvidence(ctx, dir)), 'body change must change hash');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setFunctional persists and clears staleness', () => {
  const dir = tmpProject();
  try {
    const m = model(dir);
    const ctx = m.contexts[0];
    assert.strictEqual(staleContexts(m, dir, {}).length, 1, 'initially stale');
    setFunctional(dir, m, ctx.id, { purpose: 'Users', capabilities: ['x'] });
    const store = loadFunctional(dir);
    assert.strictEqual(store[ctx.id].purpose, 'Users');
    assert.strictEqual(staleContexts(m, dir, store).length, 0, 'no longer stale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('evidence pack includes real source of the package files', () => {
  const dir = tmpProject();
  try {
    const pack = buildEvidence(model(dir).contexts[0], dir);
    assert.ok(Object.keys(pack.sources).some((k) => k.endsWith('service.py')), 'service source included');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
