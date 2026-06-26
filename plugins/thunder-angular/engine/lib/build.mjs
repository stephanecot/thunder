import { readFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { walkTs } from './walk.mjs';
import { parseFile } from './parser.mjs';
import { derive } from './derive.mjs';
import { emit } from './emit.mjs';
import { shortHash } from './hash.mjs';
import { readCache, writeCache, readManifest, writeManifest } from './cache.mjs';
import { loadFunctional } from './functional.mjs';

/** Read Angular workspace projects (name + sourceRoot) from angular.json. */
function projectsOf(root) {
  try {
    const aj = JSON.parse(readFileSync(join(root, 'angular.json'), 'utf8'));
    const out = Object.entries(aj.projects || {}).map(([name, p]) => ({
      name,
      sourceRoot: String(p.sourceRoot || (p.root ? p.root + '/src' : 'src')).replace(/\/+$/, ''),
    }));
    if (out.length) return out.sort((a, b) => b.sourceRoot.length - a.sourceRoot.length);
  } catch { /* no angular.json */ }
  return [{ name: basename(resolve(root)) || 'app', sourceRoot: 'src' }];
}

function locate(rel, projects) {
  const proj = projects.find((p) => p.sourceRoot && (rel === p.sourceRoot || rel.startsWith(p.sourceRoot + '/'))) || projects[projects.length - 1];
  const appPrefix = proj.sourceRoot + '/app/';
  let feature = 'app';
  if (rel.startsWith(appPrefix)) {
    const seg = rel.slice(appPrefix.length).split('/');
    feature = seg.length > 1 ? seg[0] : 'app';
  } else if (rel.startsWith(proj.sourceRoot + '/')) {
    const seg = rel.slice(proj.sourceRoot.length + 1).split('/');
    feature = seg.length > 1 ? seg[0] : 'app';
  }
  return { project: proj.name, feature };
}

/** Full incremental pipeline: WALK → PARSE (changed only) → DERIVE → EMIT. Returns the model. */
export function build(root) {
  const files = walkTs(root);
  const projects = projectsOf(root);
  const prevCache = readCache(root);
  const manifest = readManifest(root);
  const cache = new Map();
  const newManifest = { files: {}, shards: {} };
  let parsed = 0, reused = 0, errors = 0;

  for (const rel of files) {
    const abs = join(root, rel);
    let content;
    try { content = readFileSync(abs, 'utf8'); } catch { continue; }
    const h = shortHash(content);
    const { project, feature } = locate(rel, projects);
    const prev = manifest.files[rel];

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
  return { total: files.length, parsed, reused, errors, changed, model, functional };
}
