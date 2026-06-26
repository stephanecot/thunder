/**
 * TypeScript source "neutralizer" — same role as the Java one, but TS-aware.
 *
 * Returns a string of identical length where every character inside a comment, string,
 * or template literal (including `${ ... }` interpolations, recursively) is replaced by a
 * space (newlines preserved). Real code braces/parens and decorator `@` are left intact, so
 * structural brace-counting is reliable. Offsets are preserved so the parser can read
 * decorator arguments (selectors, paths…) from the RAW source at the same positions.
 *
 * Pure char state-machine, zero dependencies. Note: regex literals are not specially handled
 * (rare in Angular app code); a `{` inside a regex could in theory be miscounted.
 */
export function neutralize(src) {
  const n = src.length;
  const out = new Array(n);
  let i = 0;
  const blank = (k) => { out[k] = src[k] === '\n' ? '\n' : ' '; };

  function skipLine() { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } }
  function skipBlock() {
    out[i] = ' '; out[i + 1] = ' '; i += 2;
    while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
    if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
  }
  function skipString(q) {
    out[i] = ' '; i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) blank(i + 1); i += 2; continue; }
      blank(i); i++;
    }
    if (i < n) { out[i] = ' '; i++; }
  }
  function skipTemplate() {
    out[i] = ' '; i++; // opening backtick
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out[i] = ' '; if (i + 1 < n) blank(i + 1); i += 2; continue; }
      if (c === '`') { out[i] = ' '; i++; return; }
      if (c === '$' && src[i + 1] === '{') { out[i] = ' '; out[i + 1] = ' '; i += 2; skipInterp(); continue; }
      blank(i); i++;
    }
  }
  function skipInterp() {
    let depth = 1;
    while (i < n && depth > 0) {
      const c = src[i];
      if (c === '\'' || c === '"') { skipString(c); continue; }
      if (c === '`') { skipTemplate(); continue; }
      if (c === '/' && src[i + 1] === '/') { skipLine(); continue; }
      if (c === '/' && src[i + 1] === '*') { skipBlock(); continue; }
      if (c === '{') { depth++; blank(i); i++; continue; }
      if (c === '}') { depth--; blank(i); i++; continue; }
      blank(i); i++;
    }
  }

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { skipLine(); continue; }
    if (c === '/' && src[i + 1] === '*') { skipBlock(); continue; }
    if (c === '\'' || c === '"') { skipString(c); continue; }
    if (c === '`') { skipTemplate(); continue; }
    out[i] = c; i++;
  }
  return out.join('');
}
