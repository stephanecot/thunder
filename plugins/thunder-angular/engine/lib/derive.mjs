import { shortHash } from './hash.mjs';

const STEREO = { Component: 'component', Injectable: 'service', NgModule: 'module', Directive: 'directive', Pipe: 'pipe' };
const decName = (d) => (d.match(/^@(\w+)/) || [])[1] || '';
const hasDec = (decs, name) => decs.some((d) => decName(d) === name);
const findDec = (decs, name) => decs.find((d) => decName(d) === name);
const strVal = (dec, key) => (dec.match(new RegExp(key + "\\s*:\\s*['\"]([^'\"]*)")) || [])[1] || null;
const boolVal = (dec, key) => new RegExp(key + '\\s*:\\s*true').test(dec || '');
const arrVal = (dec, key) => {
  const m = (dec || '').match(new RegExp(key + '\\s*:\\s*\\[([^\\]]*)\\]'));
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
};

/** Cross-file derivation from per-file facts → the Angular model. */
export function derive(files) {
  const projects = [...new Set(files.map((f) => f.project))].sort();
  const ctxMap = new Map();
  const allRoutes = [];
  const componentDeps = new Map(); // ComponentName -> deps

  const getCtx = (project, feature) => {
    const id = `${project}/${feature}`;
    if (!ctxMap.has(id)) {
      ctxMap.set(id, {
        id, project, feature, name: feature,
        module: project, packages: [feature], // aliases so generic functional/emit code is reused
        components: [], services: {}, modules: [], directives: [], pipes: [],
        routes: [], di: {}, files: [], _hashes: [],
      });
    }
    return ctxMap.get(id);
  };

  for (const f of files) {
    const ctx = getCtx(f.project, f.feature || 'app');
    ctx.files.push(f.file);
    ctx._hashes.push(f.hash || '');

    for (const r of (f.routes || [])) { const e = { ...r, ctx: ctx.id }; ctx.routes.push(e); allRoutes.push(e); }

    for (const t of f.types) {
      const stereo = t.decorators.map(decName).map((n) => STEREO[n]).find(Boolean);
      const deps = [...new Set(t.ctorDeps || [])];

      if (stereo === 'component' || stereo === 'directive') {
        const dec = findDec(t.decorators, stereo === 'component' ? 'Component' : 'Directive') || '';
        const inputs = t.props.filter((p) => hasDec(p.decorators || [], 'Input')).map((p) => p.name);
        const outputs = t.props.filter((p) => hasDec(p.decorators || [], 'Output')).map((p) => p.name);
        const entry = {
          n: t.name, selector: strVal(dec, 'selector'),
          standalone: boolVal(dec, 'standalone'),
          inputs, outputs, deps, line: t.line, file: t.file, kind: stereo,
        };
        ctx.components.push(entry);
        componentDeps.set(t.name, deps);
      } else if (stereo === 'service') {
        const dec = findDec(t.decorators, 'Injectable') || '';
        ctx.services[t.name] = { providedIn: strVal(dec, 'providedIn'), deps };
      } else if (stereo === 'pipe') {
        const dec = findDec(t.decorators, 'Pipe') || '';
        ctx.pipes.push({ n: t.name, name: strVal(dec, 'name'), deps });
      } else if (stereo === 'module') {
        const dec = findDec(t.decorators, 'NgModule') || '';
        ctx.modules.push({
          n: t.name,
          declarations: arrVal(dec, 'declarations'),
          imports: arrVal(dec, 'imports'),
          providers: arrVal(dec, 'providers'),
          exports: arrVal(dec, 'exports'),
        });
      }

      if (deps.length && (stereo === 'component' || stereo === 'service' || stereo === 'directive')) {
        ctx.di[t.name] = deps;
      }
    }
  }

  // flows: route → component → injected services (deterministic, named later)
  for (const ctx of ctxMap.values()) {
    for (const r of ctx.routes) {
      if (r.kind === 'component' && r.target) {
        const deps = componentDeps.get(r.target) || [];
        const chain = [`route '${r.path || '/'}'`, r.target, ...deps];
        r.flow = chain.join(' → ');
      } else if (r.target) {
        r.flow = `route '${r.path || '/'}' → ${r.kind === 'redirect' ? '↪ ' + r.target : r.target}`;
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
