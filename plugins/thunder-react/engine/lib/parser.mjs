import { neutralize } from './lexer.mjs';

const TYPE_RE = /\b(class|interface|enum)\s+(\w+)/;
const PRIMS = new Set(['string', 'number', 'boolean', 'any', 'void', 'unknown', 'never', 'object', 'Date', 'null', 'undefined', 'symbol', 'bigint']);

/** Capture the balanced span (parens/brackets/braces) of a declaration starting at line `i`. */
function captureSpan(cleanLines, i, max = 200) {
  let span = '', depth = 0, started = false;
  for (let k = i; k < Math.min(i + max, cleanLines.length); k++) {
    const l = cleanLines[k];
    span += l + '\n';
    for (const ch of l) { if ('([{'.includes(ch)) { depth++; started = true; } else if (')]}'.includes(ch)) depth--; }
    if (started && depth <= 0) return { span, endLine: k };
    if (!started && /;\s*$/.test(l)) return { span, endLine: k };
  }
  return { span, endLine: Math.min(i + max, cleanLines.length) - 1 };
}

const BUILTIN_HOOKS = new Set(['useState', 'useEffect', 'useContext', 'useReducer', 'useMemo', 'useCallback', 'useRef', 'useLayoutEffect', 'useImperativeHandle', 'useTransition', 'useDeferredValue', 'useId', 'useSyncExternalStore']);
// A body "returns JSX" → it's a component (heuristic, deterministic).
const isJsxBody = (span) => /return\s*[(<]|=>\s*[(<]|<\/[A-Za-z]|\/>|<[A-Z][\w.]*[\s/>]/.test(span);

/** Component declaration heads (function / arrow / forwardRef / memo). */
const DECL = [
  /^\s*export\s+default\s+function\s+(\w+)\s*\(/,
  /^\s*export\s+function\s+(\w+)\s*\(/,
  /^\s*function\s+(\w+)\s*\(/,
  /^\s*export\s+default\s+const\s+(\w+)\s*[:=]/,
  /^\s*export\s+const\s+(\w+)\s*[:=]/,
  /^\s*const\s+(\w+)\s*[:=]/,
];

/** First param of a declaration line → a compact props summary (destructured keys or type name). */
function propsOf(line) {
  const m = line.match(/\(([^)]*)\)/) || line.match(/=\s*\(([^)]*)\)/);
  if (!m) return null;
  const p = m[1].trim();
  if (!p) return null;
  const destr = p.match(/^\{([^}]*)\}/);
  if (destr) return destr[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).slice(0, 8);
  const typed = p.match(/:\s*([\w.]+)/);
  return typed ? typed[1] : null;
}

/** Function components + custom hooks → first-class symbols (so `sym` finds them + DI graph). */
function extractReactSymbols(cleanLines) {
  const out = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (/^\s*(import|export\s+\{|export\s+\*|interface|type|enum|class)\b/.test(line)) continue;
    let name = null;
    for (const re of DECL) { const m = line.match(re); if (m) { name = m[1]; break; } }
    if (!name) continue;
    const { span } = captureSpan(cleanLines, i);
    const isHook = /^use[A-Z]/.test(name);
    const isComp = /^[A-Z]/.test(name) && isJsxBody(span);
    if (!isHook && !isComp) continue;
    // hooks invoked in the body (state/effects/custom) — the component's "dependencies".
    // Allow an optional generic so `useState<T>(...)` / `useQuery<T>(...)` are captured.
    const hooks = [...new Set([...span.matchAll(/\b(use[A-Z]\w*)\s*(?:<[^>]*>)?\s*\(/g)].map((x) => x[1]))].filter((h) => h !== name);
    const deps = hooks.filter((h) => !BUILTIN_HOOKS.has(h)); // custom hooks (the DI edges)
    const props = propsOf(line);
    out.push({ name, kind: isHook ? 'hook' : 'component', hooks, deps, ...(props ? { props } : {}), line: i + 1 });
  }
  return out;
}

/** React Router routes: <Route path=".." element={<Comp/>}/> (JSX) or { path, element } (data router). */
function extractReactRoutes(raw) {
  if (!/<Route\b|createBrowserRouter|createHashRouter|createMemoryRouter|useRoutes|RouterProvider/.test(raw)) return [];
  const lines = raw.split(/\r?\n/);
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    let win = lines[i];
    for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) win += ' ' + lines[k];
    // JSX <Route ...>
    if (/<Route\b/.test(lines[i])) {
      const p = win.match(/\bpath\s*=\s*["'`]([^"'`]*)["'`]/);
      const el = win.match(/element\s*=\s*\{\s*<\s*([A-Z][\w.]*)/) || win.match(/\bcomponent\s*=\s*\{?\s*([A-Z][\w.]*)/);
      const index = /\bindex\b/.test(lines[i]) && !p;
      if (p || index || el) routes.push({ path: p ? p[1] : (index ? '(index)' : ''), target: el ? el[1] : null, kind: 'route', line: i + 1 });
      continue;
    }
    // data-router object { path: '...', element: <Comp/> | Component }
    const pm = lines[i].match(/\bpath\s*:\s*["'`]([^"'`]*)["'`]/);
    if (pm && /element\s*:/.test(win)) {
      const el = win.match(/element\s*:\s*<\s*([A-Z][\w.]*)/) || win.match(/element\s*:\s*\{?\s*([A-Z][\w.]*)/);
      routes.push({ path: pm[1], target: el ? el[1] : null, kind: 'route', line: i + 1 });
    }
  }
  return routes;
}

/** Class components: `class X extends React.Component|Component|PureComponent`. */
function extractClassComponents(cleanLines) {
  const out = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const m = cleanLines[i].match(/\bclass\s+(\w+)\s+extends\s+(?:React\.)?(Component|PureComponent)\b/);
    if (m) out.push({ name: m[1], kind: 'component', hooks: [], deps: [], line: i + 1, class: true });
  }
  return out;
}

/** Parse one React (TS/JS/JSX) file into LOCAL facts (cross-file resolution is DERIVE's job). */
export function parseFile(raw, relPath) {
  const clean = neutralize(raw);
  const cleanLines = clean.split(/\r?\n/);
  const file = { file: relPath, types: [] };

  // classes (incl class components) — keep for `sym` + class-component derive
  for (let i = 0; i < cleanLines.length; i++) {
    const m = cleanLines[i].match(TYPE_RE);
    if (m) file.types.push({ kind: m[1], name: m[2], line: i + 1, methods: [], props: [], ctorDeps: [] });
  }

  const symbols = extractReactSymbols(cleanLines);
  const classComps = extractClassComponents(cleanLines);
  file.functionals = [...symbols, ...classComps]; // function components + custom hooks + class components (symbols)
  file.routes = extractReactRoutes(raw);
  return file;
}
