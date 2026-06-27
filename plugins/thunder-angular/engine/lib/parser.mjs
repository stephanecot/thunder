import { neutralize } from './lexer.mjs';

const TYPE_RE = /\b(class|interface|enum)\s+(\w+)/;
const CTRL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do', 'try',
  'throw', 'await', 'yield', 'typeof', 'function', 'super', 'this', 'case',
]);
const MODS = /\b(export|default|public|private|protected|readonly|static|abstract|override|async|declare)\b/g;
const PRIMS = new Set(['string', 'number', 'boolean', 'any', 'void', 'unknown', 'never', 'object', 'Date', 'null', 'undefined', 'symbol', 'bigint']);

/** Find decorators on a cleaned line; return them (with raw args) and the line blanked of them. */
function scanDecorators(cl, rl) {
  const decorators = [];
  const stripped = cl.split('');
  const re = /@([\w.]+)/g;
  let m;
  while ((m = re.exec(cl))) {
    const start = m.index;
    let end = m.index + m[0].length;
    let j = end;
    while (j < cl.length && cl[j] === ' ') j++;
    if (cl[j] === '(') {
      let d = 0, k = j;
      for (; k < cl.length; k++) {
        if (cl[k] === '(') d++;
        else if (cl[k] === ')') { d--; if (d === 0) { k++; break; } }
      }
      end = k;
      decorators.push('@' + m[1] + rl.slice(j, end));
    } else {
      decorators.push('@' + m[1]);
    }
    for (let x = start; x < end; x++) stripped[x] = ' ';
    re.lastIndex = end;
  }
  return { decorators, stripped: stripped.join('') };
}

function splitTopLevel(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Capture text between the first `(` at/after (li,col) and its matching `)`, across lines. */
function captureParens(cleanLines, li, fromCol) {
  let depth = 0, text = '', started = false;
  for (let k = li; k < cleanLines.length; k++) {
    const line = cleanLines[k];
    for (let c = (k === li ? fromCol : 0); c < line.length; c++) {
      const ch = line[c];
      if (ch === '(') { depth++; started = true; if (depth === 1) continue; }
      else if (ch === ')') { depth--; if (depth === 0) return text; }
      if (started && depth >= 1) text += ch;
    }
    text += '\n';
  }
  return text;
}

const paramType = (p) => {
  let s = p.replace(/^(@\w+(\([^)]*\))?\s*)+/, '').replace(MODS, '').trim();
  const colon = s.indexOf(':');
  if (colon < 0) return null;
  return s.slice(colon + 1).split('=')[0].trim();
};

const baseType = (t) => (t || '').replace(/<.*$/, '').replace(/\[\]$/, '').replace(/\s*\|.*$/, '').trim();
// Normalize a URL literal: `${environment.apiUrl}/documents/${id}` → `{apiUrl}/documents/{id}`.
const normalizeUrl = (s) => (s == null ? null : s.replace(/\$\{\s*([^}]+?)\s*\}/g, (_, e) => `{${e.split('.').pop().replace(/\(.*$/, '').trim()}}`));
const isInjectable = (t) => { const b = baseType(t); return b && /^[A-Z]/.test(b) && !PRIMS.has(b); };

