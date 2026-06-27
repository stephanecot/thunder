// SHARED · language-agnostic · byte-identical across all thunder-<lang> plugins (synced by
// shared/sync.mjs). Do NOT edit the copies under plugins/*/engine/lib/common/ — edit here.
//
// Phase 1 — tool-output pruning. Keep head + tail + every diagnostic line, elide the middle with
// an explicit marker so the model knows to escalate. Pure string processing, zero-dep, deterministic.

// Lines we always keep — errors/warnings/failures/diagnostics carry the signal in a verbose log.
const DIAG_RE = /\b(error|errors|failed|failure|fail(?:ing|s)?|exception|traceback|panic|fatal|assert(?:ion)?|warn(?:ing)?|✗|✘|✖|FAIL|ERROR|WARN)\b/i;

/**
 * Prune a verbose blob. Returns { out, total, kept, elided }.
 * @param {string} text
 * @param {{head?:number, tail?:number, keepRe?:RegExp, context?:number, maxKeep?:number}} opts
 */
export function prune(text, opts = {}) {
  if (process.env.THUNDER_PRUNE === 'off') {
    const total = text === '' ? 0 : text.split('\n').length;
    return { out: text, total, kept: total, elided: 0 };
  }
  const head = opts.head ?? 20;
  const tail = opts.tail ?? 20;
  const context = opts.context ?? 1;      // lines of context around each diagnostic line
  const keepRe = opts.keepRe ?? DIAG_RE;
  const maxKeep = opts.maxKeep ?? 4000;   // hard ceiling so a log full of "error" can't blow up

  const lines = text.split('\n');
  const total = lines.length;
  // Small enough already → return verbatim.
  if (total <= head + tail + 10) return { out: text, total, kept: total, elided: 0 };

  const keep = new Set();
  for (let i = 0; i < head && i < total; i++) keep.add(i);
  for (let i = Math.max(0, total - tail); i < total; i++) keep.add(i);
  for (let i = 0; i < total; i++) {
    if (keepRe.test(lines[i])) {
      for (let j = Math.max(0, i - context); j <= Math.min(total - 1, i + context); j++) keep.add(j);
      if (keep.size > maxKeep) break;
    }
  }

  const idx = [...keep].sort((a, b) => a - b);
  const out = [];
  let elided = 0, prev = -1;
  for (const i of idx) {
    if (i > prev + 1) { const n = i - prev - 1; elided += n; out.push(`…elided ${n} line(s)…`); }
    out.push(lines[i]);
    prev = i;
  }
  if (prev < total - 1) { const n = total - 1 - prev; elided += n; out.push(`…elided ${n} line(s)…`); }
  return { out: out.join('\n'), total, kept: idx.length, elided };
}
