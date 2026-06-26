/**
 * Java source "neutralizer" — the foundation that makes structural parsing reliable.
 *
 * It returns a string of IDENTICAL length to the input where every character that
 * lives inside a comment, string literal, char literal or text block is replaced by
 * a space (newlines preserved). Real code — including braces, parens and annotation
 * `@` — is left untouched.
 *
 * Because length and line offsets are preserved, the parser can:
 *   - count braces/parens on the CLEANED view (no false positives from "{" in a string)
 *   - read annotation argument text from the RAW view at the same offsets.
 *
 * Pure char state-machine, zero dependencies. Handles: // line, /* block,
 * "..." string, '.' char, """ text block """, and backslash escapes.
 */
export function neutralize(src) {
  const n = src.length;
  const out = new Array(n);
  let i = 0;
  const blank = (idx) => { out[idx] = src[idx] === '\n' ? '\n' : ' '; };

  while (i < n) {
    const c = src[i];

    // line comment
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    // block comment
    if (c === '/' && src[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    // text block """ ... """
    if (c === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      out[i] = out[i + 1] = out[i + 2] = ' '; i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) { blank(i); i++; }
      if (i < n) { out[i] = out[i + 1] = out[i + 2] = ' '; i += 3; }
      continue;
    }
    // string literal
    if (c === '"') {
      out[i] = ' '; i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) blank(i + 1); i += 2; continue; }
        blank(i); i++;
      }
      if (i < n) { out[i] = ' '; i++; }
      continue;
    }
    // char literal
    if (c === '\'') {
      out[i] = ' '; i++;
      while (i < n && src[i] !== '\'') {
        if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i += 2; continue; }
        out[i] = ' '; i++;
      }
      if (i < n) { out[i] = ' '; i++; }
      continue;
    }

    out[i] = c; i++;
  }
  return out.join('');
}