function detectMember(rest, restRaw) {
  // constructor handled by caller (needs multi-line params). Methods + properties here.
  const r = rest.replace(/^((?:public|private|protected|readonly|static|abstract|override|declare|async|get|set)\s+)+/, '');
  const mm = r.match(/^([\w$]+)\s*\(([^)]*)\)\s*:?\s*([\w.<>\[\]| ]+)?/);
  if (mm && !CTRL.has(mm[1]) && !/[=:]/.test(r.slice(0, r.indexOf('(')))) {
    const name = mm[1];
    const params = splitTopLevel(mm[2]).map(paramType).filter(Boolean);
    const ret = (mm[3] || '').trim().replace(/\{$/, '').trim();
    const sig = `(${params.join(', ')})` + (ret ? ': ' + ret : '');
    return { kind: 'method', name, sig };
  }
  const pm = r.match(/^([\w$]+)\s*[!?]?\s*(?::\s*([^=;]+))?\s*[=;]/);
  if (pm) {
    const type = (pm[2] || '').trim();
    const inj = restRaw.match(/\binject\s*\(\s*([A-Za-z_]\w*)/);
    return { kind: 'prop', name: pm[1], type, inject: inj ? inj[1] : null };
  }
  return null;
}

/** Find the matching ')' for an open paren at (li, parenCol), scanning across cleaned lines. */
function captureParensSpan(cleanLines, li, parenCol) {
  let depth = 0;
  for (let k = li; k < cleanLines.length; k++) {
    const line = cleanLines[k];
    for (let c = (k === li ? parenCol : 0); c < line.length; c++) {
      if (line[c] === '(') depth++;
      else if (line[c] === ')') { depth--; if (depth === 0) return { endLine: k, endCol: c }; }
    }
  }
  return { endLine: cleanLines.length - 1, endCol: 0 };
}

function sliceRaw(rawLines, sl, sc, el, ec) {
  if (sl === el) return rawLines[sl].slice(sc, ec);
  let s = rawLines[sl].slice(sc) + '\n';
  for (let k = sl + 1; k < el; k++) s += rawLines[k] + '\n';
  return s + rawLines[el].slice(0, ec);
}

/** Extract route definitions ({path, component/loadComponent/redirectTo/children}). */
function extractRoutes(raw, relPath) {
  if (!/\bRoutes?\b|RouterModule|provideRouter/.test(raw) && !/\.routes\.ts$|routing/.test(relPath)) return [];
  const lines = raw.split(/\r?\n/);
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\bpath\s*:\s*['"`]([^'"`]*)['"`]/);
    if (!m) continue;
    // window bounded to the current route object (stop before the next `path:`)
    let win = lines[i];
    for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
      if (/\bpath\s*:/.test(lines[k])) break;
      win += ' ' + lines[k];
    }
    const redir = win.match(/redirectTo\s*:\s*['"]([^'"]*)/);
    const comp = win.match(/component\s*:\s*([A-Za-z_]\w*)/);
    const imp = win.match(/import\(\s*['"]([^'"]+)['"]\s*\)/);
    let target = null, kind = 'component';
    if (redir) { target = redir[1]; kind = 'redirect'; }
    else if (/loadComponent/.test(win)) { kind = 'lazy'; target = imp ? imp[1] : '(lazy)'; }
    else if (/loadChildren/.test(win)) { kind = 'lazy-children'; target = imp ? imp[1] : '(lazy)'; }
    else if (comp) { target = comp[1]; }
    else if (/children\s*:/.test(win)) { kind = 'parent'; }
    // route guards (functional or class), e.g. canActivate: [authGuard, scopeGuard('aura:admin')].
    // Depth-aware split keeps whole expressions so factory-call guards (and their args) survive.
    const gm = win.match(/can(?:Activate|ActivateChild|Match|Deactivate|Load)\s*:\s*\[([\s\S]*?)\]/);
    const guards = gm ? splitTopLevel(gm[1]).map((g) => g.trim()).filter(Boolean) : [];
    routes.push({ path: m[1], target, kind, line: i + 1, ...(guards.length ? { guards } : {}) });
  }
  return routes;
}

const FN_KIND = { CanActivateFn: 'guard', CanActivateChildFn: 'guard', CanMatchFn: 'guard', CanDeactivateFn: 'guard', CanLoadFn: 'guard', HttpInterceptorFn: 'interceptor', ResolveFn: 'resolver' };
const FN_RE = /^\s*export\s+const\s+(\w+)\s*:\s*(CanActivateFn|CanActivateChildFn|CanMatchFn|CanDeactivateFn|CanLoadFn|HttpInterceptorFn|ResolveFn)\b/;

/** Modern Angular functional guards/interceptors/resolvers: `export const x: CanActivateFn = () => {…}`.
 *  Captures the initializer span and its `inject(Y)` dependencies — so they are symbols with DI edges. */
function extractFunctionals(cleanLines) {
  const out = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const m = cleanLines[i].match(FN_RE);
    if (!m) continue;
    let span = '', depth = 0, started = false;
    for (let k = i; k < Math.min(i + 80, cleanLines.length); k++) {
      const l = cleanLines[k];
      span += l + '\n';
      for (const ch of l) { if ('([{'.includes(ch)) { depth++; started = true; } else if (')]}'.includes(ch)) depth--; }
      if (started && depth <= 0) break;
      if (!started && /;\s*$/.test(l)) break;
    }
    const deps = [...new Set([...span.matchAll(/\binject\(\s*([A-Za-z_]\w*)/g)].map((x) => x[1]))];
    out.push({ name: m[1], kind: FN_KIND[m[2]], deps, line: i + 1 });
  }
  return out;
}

/** Parse one TS/Angular file into LOCAL facts (cross-file resolution is DERIVE's job). */
export function parseFile(raw, relPath) {
  const clean = neutralize(raw);
  const cleanLines = clean.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  const file = { file: relPath, types: [] };
  let pending = [];
  let depth = 0;
  const stack = []; // { type, bodyDepth }

  for (let li = 0; li < cleanLines.length; li++) {
    const cl = cleanLines[li];
    const rl = rawLines[li] ?? '';
    if (!cl.trim()) continue;
    if (/^\s*import\s/.test(cl) || /^\s*export\s+\{/.test(cl)) continue;

    // multi-line class decorator (@Component({...}), @NgModule({...})): capture across lines
    // so its object-literal braces never corrupt class brace-depth counting.
    if (cl.trim().startsWith('@')) {
      const at = cl.indexOf('@');
      const nm = (cl.slice(at).match(/^@([\w.]+)/) || [])[1];
      const pc = cl.indexOf('(', at);
      if (nm && pc >= 0) {
        const span = captureParensSpan(cleanLines, li, pc);
        if (span.endLine !== li) {
          pending.push('@' + nm + '(' + sliceRaw(rawLines, li, pc + 1, span.endLine, span.endCol) + ')');
          li = span.endLine;
          continue;
        }
      }
    }

    const { decorators, stripped } = scanDecorators(cl, rl);
    const rest = stripped.trim();
    if (rest === '') { if (decorators.length) pending.push(...decorators); continue; }

    let consumed = false;
    const tm = stripped.match(TYPE_RE);
    if (tm) {
      const after = stripped.slice(tm.index + tm[0].length);
      const ext = after.match(/\bextends\s+([\w.]+\s*(?:<[^>]*>)?)/);
      const impl = after.match(/\bimplements\s+([\w.,\s<>]+?)\s*\{?\s*$/);
      const type = {
        kind: tm[1], name: tm[2], decorators: pending.slice(), line: li + 1,
        ext: ext ? ext[1].trim() : null, impls: impl ? impl[1].trim() : null,
        methods: [], props: [], ctorDeps: [],
      };
      file.types.push(type);
      stack.push({ type, bodyDepth: depth + 1 });
      pending = [];
      consumed = true;
    } else if (stack.length && depth === stack[stack.length - 1].bodyDepth) {
      const top = stack[stack.length - 1].type;
      const ctorAt = stripped.search(/\bconstructor\s*\(/);
      if (ctorAt >= 0) {
        const params = captureParens(cleanLines, li, stripped.indexOf('(', ctorAt));
        for (const p of splitTopLevel(params)) {
          const t = paramType(p);
          if (t && isInjectable(t)) top.ctorDeps.push(baseType(t));
        }
        consumed = true;
      } else {
        // multi-line method signature: capture params across lines so the method isn't missed
        let rest2 = rest;
        const openIdx = stripped.indexOf('(');
        if (openIdx >= 0) {
          let bal = 0;
          for (const ch of stripped) { if (ch === '(') bal++; else if (ch === ')') bal--; }
          if (bal > 0) {
            const span = captureParensSpan(cleanLines, li, openIdx);
            const params = sliceRaw(cleanLines, li, openIdx + 1, span.endLine, span.endCol).replace(/\s+/g, ' ').trim();
            rest2 = (stripped.slice(0, openIdx) + '(' + params + ')').trim();
          }
        }
        const member = detectMember(rest2, rl);
        if (member) {
          const decs = [...pending, ...decorators]; // decorators may be inline (e.g. @Input() title)
          if (member.kind === 'prop') {
            top.props.push({ name: member.name, type: member.type, decorators: decs, inject: member.inject, line: li + 1 });
            if (member.inject && isInjectable(member.inject)) top.ctorDeps.push(baseType(member.inject));
          } else {
            top.methods.push({ name: member.name, sig: member.sig, decorators: decs, line: li + 1 });
          }
          consumed = true;
        }
      }
    }

    // #4 HTTP facet: capture http.<verb>(…) / httpResource(…) inside a service method body and attach
    // it to the enclosing class (its backend contract). Detect on the cleaned line, URL from the raw.
    if (stack.length) {
      const cls = stack[stack.length - 1].type;
      // Receivers that hold an HttpClient: the conventional `http`/`httpClient`, plus any field typed
      // or `inject(HttpClient)`-ed under another name (`private api = inject(HttpClient)`).
      const httpFields = ['http', 'httpClient', ...cls.props.filter((p) => p.inject === 'HttpClient' || baseType(p.type) === 'HttpClient').map((p) => p.name)];
      const recv = `(?:this\\s*\\.\\s*)?(?:${[...new Set(httpFields)].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
      const hv = cl.match(new RegExp(`\\b${recv}\\s*\\.\\s*(get|post|put|delete|patch)\\b`, 'i'));
      // httpResource(...) / httpResource<T>(...) is a reactive GET resource (unless an explicit method).
      if (hv || /\bhttpResource\s*(?:<[^>]*>)?\s*\(/.test(cl)) {
        const verb = (hv ? hv[1] : 'get').toUpperCase();
        const url = normalizeUrl((rl.match(/[`'"]([^`'"]*)[`'"]/) || [])[1] || null);
        (cls.http ||= []).push({ verb, url });
      }
    }

    if (!consumed) pending = [];

    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (stack.length && depth < stack[stack.length - 1].bodyDepth) stack.pop();
      }
    }
  }
  file.routes = extractRoutes(raw, relPath);
  file.functionals = extractFunctionals(cleanLines);
  return file;
}
