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

const shardRel = (ctx) => `projects/${ctx.project}/${ctx.packages.join(',')}.yaml`;
const cardRel = (ctx) => `projects/${ctx.project}/${ctx.packages.join(',')}.card.yaml`;
const shardFile = (dir, ctx) => join(dir, shardRel(ctx));
const cardFile = (dir, ctx) => join(dir, cardRel(ctx));

const routeStr = (r) => `${r.verb ? r.verb + ' ' : ''}${r.path || '/'} → ${r.target || r.kind}`;

/** Detect the Node.js framework mix (deterministic, no LLM). */
function frameworkSummary(model) {
  const fws = [...new Set(model.contexts.map((c) => c.framework).filter((fw) => fw && fw !== 'node'))].sort();
  return fws.length ? fws.join(' + ') : 'plain Node.js';
}

/** Tier-0 PROJECT BRIEF: one inline read for archi/overview/route questions. */
function buildBrief(model, functional, byProject) {
  const fmod = loadModuleFunctional(functional);
  const projects = [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ctxs]) => ({
    name,
    role: fmod[name]?.theme || ctxs.map((c) => functional[c.id]?.purpose).filter(Boolean)[0] || null,
    features: ctxs.length,
    endpoints: ctxs.reduce((a, c) => a + c.routes.length, 0),
  }));
  const rules = [];
  for (const c of model.contexts) { const f = functional[c.id]; if (f?.business_rules) for (const r of f.business_rules) { if (rules.length < 8) rules.push(typeof r === 'string' ? r : r.rule); } }
  const rts = model.routes.map(routeStr);
  const routes = rts.length <= 50 ? rts : { count: rts.length, note: 'too many to inline — grep routes.yaml or use `ask "<kw>"`' };
  return {
    project_brief: {
      frameworks: frameworkSummary(model),
      projects,
      endpoints: routes,
      ...(rules.length ? { key_rules: rules } : {}),
      drill: 'capability-map.yaml (grep) · projects/<p>/<feature>.card.yaml (card) · .yaml (detail) · `ask "<kw>"`',
    },
  };
}

/** Tier-1 CARD: ≤~20 lines, answers most structure/where/what questions on its own. */
function buildCard(c, f) {
  return {
    card: {
      id: c.id, name: f.name || c.name, purpose: f.purpose || null,
      ...(f.capabilities ? { capabilities: f.capabilities } : {}),
      controllers: c.components.map((cp) => cp.n),
      services: Object.keys(c.services),
      endpoints: c.routes.map(routeStr),
      detail: shardRel(c),
    },
  };
}

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
      projects: model.projects.length, contexts: model.contexts.length, endpoints: model.routes.length,
      shard_path: 'projects/<project>/<feature>.card.yaml (tier-1 card, read first) ; .yaml (tier-2 detail)',
    },
    projects: [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ctxs]) => {
      const m = loadModuleFunctional(functional)[name];
      const keywords = (m?.keywords?.length ? m.keywords : moduleKeywords(ctxs.map((c) => c.id), functional));
      return {
        name,
        ...(m?.theme ? { theme: m.theme } : {}),
        ...(keywords.length ? { keywords } : {}),
        features: ctxs.length,
        endpoints: ctxs.reduce((a, c) => a + c.routes.length, 0),
        files: ctxs.reduce((a, c) => a + c.fileCount, 0),
        index: `projects/${name}/_index.yaml`,
      };
    }),
  };
  if (writeIfChanged(join(dir, 'index.yaml'), dump(index))) changed++;

  // TIER-0 project brief: the single inline read for archi/overview/route questions
  if (writeIfChanged(join(dir, 'project-brief.yaml'), dump(buildBrief(model, functional, byProject)))) changed++;

  // per-project index: its feature contexts (one line each)
  for (const [name, ctxs] of byProject) {
    ensureDir(join(dir, 'projects', name));
    const modIndex = {
      project: name,
      contexts: ctxs.sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({
        id: c.id, name: functional[c.id]?.name || c.name,
        purpose: functional[c.id]?.purpose || null,
        controllers: c.components.length, services: Object.keys(c.services).length, endpoints: c.routes.length,
        card: cardRel(c),
      })),
    };
    if (writeIfChanged(join(dir, 'projects', name, '_index.yaml'), dump(modIndex))) changed++;
  }

  // global endpoint table — ONE grep-friendly line per route (was 1 flow-object line each)
  const epLine = (r) => `${r.verb ? r.verb + ' ' : ''}${r.path || '/'}  ${r.target || r.kind || ''}`.trimEnd() + `  (${r.ctx})`;
  if (writeIfChanged(join(dir, 'routes.yaml'),
    dump({ format: 'VERB path  handler  (context)', endpoints: model.routes.map(epLine) }))) changed++;

  // grepable capability map — ONE line per context (id + purpose + capabilities together),
  // so a single grep hit is self-sufficient (id-less multi-line hits were useless)
  const caps = {};
  for (const c of model.contexts) {
    const f = functional[c.id];
    caps[c.id] = `${f?.purpose || ''}${f?.capabilities?.length ? ` — ${f.capabilities.join('; ')}` : ''}`;
  }
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
        framework: c.framework,
        purpose: f.purpose || null,
        ...(stale ? { functional_stale: true } : {}),
        src_hash: c.src_hash,
        ...(f.evidence_hash ? { evidence_hash: f.evidence_hash } : {}),
        ...(f.capabilities ? { capabilities: f.capabilities } : {}),
        ...(f.business_rules ? { business_rules: f.business_rules } : {}),
        use_cases: c.routes.filter((r) => r.flow).map((r) => ({ name: f.intents?.[r.path] || r.target || r.path, flow: r.flow })),
        endpoints: c.routes.map((r) => ({ verb: r.verb, path: r.path, handler: r.target, ...(f.intents?.[r.path] ? { intent: f.intents[r.path] } : {}) })),
        controllers: c.components.map((cp) => ({ n: cp.n, kind: cp.kind, ...(cp.basePath ? { basePath: cp.basePath } : {}), ...(cp.endpoints ? { endpoints: cp.endpoints } : {}), ...(cp.deps ? { deps: cp.deps } : {}) })),
        services: c.services,
        ...(c.modules.length ? { modules: c.modules } : {}),
        ...(Object.keys(c.di).length ? { di: c.di } : {}),
      },
    };
    if (writeIfChanged(path, dump(shard))) changed++;

    // tier-1 card
    const cpath = cardFile(dir, c);
    wanted.add(cpath);
    if (writeIfChanged(cpath, dump(buildCard(c, f)))) changed++;
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
