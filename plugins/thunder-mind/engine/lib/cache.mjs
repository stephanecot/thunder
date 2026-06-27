import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Same directory convention as the framework plugins:
//   .thunder/mind/decisions/  ← COMMITTED source of truth (one YAML per decision, reviewed in PRs)
//   .thunder/mind/.config     ← per-framework DEBUG toggle (matches .thunder/<fw>/.config)
//   .claude/cache/thunder-mind/ ← GITIGNORED derived index (rebuilt for free by the hook; covered by
//                                 the global **/.claude/cache/ ignore rule, like every Thunder plugin)
export const mindDir = (root) => join(root, '.thunder', 'mind');
export const decisionsDir = (root) => join(mindDir(root), 'decisions');
export const cacheDir = (root) => join(root, '.claude', 'cache', 'thunder-mind');

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Parsed-decision cache: one JSON record per file (safe round-trip, NOT YAML). */
export function readCache(root) {
  const p = join(cacheDir(root), 'cache.ndjson');
  const map = new Map();
  if (!existsSync(p)) return map;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const rec = JSON.parse(line); map.set(rec.file, rec); } catch { /* skip corrupt line */ }
  }
  return map;
}

export function writeCache(root, map) {
  const dir = cacheDir(root);
  ensureDir(dir);
  const lines = [...map.values()].map((r) => JSON.stringify(r));
  writeFileSync(join(dir, 'cache.ndjson'), lines.join('\n') + (lines.length ? '\n' : ''));
}

export function readManifest(root) {
  const p = join(cacheDir(root), 'manifest.json');
  if (!existsSync(p)) return { engineHash: null, files: {} };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { engineHash: null, files: {} }; }
}

export function writeManifest(root, manifest) {
  ensureDir(cacheDir(root));
  writeFileSync(join(cacheDir(root), 'manifest.json'), JSON.stringify(manifest, null, 0));
}

const dirtyPath = (root) => join(cacheDir(root), 'dirty.list');

export function appendDirty(root, file) {
  ensureDir(cacheDir(root));
  const p = dirtyPath(root);
  const prev = existsSync(p) ? readFileSync(p, 'utf8') : '';
  writeFileSync(p, prev + file + '\n');
}

export function drainDirty(root) {
  const p = dirtyPath(root);
  if (!existsSync(p)) return [];
  const list = readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  writeFileSync(p, '');
  return [...new Set(list)];
}
