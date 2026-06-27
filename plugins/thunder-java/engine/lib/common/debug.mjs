// SHARED · language-agnostic · byte-identical across all thunder-<lang> plugins (synced by
// shared/sync.mjs). Do NOT edit the copies under plugins/*/engine/lib/common/ — edit here.
//
// Opt-in DEBUG mode. A `.thunder.config` at the project root with `DEBUG=true` makes the plugins
// append a token-gain trace to `.thunder/gains.md`. When DEBUG is off (or absent) there is ZERO
// overhead beyond a single memoized config read per process — every gain computation is guarded by
// `debugEnabled(root)`, so no source bytes are ever stat'd in the hot path.

import { join } from 'node:path';
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

const _cfg = new Map(); // root → parsed config, read at most once per process

/** Parse `.thunder.config` (simple KEY=VALUE, `#` comments). Memoized. Never throws. */
export function config(root) {
  if (_cfg.has(root)) return _cfg.get(root);
  const cfg = {};
  try {
    const p = join(root, '.thunder.config');
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const eq = s.indexOf('=');
        if (eq < 0) continue;
        cfg[s.slice(0, eq).trim()] = s.slice(eq + 1).trim();
      }
    }
  } catch { /* missing/unreadable config → defaults */ }
  _cfg.set(root, cfg);
  return cfg;
}

/** True only when DEBUG is explicitly truthy. The single check that gates all tracing. */
export function debugEnabled(root) {
  const v = String(config(root).DEBUG || '').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export const tok = (bytes) => Math.round(bytes / 4);

/** Token cost of reading these files raw (the no-thunder baseline). Call only behind debugEnabled. */
export function rawTokens(root, relFiles) {
  let bytes = 0;
  for (const f of relFiles || []) { try { bytes += statSync(join(root, f)).size; } catch { /* gone */ } }
  return tok(bytes);
}

const gainsPath = (root) => join(root, '.thunder', 'gains.md');
const HEADER =
  '# Thunder — gain trace (DEBUG)\n\n' +
  'Every row is one operation and the tokens it saved vs reading raw source. ' +
  'Written only while `.thunder.config` has `DEBUG=true`. Delete this file to reset.\n\n' +
  '| time (UTC) | plugin | op | detail | thunder tok | baseline tok | saved | saved % |\n' +
  '|---|---|---|---|---:|---:|---:|---:|\n';

/**
 * Append one gain row. No-op (and ~zero cost) when DEBUG is off.
 * @param {string} root
 * @param {{plugin:string, op:string, detail?:string, thunder?:number, baseline?:number, nowIso?:string}} row
 */
export function trace(root, { plugin, op, detail = '', thunder = 0, baseline = 0, nowIso }) {
  if (!debugEnabled(root)) return;
  try {
    mkdirSync(join(root, '.thunder'), { recursive: true });
    const p = gainsPath(root);
    if (!existsSync(p)) writeFileSync(p, HEADER);
    const saved = baseline - thunder;
    const pct = baseline > 0 ? Math.round((saved / baseline) * 100) : 0;
    const t = (nowIso || new Date().toISOString()).replace('T', ' ').slice(0, 19);
    const d = String(detail).replace(/\|/g, '\\|').slice(0, 80);
    appendFileSync(p, `| ${t} | ${plugin} | ${op} | ${d} | ${thunder} | ${baseline} | ${saved} | ${pct}% |\n`);
  } catch { /* tracing must never break a command */ }
}
