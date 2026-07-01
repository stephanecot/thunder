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

const shardRel = (c) => `projects/${c.project}/${c.packages.join(',')}.yaml`;
const cardRel = (c) => `projects/${c.project}/${c.packages.join(',')}.card.yaml`;
const shardFile = (dir, c) => join(dir, shardRel(c));
const cardFile = (dir, c) => join(dir, cardRel(c));

function frameworks(model) {
  const set = [...new Set(model.contexts.map((c) => c.framework).filter((f) => f && f !== 'python'))];
  return set.length ? set.join(' + ') + (set.length > 1 ? ' (mixed)' : '') : 'plain Python';
}

function buildBrief(model, functional, byProject) {
  const fmod = loadModuleFunctional(functional);
  const projects = [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ctxs]) => ({
    name,
    role: fmod[name]?.theme || ctxs.map((c) => functional[c.id]?.purpose).filter(Boolean)[0] || null,
    contexts: ctxs.length,
    routes: ctxs.reduce((a, c) => a + c.routes.length, 0),
  }));
  const rules = [];
  for (const c of model.contexts) { const f = functional[c.id]; if (f?.business_rules) for (const r of f.business_rules) { if (rules.length < 8) rules.push(typeof r === 'string' ? r : r.rule); } }
  const rts = model.routes.map((r) => `${r.verb} ${r.path || '/'}  (${r.fn})`);
  return {
    project_brief: {
      frameworks: frameworks(model),
      projects,
      routes: rts.length <= 50 ? rts : { count: rts.length, note: 'too many to inline — grep routes.yaml or use `ask "<kw>"`' },
      ...(rules.length ? { key_rules: rules } : {}),
      drill: 'capability-map.yaml (grep) · projects/<p>/<pkg>.card.yaml · .yaml (detail) · `ask "<kw>"`',
    },
  };
}

function buildCard(c, f) {
  return {
    card: {
      id: c.id, name: f.name || c.name, framework: c.framework, purpose: f.purpose || null,
      ...(f.capabilities ? { capabilities: f.capabilities } : {}),
      models: Object.keys(c.models),
      classes: c.classes.map((x) => x.n),
      routes: c.routes.map((r) => `${r.verb} ${r.path || '/'}`),
      detail: shardRel(c),
    },
  };
}

export function emit(root, model, functional = {}) {
  const dir = cacheDir(root);
  ensureDir(dir);
  let changed = 0;

  const byProject = new Map();
  for (const c of model.contexts) { if (!byProject.has(c.project)) byProject.set(c.project, []); byProject.get(c.project).push(c); }

  const index = {
    meta: { projects: model.projects.length, contexts: model.contexts.length, routes: model.routes.length, frameworks: frameworks(model), shard_path: 'projects/<project>/<package>.card.yaml (tier-1) ; .yaml (detail)' },
    projects: [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ctxs]) => {
      const m = loadModuleFunctional(functional)[name];
      const keywords = (m?.keywords?.length ? m.keywords : moduleKeywords(ctxs.map((c) => c.id), functional));
      return { name, ...(m?.theme ? { theme: m.theme } : {}), ...(keywords.length ? { keywords } : {}), contexts: ctxs.length, routes: ctxs.reduce((a, c) => a + c.routes.length, 0), files: ctxs.reduce((a, c) => a + c.fileCount, 0), index: `projects/${name}/_index.yaml` };
    }),
  };
  if (writeIfChanged(join(dir, 'index.yaml'), dump(index))) changed++;
  if (writeIfChanged(join(dir, 'project-brief.yaml'), dump(buildBrief(model, functional, byProject)))) changed++;

  for (const [name, ctxs] of byProject) {
    ensureDir(join(dir, 'projects', name));
    const modIndex = {
      project: name,
      contexts: ctxs.sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ id: c.id, name: functional[c.id]?.name || c.name, framework: c.framework, purpose: functional[c.id]?.purpose || null, routes: c.routes.length, card: cardRel(c) })),
    };
    if (writeIfChanged(join(dir, 'projects', name, '_index.yaml'), dump(modIndex))) changed++;
  }

  // global route table — ONE grep-friendly line per route (was 4-5 lines each)
  const rtLine = (r) => `${r.verb} ${r.path || '/'}  ${r.fn}  (${r.ctx})`;
  if (writeIfChanged(join(dir, 'routes.yaml'),
    dump({ format: 'VERB path  handler_fn  (context)', routes: model.routes.map(rtLine) }))) changed++;

  // grepable capability map — ONE line per context (id + purpose + capabilities together),
  // so a single grep hit is self-sufficient (id-less multi-line hits were useless)
  const caps = {};
  for (const c of model.contexts) {
    const f = functional[c.id];
    caps[c.id] = `${f?.purpose || ''}${f?.capabilities?.length ? ` — ${f.capabilities.join('; ')}` : ''}`;
  }
  if (writeIfChanged(join(dir, 'capability-map.yaml'), dump({ contexts: caps }))) changed++;

  const wanted = new Set();
  for (const c of model.contexts) {
    const f = functional[c.id] || {};
    const path = shardFile(dir, c);
    wanted.add(path);
    ensureDir(join(dir, 'projects', c.project));
    const stale = f.src_hash && f.src_hash !== c.src_hash;
    const shard = {
      context: {
        id: c.id, name: f.name || c.name, project: c.project, package: c.package, framework: c.framework,
        purpose: f.purpose || null,
        ...(stale ? { functional_stale: true } : {}),
        src_hash: c.src_hash,
        ...(f.evidence_hash ? { evidence_hash: f.evidence_hash } : {}),
        ...(f.capabilities ? { capabilities: f.capabilities } : {}),
        ...(f.business_rules ? { business_rules: f.business_rules } : {}),
        use_cases: c.routes.filter((r) => r.flow).map((r) => ({ name: f.intents?.[r.path] || r.fn, flow: r.flow })),
        routes: c.routes.map((r) => ({ verb: r.verb, path: r.path, fn: r.fn, ...(f.intents?.[r.path] ? { intent: f.intents[r.path] } : {}) })),
        models: c.models,
        ...(c.classes.length ? { classes: c.classes.map((x) => ({ n: x.n, ...(x.bases.length ? { bases: x.bases } : {}), methods: x.methods })) } : {}),
        ...(c.functions.length ? { functions: c.functions } : {}),
        ...(Object.keys(c.di).length ? { di: c.di } : {}),
      },
    };
    if (writeIfChanged(path, dump(shard))) changed++;
    const cpath = cardFile(dir, c);
    wanted.add(cpath);
    if (writeIfChanged(cpath, dump(buildCard(c, f)))) changed++;
  }

  const projectsDir = join(dir, 'projects');
  if (existsSync(projectsDir)) {
    for (const proj of readdirSync(projectsDir)) {
      const pd = join(projectsDir, proj);
      for (const file of readdirSync(pd)) { const p = join(pd, file); if (file.endsWith('.yaml') && !file.startsWith('_') && !wanted.has(p)) { rmSync(p); changed++; } }
    }
  }
  return { changed };
}
