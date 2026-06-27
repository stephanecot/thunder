import { readFileSync, existsSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTs } from './walk.mjs';
import { parseFile } from './parser.mjs';
import { derive } from './derive.mjs';
import { emit } from './emit.mjs';
import { shortHash } from './hash.mjs';
import { readCache, writeCache, readManifest, writeManifest, drainDirty } from './cache.mjs';
import { loadFunctional } from './functional.mjs';

// Fingerprint of the parse-affecting engine code — invalidates cache.ndjson on an engine change.
const LIB = dirname(fileURLToPath(import.meta.url));
const ENGINE_HASH = shortHash(['lexer.mjs', 'parser.mjs', 'derive.mjs', 'build.mjs'].map((f) => { try { return readFileSync(join(LIB, f), 'utf8'); } catch { return ''; } }).join('|'));

/** Node project: a single app named after package.json (or the dir), source rooted at `src/` if present. */
function projectsOf(root) {
  let name = basename(resolve(root)) || 'app';
  try { const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); if (pkg.name) name = String(pkg.name).replace(/^@[^/]+\//, ''); } catch { /* no package.json */ }
  const sourceRoot = existsSync(join(root, 'src')) ? 'src' : '';
  return [{ name, sourceRoot }];
}

// Conventional container dirs that bundle many features — descend one level so each feature is its
// own context (e.g. modules/users, routes/orders) instead of a monolithic `modules` context.
const CONTAINER_DIRS = new Set(['features', 'pages', 'components', 'views', 'containers', 'routes', 'modules', 'screens', 'hooks', 'apps', 'packages']);

function featureOf(seg) {
  if (seg.length <= 1) return 'app';
  // a flat `modules/foo.controller.ts` (file directly under the container) stays at the container
  if (seg.length > 2 && CONTAINER_DIRS.has(seg[0])) return `${seg[0]}.${seg[1]}`; // '.' keeps shard filenames flat
  return seg[0];
}

function locate(rel, projects) {
  const proj = projects[0];
  const prefix = proj.sourceRoot ? proj.sourceRoot + '/' : '';
  const sub = !prefix ? rel : (rel.startsWith(prefix) ? rel.slice(prefix.length) : null);
  const feature = sub == null ? 'app' : featureOf(sub.split('/'));
  return { project: proj.name, feature };
}

/** Full incremental pipeline: WALK → PARSE (changed only) → DERIVE → EMIT. Returns the model. */
export function build(root, opts = {}) {
  const files = walkTs(root);
  const projects = projectsOf(root);
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
    const { project, feature } = locate(rel, projects);
    const prev = prevFiles[rel];

    if (prev && prev.hash === h && !prev.parse_error && prevCache.has(rel)) {
      const fact = prevCache.get(rel);
      fact.project = project; fact.feature = feature;
      cache.set(rel, fact);
      newManifest.files[rel] = { hash: h };
      reused++;
    } else {
      try {
        const fact = parseFile(content, rel);
        fact.hash = h; fact.project = project; fact.feature = feature;
        cache.set(rel, fact);
        newManifest.files[rel] = { hash: h };
        parsed++;
      } catch (e) {
        errors++;
        newManifest.files[rel] = { hash: h, parse_error: String(e?.message || e) };
        cache.set(rel, { file: rel, types: [], routes: [], hash: h, project, feature });
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
