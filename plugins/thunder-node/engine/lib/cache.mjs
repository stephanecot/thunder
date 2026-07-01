import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const cacheDir = (root) => join(root, '.thunder', 'node');

/** One-time migration: drop the pre-relocation derived index (.claude/cache/thunder-node/).
 * Projects indexed before the move to .thunder/node/ keep a stale copy there that masquerades
 * as the live index — remove it on every build. */
export function sweepLegacyCache(root) {
  for (const name of ['thunder-node']) {
    try { rmSync(join(root, '.claude', 'cache', name), { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
// Committed opt-in marker: thunder only indexes a project once this exists (written by `init`).
export const projectConfig = (root) => join(cacheDir(root), 'config.yaml');
export const isInitialized = (root) => existsSync(projectConfig(root));

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Internal source-of-truth cache: one JSON record per file (safe round-trip, NOT YAML). */
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
  writeFileSync(join(dir, 'cache.ndjson'), lines.join('\n') + '\n');
}

export function readManifest(root) {
  const p = join(cacheDir(root), 'manifest.json');
  if (!existsSync(p)) return { files: {}, shards: {} };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { files: {}, shards: {} }; }
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
