import { neutralize } from './lexer.mjs';

const indentOf = (line) => (line.match(/^[ \t]*/)[0].replace(/\t/g, '        ')).length;

/** Capture text between the first `(` at/after `from` and its matching `)` on a single (logical) line. */
function parenSpan(s, from) {
  const open = s.indexOf('(', from);
  if (open < 0) return { params: '', after: s.slice(from) };
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return { params: s.slice(open + 1, i), after: s.slice(i + 1) }; }
  }
  return { params: s.slice(open + 1), after: '' };
}

function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** "id: int = Depends(x)" -> "id: int" (name + annotation, default dropped). */
function paramSig(p) {
  const s = p.trim();
  if (!s || s === 'self' || s === 'cls' || s.startsWith('*')) return s.startsWith('*') ? null : s;
  const eq = (() => { let d = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (c === '=' && d === 0) return i; } return -1; })();
  return (eq >= 0 ? s.slice(0, eq) : s).trim();
}

/** Build logical lines: join physical lines while inside (), [], {} or after a trailing backslash. */
function logicalLines(cleanLines, rawLines) {
  const out = [];
  let i = 0;
  while (i < cleanLines.length) {
    if (!cleanLines[i].trim()) { i++; continue; }
    const start = i;
    let clean = '', raw = '', depth = 0;
    for (;;) {
      const cl = cleanLines[i];
      clean += (clean ? ' ' : '') + cl.trim();
      raw += (raw ? '\n' : '') + (rawLines[i] ?? '');
      for (const ch of cl) { if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; }
      const cont = depth > 0 || /\\\s*$/.test(cl);
      if (!cont || i + 1 >= cleanLines.length) break;
      i++;
    }
    out.push({ line: start + 1, indent: indentOf(cleanLines[start]), clean, raw });
    i++;
  }
  return out;
}

/** Parse one Python file into LOCAL facts (no cross-file resolution — that is DERIVE's job). */
export function parseFile(raw, relPath) {
  const cleanLines = neutralize(raw).split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  const file = { file: relPath, imports: [], types: [], functions: [], assigns: [] };
  const stack = []; // { kind:'class'|'def'|'block', node, indent }
  let pending = []; // decorators (raw)

  for (const L of logicalLines(cleanLines, rawLines)) {
    const { indent, clean, raw: lraw } = L;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];
    const inClass = top && top.kind === 'class';
    const inDef = top && top.kind === 'def';

    if (/^(from\s+\S+\s+import|import\s+)/.test(clean)) { continue; }

    if (clean.startsWith('@')) {
      const nm = (clean.match(/^@([\w.]+)/) || [])[1] || '';
      const rawDec = lraw.replace(/\s+/g, ' ').trim();
      pending.push(rawDec.startsWith('@') ? rawDec : '@' + nm);
      continue;
    }

    let cm = clean.match(/^class\s+(\w+)\s*/);
    if (cm) {
      const sp = clean.indexOf('(') >= 0 && clean.indexOf('(') < clean.indexOf(':') ? parenSpan(clean, cm[0].length) : { params: '' };
      const bases = splitTop(sp.params).map((b) => b.split('=').pop().trim()).filter(Boolean);
      const node = { kind: 'class', name: cm[1], bases, decorators: pending.slice(), line: L.line, methods: [], fields: [] };
      file.types.push(node);
      stack.push({ kind: 'class', node, indent });
      pending = [];
      continue;
    }

    const dm = clean.match(/^(async\s+)?def\s+(\w+)\s*/);
    if (dm) {
      const sp = parenSpan(clean, dm[0].length);
      const parts = splitTop(sp.params);
      const params = parts.map(paramSig).filter(Boolean).join(', ');
      const ret = (sp.after.match(/->\s*([^:]+):/) || [])[1];
      const deps = parts.map((p) => { const d = p.match(/=\s*Depends\(\s*([\w.]*)/); if (!d) return null; return d[1] || (p.match(/:\s*([\w.]+)/) || [])[1] || null; }).filter(Boolean);
      const node = { name: dm[2], async: !!dm[1], sig: `(${params})` + (ret ? ' -> ' + ret.trim() : ''), decorators: pending.slice(), deps, line: L.line };
      if (inClass) top.node.methods.push(node); else file.functions.push(node);
      stack.push({ kind: 'def', node, indent });
      pending = [];
      continue;
    }

    // compound-statement header (if/for/with/try/...) — track indentation but no member
    if (/:\s*$/.test(clean) && !inDef) { stack.push({ kind: 'block', node: null, indent }); pending = []; continue; }

    if (inClass && !inDef) {
      const fm = clean.match(/^(\w+)\s*(?::\s*([^=]+?))?\s*(=.*)?$/);
      if (fm && fm[1] && (fm[2] || fm[3])) {
        let type = (fm[2] || '').trim() || null;
        if (!type && fm[3]) { const c = fm[3].match(/=\s*([\w.]+)\s*\(/); if (c) type = c[1]; }
        top.node.fields.push({ name: fm[1], type, decorators: pending.slice(), line: L.line });
      }
      pending = [];
      continue;
    }

    if (indent === 0 && !inDef) {
      const am = clean.match(/^(\w+)\s*[:=]/);
      if (am) file.assigns.push({ name: am[1], value: lraw.replace(/\s+/g, ' ').trim(), line: L.line });
    }
    pending = [];
  }
  return file;
}
