import { neutralize } from './lexer.mjs';

const TYPE_RE = /\b(class|interface|enum|record)\s+(\w+)/;
const CTRL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new',
  'else', 'do', 'try', 'throw', 'assert', 'case', 'super', 'this',
]);
const MODS = /\b(public|private|protected|static|final|abstract|synchronized|native|default|volatile|transient)\b/g;

/** Find annotations on a cleaned line; return them (with raw args) and the line blanked of them.
 *  Matches FULLY-QUALIFIED names (e.g. @io.swagger…Tag) so the qualifier is not mistaken for a member. */
function scanAnnotations(cl, rl) {
  const anns = [];
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
      anns.push('@' + m[1] + rl.slice(j, end));
    } else {
      anns.push('@' + m[1]);
    }
    for (let x = start; x < end; x++) stripped[x] = ' ';
    re.lastIndex = end;
  }
  return { anns, stripped: stripped.join('') };
}

function splitParams(params) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of params) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function paramType(p) {
  let s = p.trim().replace(/^(@\w+(\([^)]*\))?\s+)+/, '').replace(/\bfinal\b/g, '').trim();
  s = s.replace(/\.\.\./, '[]'); // varargs -> array
  const toks = s.split(/\s+/);
  return toks.length <= 1 ? s : toks.slice(0, -1).join(' ');
}

/** Find the matching ')' for an open paren at (li, parenCol), scanning across cleaned lines. */
function captureParensSpan(lines, li, parenCol) {
  let depth = 0;
  for (let k = li; k < lines.length; k++) {
    const line = lines[k];
    for (let c = (k === li ? parenCol : 0); c < line.length; c++) {
      if (line[c] === '(') depth++;
      else if (line[c] === ')') { depth--; if (depth === 0) return { endLine: k, endCol: c }; }
    }
  }
  return { endLine: lines.length - 1, endCol: 0 };
}

function sliceLines(lines, sl, sc, el, ec) {
  if (sl === el) return lines[sl].slice(sc, ec);
  let s = lines[sl].slice(sc) + ' ';
  for (let k = sl + 1; k < el; k++) s += lines[k] + ' ';
  return s + lines[el].slice(0, ec);
}

function detectMember(rest, typeName) {
  const open = rest.indexOf('(');
  if (open >= 0) {
    const nameM = rest.slice(0, open).match(/([\w$]+)\s*$/);
    const before = nameM ? rest.slice(0, nameM.index) : '';
    // a method/constructor decl: a bare name right before '(', and no '=' before it (else it's a
    // field initializer call like `x = factory.create()`).
    if (nameM && !CTRL.has(nameM[1]) && !/=/.test(before)) {
      const name = nameM[1];
      // depth-aware matching ')' — params may contain parens (annotation args like @RequestParam(...))
      let depth = 0, end = -1;
      for (let i = open; i < rest.length; i++) {
        if (rest[i] === '(') depth++;
        else if (rest[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      const params = (end >= 0 ? rest.slice(open + 1, end) : rest.slice(open + 1)).trim();
      const isCtor = name === typeName && before.replace(MODS, '').trim() === '';
      const ret = isCtor ? null : (before.replace(MODS, '').replace(/\s+/g, ' ').trim() || null);
      const parts = splitParams(params);
      const types = parts.map(paramType).filter(Boolean);
      const bodyPart = parts.find((p) => /@RequestBody\b/.test(p));
      const sig = `(${types.join(', ')})` + (ret ? ':' + ret : '');
      return { kind: 'method', name, sig, isCtor, reqBody: bodyPart ? paramType(bodyPart) : null };
    }
  }
  const fm = rest.match(/^([\w.$<>\[\],\s]+?)\s+(\w+)\s*[=;]/);
  if (fm) {
    const type = fm[1].replace(MODS, '').replace(/\s+/g, ' ').trim();
    if (!type) return null;
    return { kind: 'field', name: fm[2], type };
  }
  return null;
}

/** Parse one Java file into LOCAL facts (no cross-file resolution — that is DERIVE's job). */
export function parseFile(raw, relPath) {
  const clean = neutralize(raw);
  const cleanLines = clean.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  const file = { file: relPath, pkg: null, types: [] };
  let pending = [];
  let depth = 0;
  const stack = []; // { type, bodyDepth }

  for (let li = 0; li < cleanLines.length; li++) {
    const cl = cleanLines[li];
    const rl = rawLines[li] ?? '';
    if (!cl.trim()) continue;

    if (!file.pkg) {
      const pm = cl.match(/^\s*package\s+([\w.]+)\s*;/);
      if (pm) { file.pkg = pm[1]; continue; }
    }
    if (/^\s*import\s/.test(cl)) continue;

    // multi-line annotation args (e.g. @ApiOperation(\n summary = "...",\n ...)): capture across lines so
    // the object/paren content never desyncs counting and the annotation attaches to the next declaration.
    if (cl.trim().startsWith('@')) {
      const at = cl.indexOf('@');
      const nm = (cl.slice(at).match(/^@([\w.]+)/) || [])[1];
      const pc = cl.indexOf('(', at);
      if (nm && pc >= 0) {
        let bal = 0;
        for (let c = pc; c < cl.length; c++) { if (cl[c] === '(') bal++; else if (cl[c] === ')') bal--; }
        if (bal > 0) {
          const span = captureParensSpan(cleanLines, li, pc);
          pending.push('@' + nm + '(' + sliceLines(rawLines, li, pc + 1, span.endLine, span.endCol).replace(/\s+/g, ' ') + ')');
          li = span.endLine;
          continue;
        }
      }
    }

    const { anns, stripped } = scanAnnotations(cl, rl);
    const rest = stripped.trim();

    if (rest === '') { if (anns.length) pending.push(...anns); continue; }

    let consumed = false;
    const tm = stripped.match(TYPE_RE);
    if (tm) {
      const after = stripped.slice(tm.index + tm[0].length);
      const ext = after.match(/\bextends\s+([\w.]+\s*(?:<[^>]*>)?)/);
      const impl = after.match(/\bimplements\s+([\w.,\s<>]+?)\s*\{?\s*$/);
      const type = {
        kind: tm[1], name: tm[2], ann: pending.slice(), line: li + 1,
        ext: ext ? ext[1].trim() : null,
        impls: impl ? impl[1].trim() : null,
        methods: [], fields: [],
      };
      file.types.push(type);
      stack.push({ type, bodyDepth: depth + 1 });
      pending = [];
      consumed = true;
    } else if (stack.length && depth === stack[stack.length - 1].bodyDepth) {
      const top = stack[stack.length - 1].type;
      // Always capture the param list from the CLEANED source (annotations retained): this catches
      // multi-line signatures AND keeps @RequestBody param types detectable (scanAnnotations would
      // have blanked them on a single line).
      let rest2 = rest;
      const openIdx = stripped.indexOf('(');
      if (openIdx >= 0) {
        const span = captureParensSpan(cleanLines, li, openIdx);
        const params = sliceLines(cleanLines, li, openIdx + 1, span.endLine, span.endCol).replace(/\s+/g, ' ').trim();
        rest2 = (stripped.slice(0, openIdx) + '(' + params + ')').trim();
      }
      const member = detectMember(rest2, top.name);
      if (member) {
        member.ann = pending.slice();
        member.line = li + 1;
        (member.kind === 'field' ? top.fields : top.methods).push(member);
        pending = [];
        consumed = true;
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
  return file;
}
