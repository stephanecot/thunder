import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkPy } from './walk.mjs';
import { parseFile } from './parser.mjs';
import { derive } from './derive.mjs';
import { emit } from './emit.mjs';
import { shortHash } from './hash.mjs';
import { readCache, writeCache, readManifest, writeManifest, drainDirty, sweepLegacyCache } from './cache.mjs';
import { loadFunctional } from './functional.mjs';

const LIB = dirname(fileURLToPath(import.meta.url));
const ENGINE_HASH = shortHash(['lexer.mjs', 'parser.mjs'].map((f) => { try { return readFileSync(join(LIB, f), 'utf8'); } catch { return ''; } }).join('|'));

const hasSrc = (root) => existsSync(join(root, 'src'));

/** Map a file to its (project, package): package = dotted dir path under the source root, project = its head. */
function locate(rel, srcRoot, root) {
  let r = rel;
  if (srcRoot && (r === srcRoot || r.startsWith(srcRoot + '/'))) r = r.slice(srcRoot.length + 1);
  const dir = dirname(r);
  if (!dir || dir === '.') { const p = basename(resolve(root)); return { project: p, package: p }; }
  const pkg = dir.split('/').join('.');
  return { project: pkg.split('.')[0], package: pkg };
}

export function build(root, opts = {}) {
  sweepLegacyCache(root);
  const files = walkPy(root);
  const srcRoot = hasSrc(root) ? 'src' : '';
  const manifest = readManifest(root);
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
    const { project, package: pkg } = locate(rel, srcRoot, root);
    const prev = prevFiles[rel];

    if (prev && prev.hash === h && !prev.parse_error && prevCache.has(rel)) {
      const fact = prevCache.get(rel);
      fact.project = project; fact.package = pkg;
      cache.set(rel, fact);
      newManifest.files[rel] = { hash: h };
      reused++;
    } else {
      try {
        const fact = parseFile(content, rel);
        fact.hash = h; fact.project = project; fact.package = pkg;
        cache.set(rel, fact);
        newManifest.files[rel] = { hash: h };
        parsed++;
      } catch (e) {
        errors++;
        newManifest.files[rel] = { hash: h, parse_error: String(e?.message || e) };
        cache.set(rel, { file: rel, imports: [], types: [], functions: [], assigns: [], hash: h, project, package: pkg });
      }
    }
  }

  writeCache(root, cache);
  const model = derive([...cache.values()]);
  const functional = loadFunctional(root);
  const { changed } = emit(root, model, functional);
  writeManifest(root, newManifest);
  drainDirty(root);
  return { total: files.length, parsed, reused, errors, changed, model, functional, engineBust: stale };
}
