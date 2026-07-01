import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conflicts, evidenceHashes } from '../lib/conflicts.mjs';
import { buildModel } from '../lib/build.mjs';

const dec = (over) => ({
  id: 'auth/2026-01-01-x', title: 'X', type: 'technical', status: 'active', domain: 'auth',
  date: '2026-01-01', decision: 'D', consequences: [], alternatives: [], tags: [],
  conflicts_with: [], evidence: [], ...over,
});

function tmp() { return mkdtempSync(join(tmpdir(), 'mind-conf-')); }

test('non-path evidence ("v2.0", "RFC 7807.1", "PR #245", URLs) is never flagged missing', () => {
  const root = tmp();
  try {
    const model = buildModel([dec({ evidence: ['v2.0', 'RFC 7807.1', 'PR #245', 'https://x.dev/a.html'] })]);
    assert.deepStrictEqual(conflicts(model, root).filter((c) => c.type.startsWith('evidence')), []);
    assert.deepStrictEqual(evidenceHashes(root, ['v2.0', 'PR #245']), {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('range-aware evidence: an edit OUTSIDE the cited lines does not flag drift; inside does', () => {
  const root = tmp();
  try {
    const file = join(root, 'policy.sql');
    writeFileSync(file, 'l1\nl2\nCITED\nl4\nl5\n');
    const eh = evidenceHashes(root, ['policy.sql:3']);
    assert.ok(eh['policy.sql:3'], 'hash keyed by the full ref (with range)');
    const model = buildModel([dec({ evidence: ['policy.sql:3'], evidence_hashes: eh })]);

    writeFileSync(file, 'CHANGED\nl2\nCITED\nl4\nl5\n'); // edit outside the cited line
    assert.deepStrictEqual(conflicts(model, root).filter((c) => c.type === 'evidence-stale'), []);

    writeFileSync(file, 'CHANGED\nl2\nDRIFTED\nl4\nl5\n'); // edit the cited line itself
    assert.ok(conflicts(model, root).some((c) => c.type === 'evidence-stale'), 'cited-line change flags drift');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy whole-file hashes (keyed by bare path) still detect drift', () => {
  const root = tmp();
  try {
    const file = join(root, 'a.ts');
    writeFileSync(file, 'v1\n');
    const legacy = evidenceHashes(root, ['a.ts']); // no range → keyed by path, whole-file hash
    const model = buildModel([dec({ evidence: ['a.ts'], evidence_hashes: legacy })]);
    assert.deepStrictEqual(conflicts(model, root).filter((c) => c.type === 'evidence-stale'), []);
    writeFileSync(file, 'v2\n');
    assert.ok(conflicts(model, root).some((c) => c.type === 'evidence-stale'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing cited file is still reported', () => {
  const root = tmp();
  try {
    const model = buildModel([dec({ evidence: ['gone/away.ts:12'] })]);
    assert.ok(conflicts(model, root).some((c) => c.type === 'evidence-missing'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
