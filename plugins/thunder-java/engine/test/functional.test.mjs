import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { derive } from '../lib/derive.mjs';
import { buildEvidence, evidenceHash, setFunctional, staleContexts, loadFunctional } from '../lib/functional.mjs';

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-func-'));
  const pkgDir = join(dir, 'src/main/java/com/demo/user');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'UserService.java'),
    'package com.demo.user;\nimport org.springframework.stereotype.Service;\n@Service\npublic class UserService {\n  public int limit() { return 18; }\n}\n');
  return dir;
}

function model(dir) {
  const facts = [{
    file: 'src/main/java/com/demo/user/UserService.java',
    pkg: 'com.demo.user', module: 'demo', hash: 'h1',
    types: [{ kind: 'class', name: 'UserService', line: 3, ann: ['@Service'],
      methods: [{ kind: 'method', name: 'limit', sig: '():int', l: 5 }], fields: [] }],
  }];
  return derive(facts);
}

test('evidence hash changes when a method BODY changes (problem C)', () => {
  const dir = tmpProject();
  try {
    const m = model(dir);
    const ctx = m.contexts[0];
    const h1 = evidenceHash(buildEvidence(ctx, dir));

    // change only the body (return 18 -> return 21); signature is unchanged
    const f = join(dir, 'src/main/java/com/demo/user/UserService.java');
    writeFileSync(f, readFileSync(f, 'utf8').replace('return 18', 'return 21'));

    const h2 = evidenceHash(buildEvidence(ctx, dir));
    assert.notStrictEqual(h1, h2, 'body change must change evidence hash');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setFunctional persists and clears staleness; rebuild keeps it stable', () => {
  const dir = tmpProject();
  try {
    const m = model(dir);
    const ctx = m.contexts[0];
    assert.strictEqual(staleContexts(m, dir, {}).length, 1, 'initially stale (missing)');

    setFunctional(dir, m, ctx.id, { purpose: 'Comptes', capabilities: ['x'] });
    const store = loadFunctional(dir);
    assert.strictEqual(store[ctx.id].purpose, 'Comptes');
    assert.ok(store[ctx.id].evidence_hash && store[ctx.id].src_hash);

    assert.strictEqual(staleContexts(m, dir, store).length, 0, 'no longer stale after inference');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('evidence pack includes real source of stereotype classes', () => {
  const dir = tmpProject();
  try {
    const pack = buildEvidence(model(dir).contexts[0], dir);
    const srcFiles = Object.keys(pack.sources);
    assert.ok(srcFiles.some((k) => k.endsWith('UserService.java')), 'service source included');
    assert.match(Object.values(pack.sources)[0], /class UserService/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
