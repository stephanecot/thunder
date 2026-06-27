import { shortHash } from './hash.mjs';

const STEREOTYPE = {
  RestController: 'controller', Controller: 'controller',
  Service: 'service', Repository: 'repository',
  Component: 'component', Configuration: 'config',
};
const VERB = {
  GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT',
  DeleteMapping: 'DELETE', PatchMapping: 'PATCH',
};
const REPO_BASE = /\b(JpaRepository|CrudRepository|PagingAndSortingRepository|MongoRepository|Repository)\s*<\s*([\w.]+)/;
const NON_BEAN = new Set([
  'String', 'Long', 'Integer', 'int', 'long', 'boolean', 'Boolean', 'double', 'Double',
  'float', 'Float', 'BigDecimal', 'List', 'Set', 'Map', 'Optional', 'Object', 'void', 'UUID', 'LocalDate', 'LocalDateTime',
]);

const annName = (a) => ((a.match(/^@([\w.]+)/) || [])[1] || '').split('.').pop();
const firstString = (a) => (a.match(/"([^"]*)"/) || [])[1] || '';
const hasAnn = (anns, name) => anns.some((a) => annName(a) === name);
const findAnn = (anns, name) => anns.find((a) => annName(a) === name);
const stripGeneric = (t) => t.replace(/<.*>/, '').replace(/\[\]/, '').trim();
const innerGeneric = (t) => (t.match(/<\s*([\w.]+)/) || [])[1] || stripGeneric(t);

function joinPath(base, sub) {
  const a = base ? '/' + base.replace(/^\/|\/$/g, '') : '';
  const b = sub ? '/' + sub.replace(/^\/|\/$/g, '') : '';
  const p = (a + b).replace(/\/+/g, '/');
  return p === '' ? '/' : p;
}

function sigParamTypes(sig) {
  const inner = (sig.match(/^\(([^)]*)\)/) || [])[1] || '';
  return inner.split(',').map((s) => stripGeneric(s.trim())).filter(Boolean);
}

/** Cross-file derivation from per-file facts → the full technical model. */
export function derive(files) {
  const modules = [...new Set(files.map((f) => f.module))].sort();

  // index every type, and which entity each repository serves
  const repoOf = new Map(); // entityName -> repoName
  for (const f of files) {
    for (const t of f.types) {
      if (t.ext) {
        const m = t.ext.match(REPO_BASE);
        if (m) repoOf.set(m[2].split('.').pop(), t.name);
      }
    }
  }

  const ctxMap = new Map(); // key -> context
  const allEndpoints = [];

  const ctxKey = (module, pkg) => `${module}::${pkg}`;
  const getCtx = (module, pkg) => {
    const key = ctxKey(module, pkg);
    if (!ctxMap.has(key)) {
      ctxMap.set(key, {
        id: `${module}/${pkg}`, module, packages: [pkg],
        name: pkg.split('.').pop(),
        types: [], endpoints: [], beans: {}, entities: {},
        files: [], _hashes: [],
      });
    }
    return ctxMap.get(key);
  };

  for (const f of files) {
    const ctx = getCtx(f.module, f.pkg || '(default)');
    ctx.files.push(f.file);
    ctx._hashes.push(f.hash || '');

    for (const t of f.types) {
      ctx.types.push({
        k: t.kind, n: t.name, ann: t.ann, l: t.line, file: f.file,
        methods: t.methods.map((m) => ({ n: m.name, sig: m.sig, l: m.line })),
        fields: t.fields.map((fl) => ({ n: fl.name, t: fl.type, ann: fl.ann || [], l: fl.line })),
      });

      const stereo = t.ann.map(annName).map((n) => STEREOTYPE[n]).find(Boolean);

      // bean + dependency graph
      if (stereo) {
        const ctor = t.methods.find((m) => m.isCtor);
        const ctorDeps = ctor ? sigParamTypes(ctor.sig) : [];
        const fieldDeps = t.fields.filter((fl) => hasAnn(fl.ann || [], 'Autowired')).map((fl) => stripGeneric(fl.type));
        const deps = [...new Set([...ctorDeps, ...fieldDeps])].filter((d) => d && !NON_BEAN.has(d));
        ctx.beans[t.name] = { type: t.ann.map(annName).find((n) => STEREOTYPE[n]) ? '@' + t.ann.map(annName).find((n) => STEREOTYPE[n]) : null, deps };
      }

      // entity
      if (hasAnn(t.ann, 'Entity')) {
        const table = firstString(findAnn(t.ann, 'Table') || '') || t.name.toLowerCase();
        const rel = [];
        for (const fl of t.fields) {
          for (const r of ['OneToMany', 'ManyToOne', 'OneToOne', 'ManyToMany']) {
            if (hasAnn(fl.ann || [], r)) rel.push({ [r]: innerGeneric(fl.type) });
          }
        }
        ctx.entities[t.name] = { table, rel, repo: repoOf.get(t.name) || null };
      }

      // endpoints
      if (stereo === 'controller') {
        const classPath = firstString(findAnn(t.ann, 'RequestMapping') || '');
        for (const m of t.methods) {
          const mapAnn = (m.ann || []).find((a) => VERB[annName(a)] || annName(a) === 'RequestMapping');
          if (!mapAnn) continue;
          let verb = VERB[annName(mapAnn)];
          if (!verb) verb = (mapAnn.match(/RequestMethod\.(\w+)/) || [])[1] || 'ANY';
          const resp = (m.sig.split('):')[1] || '').trim() || null;
          const req = m.reqBody || null; // the @RequestBody param type (clean), not a naive comma split
          const ep = {
            verb, path: joinPath(classPath, firstString(mapAnn)),
            fn: `${t.name}.${m.name}`, l: m.line,
            ctx: ctx.id, controller: t.name, req, resp,
          };
          ctx.endpoints.push(ep);
          allEndpoints.push(ep);
        }
      }
    }
  }

  // flows derived from the bean wiring graph (deterministic; model only names them later)
  const allBeans = {};
  for (const ctx of ctxMap.values()) Object.assign(allBeans, ctx.beans);
  const depsOf = (name) => (allBeans[name]?.deps || []);
  const firstOfKind = (deps, suffix) => deps.find((d) => d.endsWith(suffix));

  for (const ctx of ctxMap.values()) {
    for (const ep of ctx.endpoints) {
      const chain = [`${ep.verb} ${ep.path}`, `${ep.fn}`];
      const svc = firstOfKind(depsOf(ep.controller), 'Service') || depsOf(ep.controller)[0];
      if (svc) {
        chain.push(svc);
        const repo = firstOfKind(depsOf(svc), 'Repository') || depsOf(svc).find((d) => d.endsWith('Repo'));
        if (repo) chain.push(repo);
      }
      ep.flow = chain.join(' → ');
    }
  }

  const contexts = [...ctxMap.values()].map((ctx) => {
    ctx._hashes.sort();
    ctx.src_hash = shortHash(ctx._hashes.join('|'));
    delete ctx._hashes;
    ctx.fileCount = ctx.files.length;
    return ctx;
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { modules, contexts, endpoints: allEndpoints };
}
