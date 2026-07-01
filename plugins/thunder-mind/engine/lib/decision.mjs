// Decision = one committed YAML file. The engine is the only writer, so we use a CONSTRAINED,
// JSON-compatible YAML subset (JSON is valid YAML) with a matched emit/parse pair — robust round-trip,
// still human-readable and reviewable in a PR. `validate` re-checks anything a human hand-edited.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { decisionsDir } from './cache.mjs';

export const TYPES = ['architecture', 'technical', 'functional', 'convention'];
export const STATUSES = ['proposed', 'active', 'superseded', 'deprecated'];
export const CONFIDENCES = ['high', 'medium', 'low'];
export const ACTIVE_STATUSES = ['active', 'proposed'];
export const SCOPES = ['global', 'domain', 'local'];

// `scope` controls WHEN a decision is loaded (perf), never WHETHER it's reachable (recall always covers all):
//   global = cross-cutting invariant → always injected (the "constitution") ; domain = loaded via its
//   domain card on demand ; local = only via recall. Inferred when absent (back-compat).
export const scopeOf = (d) => d.scope || ((d.type === 'architecture' || d.type === 'convention') ? 'global' : 'domain');

// Field order on disk (readability). Lists/maps emitted block-style, scalars JSON-quoted when needed.
const SCALARS = ['id', 'title', 'type', 'status', 'scope', 'domain', 'date', 'context', 'decision', 'rationale', 'supersedes', 'confidence'];
const LISTS = ['authors', 'consequences', 'tags', 'conflicts_with', 'evidence'];
const FLOWMAP_LISTS = ['alternatives']; // list of small {choice, rejected_because} maps
const MAPS = ['evidence_hashes'];        // path -> content hash captured at record time

// ---- scalar quoting (bare token when safe, else JSON string) --------------------------------------
const SAFE_BARE = /^[A-Za-z0-9_.\/:#@+-]+$/;
function qVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s !== '' && SAFE_BARE.test(s) && !/^(null|true|false)$/i.test(s)) return s;
  return JSON.stringify(s);
}
function unquote(s) {
  const t = String(s).trim();
  if (t === '') return '';
  if (t === 'null') return null;
  if (t[0] === '"') { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  // bare scalar: a ` #` starts a YAML comment (hand-edited files) — strip it, like a real YAML parser
  return t.replace(/\s+#.*$/, '');
}

// split on `sep` at top level (ignore separators inside JSON strings / [] / {})
function splitTop(s, sepChar) {
  const out = []; let buf = '', q = false, esc = false, depth = 0;
  for (const ch of s) {
    if (esc) { buf += ch; esc = false; continue; }
    if (q) { buf += ch; if (ch === '\\') esc = true; else if (ch === '"') q = false; continue; }
    if (ch === '"') { q = true; buf += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    if (ch === sepChar && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim() !== '') out.push(buf);
  return out;
}
const parseFlowArray = (s) => splitTop(s.trim().slice(1, -1), ',').map(unquote);
function parseFlowMap(s) {
  const o = {};
  for (const part of splitTop(s.trim().slice(1, -1), ',')) {
    const m = part.match(/^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]*)$/);
    if (m) o[m[1]] = unquote(m[2]);
  }
  return o;
}

const emitFlowMap = (o) => '{' + Object.entries(o).map(([k, v]) => `${k}: ${qVal(v)}`).join(', ') + '}';

/** Serialize a decision object to its YAML file text. */
export function emitDecision(d) {
  const out = [];
  for (const k of SCALARS) if (d[k] !== undefined) out.push(`${k}: ${qVal(d[k])}`);
  for (const k of LISTS) {
    const a = d[k];
    if (a === undefined) continue;
    out.push(a.length ? `${k}:\n` + a.map((x) => `  - ${qVal(x)}`).join('\n') : `${k}: []`);
  }
  for (const k of FLOWMAP_LISTS) {
    const a = d[k];
    if (a === undefined) continue;
    out.push(a.length ? `${k}:\n` + a.map((x) => `  - ${emitFlowMap(x)}`).join('\n') : `${k}: []`);
  }
  for (const k of MAPS) {
    const o = d[k];
    if (!o || !Object.keys(o).length) continue;
    out.push(`${k}:\n` + Object.entries(o).map(([kk, vv]) => `  ${qVal(kk)}: ${qVal(vv)}`).join('\n'));
  }
  return out.join('\n') + '\n';
}

/** Parse a decision YAML file (our constrained subset) back to an object. */
export function parseDecision(text) {
  const lines = text.split('\n');
  const d = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_]\w*):\s?(.*)$/);
    if (!m) continue;
    const key = m[1]; const rest = m[2];
    // block scalar (`key: >` / `key: |`) — legal YAML a human hand-edit will use; the emitter never
    // produces it, but silently storing ">" as the value corrupted the index, so parse it properly.
    const bs = rest.match(/^([>|])[+-]?\s*(#.*)?$/);
    if (bs) {
      const block = [];
      while (i + 1 < lines.length && (lines[i + 1].startsWith('  ') || !lines[i + 1].trim())) block.push(lines[++i]);
      const body = block.map((b) => b.replace(/^  /, ''));
      d[key] = (bs[1] === '>' ? body.map((b) => b.trim()).filter(Boolean).join(' ') : body.join('\n')).trimEnd();
      continue;
    }
    if (rest === '') {
      const block = [];
      while (i + 1 < lines.length && lines[i + 1].startsWith('  ')) block.push(lines[++i]);
      if (block.length && block[0].trim().startsWith('- ')) {
        d[key] = block.map((b) => {
          const item = b.trim().replace(/^- /, '');
          return item.startsWith('{') ? parseFlowMap(item) : unquote(item);
        });
      } else {
        const o = {};
        for (const b of block) {
          const mm = b.trim().match(/^(.+?):\s?(.*)$/);
          if (mm) o[unquote(mm[1])] = unquote(mm[2]);
        }
        d[key] = o;
      }
    } else if (rest === '[]') d[key] = [];
    else if (rest === '{}') d[key] = {};
    else if (rest.startsWith('[')) d[key] = parseFlowArray(rest);
    else if (rest.startsWith('{')) d[key] = parseFlowMap(rest);
    else d[key] = unquote(rest);
  }
  return d;
}

