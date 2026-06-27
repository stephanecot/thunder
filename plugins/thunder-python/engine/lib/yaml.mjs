/**
 * Minimal, SAFE YAML emitter (write-only — we never parse YAML back; see DESIGN §B).
 *
 * - Scalars are quoted whenever they could be misread (special chars, leading/trailing
 *   space, empty, or anything that looks like a number/bool/null).
 * - Small objects/arrays whose values are all scalar render in compact flow style
 *   ({a: 1, b: 2}) to save tokens; larger ones fall back to block style.
 */

const NEEDS_QUOTE = /[:#\[\]{}",&*!|>%@`?\-=]|^\s|\s$|^$/;
const LOOKS_SPECIAL = /^(null|~|true|false|yes|no|on|off|[-+]?\d|\.)/i;

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '') return '""';
  if (NEEDS_QUOTE.test(s) || LOOKS_SPECIAL.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

const isScalar = (v) => v === null || typeof v !== 'object';

/** A value is "flowable" if it nests at most one level of scalar-only collections. */
function flowLen(v) {
  if (isScalar(v)) return scalar(v).length;
  if (Array.isArray(v)) {
    if (!v.every(isScalar)) return Infinity;
    return 2 + v.reduce((a, x) => a + scalar(x).length + 2, 0);
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (!entries.every(([, x]) => isScalar(x))) return Infinity;
  return 2 + entries.reduce((a, [k, x]) => a + k.length + scalar(x).length + 4, 0);
}

function flow(v) {
  if (isScalar(v)) return scalar(v);
  if (Array.isArray(v)) return '[' + v.map(scalar).join(', ') + ']';
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return '{' + entries.map(([k, x]) => `${k}: ${scalar(x)}`).join(', ') + '}';
}

const FLOW_MAX = 96;

function block(v, indent) {
  const pad = '  '.repeat(indent);
  if (isScalar(v)) return scalar(v);

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '\n' + v.map((item) => {
      if (isScalar(item) || flowLen(item) <= FLOW_MAX) return `${pad}- ${flow(item)}`;
      // non-flowable item: emit its body indented under the dash
      const body = block(item, indent + 1);
      return `${pad}-${body.startsWith('\n') ? body : ' ' + body}`;
    }).join('\n');
  }

  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (entries.length === 0) return '{}';
  return '\n' + entries.map(([k, x]) => {
    if (isScalar(x) || flowLen(x) <= FLOW_MAX) return `${pad}${k}: ${flow(x)}`;
    return `${pad}${k}:${block(x, indent + 1)}`;
  }).join('\n');
}

/** Render a JS value as a YAML document string. */
export function dump(value) {
  const body = block(value, 0);
  return (body.startsWith('\n') ? body.slice(1) : body) + '\n';
}
