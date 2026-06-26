import { writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dump } from './yaml.mjs';
import { cacheDir, ensureDir } from './cache.mjs';
import { moduleKeywords, loadModuleFunctional } from './functional.mjs';

function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  writeFileSync(path, content);
  return true;
}

const shardFile = (dir, ctx) => join(dir, 'projects', ctx.project, ctx.packages.join(',') + '.yaml');

/** Emit the Angular YAML index from the derived model. */
export function emit(root, model, functional = {}) {
  const dir = cacheDir(root);
  ensureDir(dir);
  let changed = 0;

  const byProject = new Map();
  for (const c of model.contexts) {
    if (!byProject.has(c.project)) byProject.set(c.project, []);
    byProject.get(c.project).push(c);
  }

  // TOP index: projects only (+ functional theme/keywords)
  const index = {
    meta: {
      projects: model.projects.length, contexts: model.contexts.length, routes: model.routes.length,
      shard_path: 'projects/<project>/<feature>.yaml  (id = <project>/<feature>)',
    },
    projects: [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ctxs]) => {
      const m = loadModuleFunctional(functional)[name];
      const keywords = (m?.keywords?.length ? m.keywords : moduleKeywords(ctxs.map((c) => c.id), functional));
      return {
        name,
        ...(m?.theme ? { theme: m.theme } : {}),
        ...(keywords.length ? { keywords } : {}),
        features: ctxs.length,
        routes: ctxs.reduce((a, c) => a + c.routes.length, 0),
        files: ctxs.reduce((a, c) => a + c.fileCount, 0),
        index: `projects/${name}/_index.yaml`,
      };
    }),
  };
  if (writeIfChanged(join(dir, 'index.yaml'), dump(index))) changed++;

  // per-project index: its feature contexts (one line each)
  for (const [name, ctxs] of byProject) {
    ensureDir(join(dir, 'projects', name));
    const modIndex = {
      project: name,
      contexts: ctxs.sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({
        id: c.id, name: functional[c.id]?.name || c.name,
        purpose: functional[c.id]?.purpose || null,
        components: c.components.length, services: Object.keys(c.services).length, routes: c.routes.length,
      })),
    };
    if (writeIfChanged(join(dir, 'projects', name, '_index.yaml'), dump(modIndex))) changed++;
  }

  // global route table
  if (writeIfChanged(join(dir, 'routes.yaml'),
    dump({ routes: model.routes.map((r) => ({ path: r.path, target: r.target, kind: r.kind, ctx: r.ctx, flow: r.flow })) }))) changed++;

  // grepable capability map
  const caps = model.contexts.map((c) => ({ id: c.id, purpose: functional[c.id]?.purpose || '', capabilities: functional[c.id]?.capabilities || [] }));
  if (writeIfChanged(join(dir, 'capability-map.yaml'), dump({ contexts: caps }))) changed++;

  // per-context shards
  const wanted = new Set();
  for (const c of model.contexts) {
    const f = functional[c.id] || {};
    const path = shardFile(dir, c);
    wanted.add(path);
    ensureDir(join(dir, 'projects', c.project));
    const stale = f.src_hash && f.src_hash !== c.src_hash;
    const shard = {
      context: {
        id: c.id, name: f.name || c.name, project: c.project, feature: c.feature,
        purpose: f.purpose || null,
        ...(stale ? { functional_stale: true } : {}),
        src_hash: c.src_hash,
        ...(f.evidence_hash ? { evidence_hash: f.evidence_hash } : {}),
        ...(f.capabilities ? { capabilities: f.capabilities } : {}),
        ...(f.business_rules ? { business_rules: f.business_rules } : {}),
        use_cases: c.routes.filter((r) => r.flow).map((r) => ({ name: f.intents?.[r.path] || r.target || r.path, flow: r.flow })),
        routes: c.routes.map((r) => ({ path: r.path, target: r.target, kind: r.kind, ...(f.intents?.[r.path] ? { intent: f.intents[r.path] } : {}) })),
        components: c.components.map((cp) => ({ n: cp.n, selector: cp.selector, ...(cp.standalone ? { standalone: true } : {}), ...(cp.inputs.length ? { inputs: cp.inputs } : {}), ...(cp.outputs.length ? { outputs: cp.outputs } : {}), ...(cp.deps.length ? { deps: cp.deps } : {}) })),
        services: c.services,
        ...(c.modules.length ? { ng_modules: c.modules } : {}),
        ...(c.directives.length ? { directives: c.directives } : {}),
        ...(c.pipes.length ? { pipes: c.pipes } : {}),
        ...(Object.keys(c.di).length ? { di: c.di } : {}),
      },
    };
    if (writeIfChanged(path, dump(shard))) changed++;
  }

  // prune stale shards
  const projectsDir = join(dir, 'projects');
  if (existsSync(projectsDir)) {
    for (const proj of readdirSync(projectsDir)) {
      const pd = join(projectsDir, proj);
      for (const file of readdirSync(pd)) {
        const p = join(pd, file);
        if (file.endsWith('.yaml') && !file.startsWith('_') && !wanted.has(p)) { rmSync(p); changed++; }
      }
    }
  }

  return { changed };
}