// ---- ids / slugs ----------------------------------------------------------------------------------
export function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'decision';
}
export const slugifyDomain = (s) => slugify(s) || 'general';
/** id = "<domain>/<date>-<title-slug>" ; the file lives at decisions/<id>.yaml */
export const makeId = (domain, date, title) => `${slugifyDomain(domain)}/${date}-${slugify(title)}`;
export const fileForId = (root, id) => join(decisionsDir(root), ...id.split('/')) + '.yaml';

// ---- validation -----------------------------------------------------------------------------------
const FRENCH_HINT = /[àâäçéèêëîïôöùûü]|\b(le|la|les|une|des|nous|pour|avec|sans|être|décision|fonctionnel)\b/i;

export function validateDecision(d) {
  const errors = [], warnings = [];
  for (const k of ['title', 'type', 'status', 'domain', 'date', 'decision']) {
    if (!d[k] || String(d[k]).trim() === '') errors.push(`missing required field: ${k}`);
  }
  if (d.type && !TYPES.includes(d.type)) errors.push(`invalid type: ${d.type} (expected ${TYPES.join('|')})`);
  if (d.status && !STATUSES.includes(d.status)) errors.push(`invalid status: ${d.status} (expected ${STATUSES.join('|')})`);
  if (d.scope && !SCOPES.includes(d.scope)) errors.push(`invalid scope: ${d.scope} (expected ${SCOPES.join('|')})`);
  if (d.confidence && !CONFIDENCES.includes(d.confidence)) errors.push(`invalid confidence: ${d.confidence}`);
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) errors.push(`invalid date (want YYYY-MM-DD): ${d.date}`);
  // English-only index is a hard project rule → flag likely non-English prose (warning, not fatal).
  for (const k of ['title', 'context', 'decision', 'rationale']) {
    if (d[k] && FRENCH_HINT.test(String(d[k]))) { warnings.push(`field "${k}" looks non-English — the index must be English`); break; }
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ---- loading --------------------------------------------------------------------------------------
/** Recursively list decision files (relative paths under decisions/), sorted. */
export function listDecisionFiles(root) {
  const base = decisionsDir(root);
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(relative(base, full).split(sep).join('/'));
    }
  };
  walk(base);
  return out.sort();
}

/** id derived from the file path (decisions/auth/2026-...-x.yaml → auth/2026-...-x). */
export const idFromRel = (rel) => rel.replace(/\.ya?ml$/, '');
