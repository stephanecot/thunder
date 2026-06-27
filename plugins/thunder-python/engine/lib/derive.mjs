import { shortHash } from './hash.mjs';

const VERBS = { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH', head: 'HEAD', options: 'OPTIONS' };
const MODEL_BASES = /^(BaseModel|Model|Schema|Base|DeclarativeBase)$/;
const decName = (d) => (d.match(/^@([\w.]+)/) || [])[1] || '';
const strArg = (d) => (d.match(/\(\s*r?['"]([^'"]*)['"]/) || [])[1] || '';

/** Routes contributed by one decorator on a handler (FastAPI verb decorators + Flask @route). */
function routesFromDecorator(dec, fn) {
  const dotted = decName(dec);
  const last = dotted.split('.').pop();
  const path = strArg(dec);
  if (VERBS[last]) return [{ verb: VERBS[last], path, fn }];
  if (last === 'route') {
    const ms = (dec.match(/methods\s*=\s*[[(]([^\])]*)[\])]/) || [])[1];
    const verbs = ms ? ms.split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean) : ['GET'];
    return verbs.map((v) => ({ verb: v.toUpperCase(), path, fn }));
  }
  return [];
}

/** Django routes from a `urlpatterns = [...]` assignment value. */
function djangoRoutes(value) {
  const out = [];
  const re = /\b(?:path|re_path|url)\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+(?:\.as_view\(\))?)/g;
  let m;
  while ((m = re.exec(value))) out.push({ verb: 'ANY', path: '/' + m[1].replace(/^\//, ''), fn: m[2].replace(/\.as_view\(\)$/, '') });
  return out;
}

const isModel = (t) => t.bases.some((b) => MODEL_BASES.test(b.split('.').pop())) || (t.decorators || []).some((d) => /^@(dataclass|attr\.s|attrs|define)\b/.test(d));
function modelKind(t) {
  if (t.bases.some((b) => b === 'BaseModel')) return 'pydantic';
  if (t.bases.some((b) => /Model$/.test(b))) return 'django';
  if (t.bases.some((b) => /^(Base|DeclarativeBase)$/.test(b))) return 'sqlalchemy';
  if ((t.decorators || []).some((d) => /dataclass/.test(d))) return 'dataclass';
  return 'model';
}

export function derive(files) {
  const projects = [...new Set(files.map((f) => f.project))].sort();
  const ctxMap = new Map();
  const allRoutes = [];
  const handlerDeps = new Map();

  const getCtx = (project, pkg) => {
    const id = `${project}/${pkg}`;
    if (!ctxMap.has(id)) {
      ctxMap.set(id, {
        id, project, package: pkg, name: pkg.split('.').pop() || pkg,
        module: project, packages: [pkg],
        framework: null, routes: [], models: {}, classes: [], functions: [], di: {},
        files: [], _hashes: [], _sig: new Set(),
      });
    }
    return ctxMap.get(id);
  };

  for (const f of files) {
    const ctx = getCtx(f.project, f.package || '(root)');
    ctx.files.push(f.file);
    ctx._hashes.push(f.hash || '');

    const addRoutes = (rs, deps) => { for (const r of rs) { const e = { ...r, ctx: ctx.id, file: f.file }; ctx.routes.push(e); allRoutes.push(e); if (deps && deps.length) handlerDeps.set(r.fn, deps); } };

    // FastAPI/Flask: decorated functions and methods
    const handlers = [...f.functions, ...f.types.flatMap((t) => t.methods.map((m) => ({ ...m, _cls: t.name })))];
    for (const fn of handlers) {
      for (const d of (fn.decorators || [])) {
        const rs = routesFromDecorator(d, fn._cls ? `${fn._cls}.${fn.name}` : fn.name);
        if (rs.length) { addRoutes(rs, fn.deps); ctx._sig.add('fastflask'); if (decName(d).endsWith('route')) ctx._sig.add('flask'); else ctx._sig.add('fastapi'); }
      }
      if (fn.deps && fn.deps.length) ctx.di[fn._cls ? `${fn._cls}.${fn.name}` : fn.name] = fn.deps;
    }

    // Django urlpatterns
    for (const a of f.assigns) {
      if (a.name === 'urlpatterns') { addRoutes(djangoRoutes(a.value)); ctx._sig.add('django'); }
      if (/APIRouter|FastAPI/.test(a.value)) ctx._sig.add('fastapi');
      if (/Blueprint|Flask\(/.test(a.value)) ctx._sig.add('flask');
    }

    // models + classes
    for (const t of f.types) {
      if (isModel(t)) {
        const kind = modelKind(t);
        ctx.models[t.name] = { kind, fields: t.fields.map((x) => ({ n: x.name, t: x.type })) };
        if (kind === 'django') ctx._sig.add('django');
      } else {
        ctx.classes.push({ n: t.name, bases: t.bases, methods: t.methods.map((m) => ({ n: m.name, sig: m.sig })), file: t.file });
      }
    }
    // top-level non-route functions
    for (const fn of f.functions) if (!(fn.decorators || []).some((d) => routesFromDecorator(d, '').length)) ctx.functions.push({ n: fn.name, sig: fn.sig });
  }

  // flows: route → handler → injected deps
  for (const ctx of ctxMap.values()) {
    const order = ['fastapi', 'flask', 'django'];
    ctx.framework = order.find((fw) => ctx._sig.has(fw)) || 'python';
    for (const r of ctx.routes) {
      const deps = handlerDeps.get(r.fn) || [];
      r.flow = [`${r.verb} ${r.path || '/'}`, r.fn, ...deps].join(' → ');
    }
  }

  const contexts = [...ctxMap.values()].map((ctx) => {
    ctx._hashes.sort();
    ctx.src_hash = shortHash(ctx._hashes.join('|'));
    delete ctx._hashes; delete ctx._sig;
    ctx.fileCount = ctx.files.length;
    return ctx;
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { projects, contexts, routes: allRoutes };
}
