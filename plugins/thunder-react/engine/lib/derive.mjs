import { shortHash } from './hash.mjs';

/** Cross-file derivation from per-file facts → the React model. */
export function derive(files) {
  const projects = [...new Set(files.map((f) => f.project))].sort();
  const ctxMap = new Map();
  const allRoutes = [];
  const compDeps = new Map(); // ComponentName -> custom-hook deps (for route flows)

  const getCtx = (project, feature) => {
    const id = `${project}/${feature}`;
    if (!ctxMap.has(id)) {
      ctxMap.set(id, {
        id, project, feature, name: feature,
        module: project, packages: [feature], // aliases so generic functional/emit code is reused
        components: [], services: {}, routes: [], di: {},
        framework: 'react', files: [], _hashes: [],
      });
    }
    return ctxMap.get(id);
  };

  for (const f of files) {
    const ctx = getCtx(f.project, f.feature || 'app');
    ctx.files.push(f.file);
    ctx._hashes.push(f.hash || '');

    for (const r of (f.routes || [])) { const e = { ...r, ctx: ctx.id }; ctx.routes.push(e); allRoutes.push(e); }

    for (const s of (f.functionals || [])) {
      if (s.kind === 'hook') {
        // custom hooks are the reusable logic units → modeled as "services"
        ctx.services[s.name] = { ...(s.hooks && s.hooks.length ? { hooks: s.hooks } : {}), ...(s.deps && s.deps.length ? { deps: s.deps } : {}) };
        if (s.deps && s.deps.length) ctx.di[s.name] = s.deps;
      } else { // component (function or class)
        ctx.components.push({
          n: s.name, kind: s.class ? 'class' : 'function',
          ...(s.props ? { props: s.props } : {}),
          ...(s.hooks && s.hooks.length ? { hooks: s.hooks } : {}),
          ...(s.deps && s.deps.length ? { deps: s.deps } : {}),
          line: s.line, file: f.file,
        });
        compDeps.set(s.name, s.deps || []);
        if (s.deps && s.deps.length) ctx.di[s.name] = s.deps;
      }
    }
  }

  // flows: route → component → custom hooks it uses, deterministic
  for (const ctx of ctxMap.values()) {
    for (const r of ctx.routes) {
      if (r.target) {
        const deps = compDeps.get(r.target) || [];
        r.flow = [`route '${r.path || '/'}'`, r.target, ...deps].filter(Boolean).join(' → ');
      }
    }
  }

  const contexts = [...ctxMap.values()].map((ctx) => {
    ctx._hashes.sort();
    ctx.src_hash = shortHash(ctx._hashes.join('|'));
    delete ctx._hashes;
    ctx.fileCount = ctx.files.length;
    return ctx;
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { projects, contexts, routes: allRoutes };
}
