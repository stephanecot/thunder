import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../lib/build.mjs';

test('migration: build sweeps the pre-relocation .claude/cache/thunder-node/ stale index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-sweep-'));
  try {
    const legacy = join(dir, '.claude', 'cache', 'thunder-node');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'stale.yaml'), 'verb: GET\n');
    build(dir);
    assert.ok(!existsSync(legacy), 'legacy cache directory removed by build');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
