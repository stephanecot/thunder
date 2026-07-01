import { readFileSync, readdirSync } from 'node:fs';
import { join, sep, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkJava } from './walk.mjs';
import { parseFile } from './parser.mjs';
import { derive } from './derive.mjs';
import { emit } from './emit.mjs';
import { shortHash } from './hash.mjs';
import { readCache, writeCache, readManifest, writeManifest, drainDirty, sweepLegacyCache } from './cache.mjs';
import { loadFunctional } from './functional.mjs';

const SKIP_DIRS = new Set(['target', 'build', 'out', 'bin', '.git', 'node_modules', '.idea', '.claude', '.gradle']);

// Fingerprint of the parse-affecting engine code (lexer + parser). The per-file cache (cache.ndjson)
// holds parseFile output, so a change to these files must invalidate it — even when no source changed.
const LIB = dirname(fileURLToPath(import.meta.url));
const ENGINE_HASH = shortHash(['lexer.mjs', 'parser.mjs'].map((f) => { try { return readFileSync(join(LIB, f), 'utf8'); } catch { return ''; } }).join('|'));

function artifactId(dir) {
  try {
    const pom = readFileSync(join(dir, 'pom.xml'), 'utf8').replace(/<parent>[\s\S]*?<\/parent>/, '');
    return (pom.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/) || [])[1] || basename(dir);
  } catch { return basename(dir); }
}

export function findModules(root) {
  const mods = [];
  const recurse = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === 'pom.xml')) mods.push({ dir, name: artifactId(dir) });
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) recurse(join(dir, e.name));
  };
  recurse(root);
  return mods;
}

function moduleOf(abs, modules, root) {
  let best = null;
  for (const m of modules) {
    if ((abs === m.dir || abs.startsWith(m.dir + sep)) && (!best || m.dir.length > best.dir.length)) best = m;
  }
  return best ? best.name : basename(resolve(root));
}

/** Full incremental pipeline: WALK → PARSE (changed only) → DERIVE → EMIT. Returns the model.
 *  opts.force (or an engine-code change) discards the per-file cache and reparses everything. */
export function build(root, opts = {}) {
  sweepLegacyCache(root);
  const files = walkJava(root);
  const modules = findModules(root);
  const manifest = readManifest(root);
  // invalidate the cache when forced or when the engine's parse code changed
  const stale = opts.force || manifest.engineHash !== ENGINE_HASH;
  const prevCache = stale ? new Map() : readCache(root);
  const prevFiles = stale ? {} : manifest.files;
  const cache = new Map();
  const newManifest = { engineHash: ENGINE_HASH, files: {}, shards: {} };
  let parsed = 0, reused = 0, errors = 0;

  for (const rel of files) {
    const abs = join(root, rel);
    let content;
    try { content = readFileSync(abs, 'utf8'); } catch { continue; }
    const h = shortHash(content);
    const mod = moduleOf(abs, modules, root);
    const prev = prevFiles[rel];

    if (prev && prev.hash === h && !prev.parse_error && prevCache.has(rel)) {
      const fact = prevCache.get(rel);
      fact.module = mod;
      cache.set(rel, fact);
      newManifest.files[rel] = { hash: h };
      reused++;
    } else {
      try {
        const fact = parseFile(content, rel);
        fact.hash = h; fact.module = mod;
        cache.set(rel, fact);
        newManifest.files[rel] = { hash: h };
        parsed++;
      } catch (e) {
        errors++;
        newManifest.files[rel] = { hash: h, parse_error: String(e?.message || e) };
        cache.set(rel, { file: rel, pkg: null, types: [], hash: h, module: mod });
      }
    }
  }

  writeCache(root, cache);
  const model = derive([...cache.values()]);
  const functional = loadFunctional(root);
  const { changed } = emit(root, model, functional);
  writeManifest(root, newManifest);
  drainDirty(root); // the build reconciled everything → clear the dirty queue (no unbounded growth)
  return { total: files.length, parsed, reused, errors, changed, model, functional, engineBust: stale };
}
