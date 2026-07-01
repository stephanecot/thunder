import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'capture-hint.mjs');

function run(prompt, root) {
  return execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  }).toString();
}

test('capture-hint stays silent in a project that never opted into thunder-mind', () => {
  const root = mkdtempSync(join(tmpdir(), 'mind-hint-'));
  try {
    assert.strictEqual(run('from now on we should always use RLS', root), '', 'no .thunder/mind → silent');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('capture-hint fires on standing-rule phrasing in an opted-in project (EN + FR)', () => {
  const root = mkdtempSync(join(tmpdir(), 'mind-hint-'));
  try {
    mkdirSync(join(root, '.thunder', 'mind', 'decisions'), { recursive: true });
    assert.match(run('from now on we should always use RLS', root), /thunder-mind-record/);
    assert.match(run('tu devrais toujours valider les entrées', root), /thunder-mind-record/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('capture-hint ignores incidental "toujours" and ordinary requests', () => {
  const root = mkdtempSync(join(tmpdir(), 'mind-hint-'));
  try {
    mkdirSync(join(root, '.thunder', 'mind', 'decisions'), { recursive: true });
    assert.strictEqual(run('le build est toujours cassé sur ma machine', root), '');
    assert.strictEqual(run('peux-tu corriger le test qui échoue', root), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
