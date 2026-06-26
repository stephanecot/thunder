import { writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dump } from './yaml.mjs';
import { cacheDir, ensureDir } from './cache.mjs';
import { moduleKeywords, loadModuleFunctional } from './functional.mjs';

/** Write a file only if content changed (so "only changed shards are rewritten"). */
function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  writeFileSync(path, content);
  return true;
}

const shardFile = (dir, ctx) => join(dir, 'modules', ctx.module, ctx.packages.join(',') + '.yaml');

// Trivial accessors carry no comprehension value — drop them from the shard (token-minimal).
const ACCESSOR = /^(get|set|is)[A-Z0-9]/;
const TRIVIAL = new Set(['equals', 'hashCode', 'toString']);
function denseTypes(types) {
  return types.map((t) => {
    const methods = t.methods.filter((m) => !ACCESSOR.test(m.n) && !TRIVIAL.has(m.n));
    const omitted = t.methods.length - methods.length;
    return omitted ? { ...t, methods, accessors_omitted: omitted } : { ...t, methods };
  });
}

/** Emit the YAML index (the model-facing artifact) from the derived model. */
export function emit(root, model, functional = {}) {
  const dir = cacheDir(root);
  ensureDir(dir);
  let changed = 0;

  // group contexts by module for the hierarchical index (modules → contexts → files)
  const byModule = new Map();
  for (const c of model.contexts) {
    if (!byModule.has(c.module)) byModule.set(c.module, []);
    byModule.get(c.module).push(c);
  }

  // TOP-LEVEL index: modules only — stays tiny no matter how many contexts exist
  const index = {
    meta: {
      modules: model.modules.length, contexts: model.contexts.length, endpoints: model.endpoints.length,
      shard_path: 'modules/<module>/<packages>.yaml  (id = <module>/<packages>)',
    },
    modules: [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ctxs]) => {
      const m = loadModuleFunctional(functional)[name];
      const keywords = (m?.keywords?.length ? m.keywords : moduleKeywords(ctxs.map((c) => c.id), functional));
      return {
        name,
        ...(m?.theme ? { theme: m.theme } : {}),
        ...(keywords.length ? { keywords } : {}),
        contexts: ctxs.length,
        endpoints: ctxs.reduce((a, c) => a + c.endpoints.length, 0),
        files: ctxs.reduce((a, c) => a + c.fileCount, 0),
        index: `modules/${name}/_index.yaml`,
      };
    }),
  };
  if (writeIfChanged(join(dir, 'index.yaml'), dump(index))) changed++;

  // PER-MODULE index: lists that module's contexts (1 line each) — the drill-down level
  for (const [name, ctxs] of byModule) {
    ensureDir(join(dir, 'modules', name));
    const modIndex = {
      module: name,
      contexts: ctxs.sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({
        id: c.id, name: functional[c.id]?.name || c.name,
        purpose: functional[c.id]?.purpose || null,
        files: c.fileCount, endpoints: c.endpoints.length,
      })),
    };
    if (writeIfChanged(join(dir, 'modules', name, '_index.yaml'), dump(modIndex))) changed++;
  }

  // grepable capability map (one line per context, for cheap discovery)
  const caps = model.contexts.map((c) => {
    const f = functional[c.id];
    return { id: c.id, purpose: f?.purpose || '', capabilities: f?.capabilities || [] };
  });
  if (writeIfChanged(join(dir, 'capability-map.yaml'), dump({ contexts: caps }))) changed++;

  // global endpoint table
  if (writeIfChanged(join(dir, 'endpoints.yaml'),
    dump({ endpoints: model.endpoints.map((e) => ({ verb: e.verb, path: e.path, fn: e.fn, ctx: e.ctx, flow: e.flow })) }))) changed++;

  // per-context shards (merge functional layer if present)
  const wantedShards = new Set();
  for (const c of model.contexts) {
    const f = functional[c.id] || {};
    const path = shardFile(dir, c);
    wantedShards.add(path);
    ensureDir(join(dir, 'modules', c.module));
    const stale = f.src_hash && f.src_hash !== c.src_hash;
    const shard = {
      context: {
        id: c.id, name: f.name || c.name, module: c.module, packages: c.packages,
        purpose: f.purpose || null,
        ...(stale ? { functional_stale: true } : {}),
        src_hash: c.src_hash,
        ...(f.evidence_hash ? { evidence_hash: f.evidence_hash } : {}),
        ...(f.capabilities ? { capabilities: f.capabilities } : {}),
        ...(f.business_rules ? { business_rules: f.business_rules } : {}),
        use_cases: c.endpoints.map((e) => ({ name: f.intents?.[e.fn] || e.fn, flow: e.flow })),
        types: denseTypes(c.types),
        endpoints: c.endpoints.map((e) => ({ verb: e.verb, path: e.path, fn: e.fn, ...(f.intents?.[e.fn] ? { intent: f.intents[e.fn] } : {}) })),
        beans: c.beans,
        entities: c.entities,
      },
    };
    if (writeIfChanged(path, dump(shard))) changed++;
  }

  // prune shards of contexts that no longer exist
  const modulesDir = join(dir, 'modules');
  if (existsSync(modulesDir)) {
    for (const mod of readdirSync(modulesDir)) {
      const md = join(modulesDir, mod);
      for (const file of readdirSync(md)) {
        const p = join(md, file);
        if (file.endsWith('.yaml') && !file.startsWith('_') && !wantedShards.has(p)) { rmSync(p); changed++; }
      }
    }
  }

  return { changed };
}
