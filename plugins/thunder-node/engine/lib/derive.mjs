import { shortHash } from './hash.mjs';

// NestJS class stereotypes
const STEREO = { Controller: 'controller', Injectable: 'service', Module: 'module' };
const decName = (d) => ((d.match(/^@([\w.]+)/) || [])[1] || '').split('.').pop();
const findDec = (decs, name) => decs.find((d) => decName(d) === name);
const strArg = (dec) => (dec && (dec.match(/\(\s*['"`]([^'"`]*)['"`]/) || [])[1]) || null;
const arrVal = (dec, key) => {
  const m = (dec || '').match(new RegExp(key + '\\s*:\\s*\\[([^\\]]*)\\]'));
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
};

const FW_ORDER = ['nestjs', 'express', 'fastify'];

/** Cross-file derivation from per-file facts → the Node.js model. */
export function derive(files) {
  const projects = [...new Set(files.map((f) => f.project))].sort();
  const ctxMap = new Map();
  const allRoutes = [];
  const handlerDeps = new Map(); // ControllerName -> ctor deps (for endpoint flows)

  const getCtx = (project, feature) => {
    const id = `${project}/${feature}`;
    if (!ctxMap.has(id)) {
      ctxMap.set(id, {
        id, project, feature, name: feature,
        module: project, packages: [feature], // aliases so generic functional/emit code is reused
        components: [], services: {}, modules: [], routes: [], di: {},
        framework: 'node', _fw: new Set(), files: [], _hashes: [],
      });
    }
    return ctxMap.get(id);
  };

  for (const f of files) {
    const ctx = getCtx(f.project, f.feature || 'app');
    ctx.files.push(f.file);
    ctx._hashes.push(f.hash || '');
    for (const s of (f.fw || [])) ctx._fw.add(s);

    for (const r of (f.routes || [])) { const e = { ...r, ctx: ctx.id }; ctx.routes.push(e); allRoutes.push(e); }

    for (const t of f.types) {
      const stereo = t.decorators.map(decName).map((n) => STEREO[n]).find(Boolean);
      const deps = [...new Set(t.ctorDeps || [])];

      if (stereo === 'service') {
        const dec = findDec(t.decorators, 'Injectable') || '';
        ctx.services[t.name] = { scope: strArg(dec) || null, ...(deps.length ? { deps } : {}) };
      } else if (stereo === 'module') {
        const dec = findDec(t.decorators, 'Module') || '';
        ctx.modules.push({
          n: t.name,
          controllers: arrVal(dec, 'controllers'),
          providers: arrVal(dec, 'providers'),
          imports: arrVal(dec, 'imports'),
          exports: arrVal(dec, 'exports'),
        });
      } else if (stereo === 'controller' || t.kind === 'class') {
        // controllers + plain exported classes (Express handlers, models) — visible units
        const eps = f.routes.filter((r) => (r.target || '').startsWith(t.name + '.')).length;
        ctx.components.push({
          n: t.name, kind: stereo || 'class',
          ...(t.basePath ? { basePath: t.basePath } : {}),
          ...(deps.length ? { deps } : {}),
          ...(eps ? { endpoints: eps } : {}),
          line: t.line, file: t.file,
        });
        handlerDeps.set(t.name, deps);
      }

      if (deps.length && stereo) ctx.di[t.name] = deps;
    }
  }

  // flows: VERB path → handler → injected services, deterministic
  for (const ctx of ctxMap.values()) {
    ctx.framework = FW_ORDER.find((fw) => ctx._fw.has(fw)) || 'node';
    for (const r of ctx.routes) {
      const ctrl = (r.target || '').split('.')[0];
      const deps = handlerDeps.get(ctrl) || [];
      r.flow = [`${r.verb} ${r.path}`, r.target, ...deps].filter(Boolean).join(' → ');
    }
  }

  const contexts = [...ctxMap.values()].map((ctx) => {
    ctx._hashes.sort();
    ctx.src_hash = shortHash(ctx._hashes.join('|'));
    delete ctx._hashes; delete ctx._fw;
    ctx.fileCount = ctx.files.length;
    return ctx;
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { projects, contexts, routes: allRoutes };
}
