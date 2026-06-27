// SHARED · synced into every plugin's engine/test/ by shared/sync.mjs. Tests the language-agnostic
// Tier-3 layer: tool-output pruning (Phase 1) and the hash-validated answer cache (Phase 2).
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { prune } from '../lib/common/prune.mjs';
import { normalize, lookup, writeAnswer, gc, readLedger } from '../lib/common/ledger.mjs';
import { debugEnabled, trace, config } from '../lib/common/debug.mjs';

test('prune: keeps head+tail+diagnostics, elides the middle with a marker', () => {
  const lines = [];
  for (let i = 0; i < 500; i++) lines.push(i === 250 ? 'FATAL: boom at line 250' : `noise line ${i}`);
  const { out, total, elided } = prune(lines.join('\n'), { head: 5, tail: 5 });
  assert.equal(total, 500);
  assert.ok(elided > 400, `elided most lines (${elided})`);
  assert.ok(out.includes('FATAL: boom at line 250'), 'diagnostic line preserved');
  assert.ok(out.includes('noise line 0') && out.includes('noise line 499'), 'head & tail preserved');
  assert.ok(/…elided \d+ line\(s\)…/.test(out), 'elision marker present');
});

test('prune: small input is returned verbatim', () => {
  const small = 'a\nb\nc';
  assert.equal(prune(small).out, small);
});

test('prune: THUNDER_PRUNE=off is a passthrough', () => {
  process.env.THUNDER_PRUNE = 'off';
  const big = Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n');
  try { assert.equal(prune(big).out, big); } finally { delete process.env.THUNDER_PRUNE; }
});

test('ledger normalize: stopwords dropped, de-pluralized, sorted/deduped', () => {
  const { terms } = normalize('How do the ROUTES and routing work?');
  assert.ok(terms.includes('route'), 'routes→route');
  assert.ok(!terms.includes('the') && !terms.includes('how'), 'stopwords gone');
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-ledger-'));
  writeAnswer(dir, { q: 'how does the chat feature work', answer: 'Chat = ChatComponent + ChatService.',
    deps: [{ ctx: 'shop/features.chat', h: 'AAAA' }], scope: 'feature', engine: 'ENG1', nowIso: '2026-01-01T00:00:00Z' });
  return dir;
}

test('ledger: fresh hit when all dep hashes match', () => {
  const dir = fixture();
  try {
    const r = lookup(dir, 'explain the chat feature', { srcHashOf: () => 'AAAA', engineHash: 'ENG1' });
    assert.ok(r && r.fresh, 'fresh hit on paraphrase');
    assert.match(r.entry.a, /ChatService/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger: STALE when a dep src_hash changed', () => {
  const dir = fixture();
  try {
    const r = lookup(dir, 'how does chat work', { srcHashOf: () => 'BBBB', engineHash: 'ENG1' });
    assert.ok(r && !r.fresh && r.reason === 'stale', 'detected stale dep');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger: STALE when engine hash changed', () => {
  const dir = fixture();
  try {
    const r = lookup(dir, 'how does chat work', { srcHashOf: () => 'AAAA', engineHash: 'ENG2' });
    assert.ok(r && !r.fresh && r.reason === 'engine', 'detected engine bump');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger: scope gate — a routes question does not match a feature entry', () => {
  const dir = fixture();
  try {
    const r = lookup(dir, 'chat feature', { srcHashOf: () => 'AAAA', engineHash: 'ENG1', scope: 'routes' });
    assert.ok(r == null || r.entry == null, 'scope mismatch → no candidate');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger: gc drops entries with a stale engine hash', () => {
  const dir = fixture();
  try {
    const { dropped } = gc(dir, { engineHash: 'ENG2' });
    assert.equal(dropped, 1);
    assert.equal(readLedger(dir).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('debug: OFF by default (no .thunder.config) → trace is a no-op, no file written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-dbg-off-'));
  try {
    assert.equal(debugEnabled(dir), false);
    trace(dir, { plugin: 'thunder-x', op: 'ask:index', detail: 'q', thunder: 10, baseline: 100 });
    assert.equal(existsSync(join(dir, '.thunder', 'gains.md')), false, 'nothing written when DEBUG off');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('debug: DEBUG=true → trace appends a gains row with computed saving', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-dbg-on-'));
  try {
    writeFileSync(join(dir, '.thunder.config'), '# config\nDEBUG=true\n');
    assert.equal(debugEnabled(dir), true);
    trace(dir, { plugin: 'thunder-x', op: 'ask:index', detail: 'how does chat work', thunder: 50, baseline: 350, nowIso: '2026-01-01T00:00:00Z' });
    const md = readFileSync(join(dir, '.thunder', 'gains.md'), 'utf8');
    assert.match(md, /\| time \(UTC\) \| plugin \| op \|/, 'header present');
    assert.match(md, /thunder-x \| ask:index .* \| 50 \| 350 \| 300 \| 86% \|/, 'row with saved=300, 86%');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
