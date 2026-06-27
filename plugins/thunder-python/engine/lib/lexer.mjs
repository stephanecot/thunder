/**
 * Python source "neutralizer". Returns a string of identical length where every character inside a
 * comment (`# …`), a string (`'…'`, `"…"`), a triple-quoted string / docstring (`'''…'''`, `"""…"""`)
 * or a prefixed string (f/r/b/u, e.g. `f"…{x}…"`) is replaced by a space (newlines + leading
 * indentation preserved). Real code — `def`, `class`, `@`, `:`, identifiers — and INDENTATION are left
 * intact, so the indentation-based parser is reliable. Offsets preserved → decorator args readable from
 * the raw source. Pure char state-machine, zero dependencies.
 */
const STR = /^([rbfuRBFU]{0,2})('''|"""|'|")/;

export function neutralize(src) {
  const n = src.length;
  const out = new Array(n);
  let i = 0;
  const blank = (k) => { out[k] = src[k] === '\n' ? '\n' : ' '; };

  while (i < n) {
    const c = src[i];
    if (c === '#') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } continue; }

    const m = STR.exec(src.slice(i, i + 5));
    if (m) {
      const quote = m[2];
      for (let p = 0; p < m[1].length; p++) { out[i] = ' '; i++; } // prefix letters
      for (let q = 0; q < quote.length; q++) { out[i] = ' '; i++; } // opening quote
      if (quote.length === 3) {
        while (i < n && !(src[i] === quote[0] && src[i + 1] === quote[1] && src[i + 2] === quote[2])) {
          if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) blank(i + 1); i += 2; continue; }
          blank(i); i++;
        }
        for (let q = 0; q < 3 && i < n; q++) { out[i] = ' '; i++; }
      } else {
        while (i < n && src[i] !== quote && src[i] !== '\n') {
          if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) blank(i + 1); i += 2; continue; }
          out[i] = ' '; i++;
        }
        if (i < n && src[i] === quote) { out[i] = ' '; i++; }
      }
      continue;
    }

    out[i] = c; i++;
  }
  return out.join('');
}
