// SHARED · language-agnostic · byte-identical across all thunder-<lang> plugins (synced by
// shared/sync.mjs). Do NOT edit the copies under plugins/*/engine/lib/common/ — edit here.
//
// Opt-in DEBUG mode. A PER-FRAMEWORK config file `.thunder/<framework>/.config` (e.g.
// `.thunder/node/.config`, `.thunder/angular/.config`) with `DEBUG=true` makes that plugin append a
// token-gain trace to `.thunder/gains.md`. Per-framework so a multi-stack repo can enable DEBUG for
// one plugin without the others. When DEBUG is off (or absent) there is ZERO overhead beyond a single
// memoized config read per (root,framework) — every gain computation is guarded by `debugEnabled(...)`,
// so no source bytes are ever stat'd in the hot path.

import { join } from 'node:path';
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

const _cfg = new Map(); // `${root}\0${fw}` → parsed config, read at most once per process

/** Parse `.thunder/<fw>/.config` (simple KEY=VALUE, `#` comments). Memoized. Never throws. */
export function config(root, fw) {
  const key = root + '\0' + fw;
  if (_cfg.has(key)) return _cfg.get(key);
  const cfg = {};
  try {
    const p = join(root, '.thunder', fw, '.config');
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
  _cfg.set(key, cfg);
  return cfg;
}

/** True only when DEBUG is explicitly truthy for this framework. The single check that gates all tracing. */
export function debugEnabled(root, fw) {
  const v = String(config(root, fw).DEBUG || '').toLowerCase();
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
  'Real **data-token** gain per operation. Methodology (so the numbers are honest):\n' +
  '- **baseline tok** = tokens you would read from RAW SOURCE *without* the plugin to answer.\n' +
  '- **thunder tok** = tokens actually ingested *with* the plugin (the card / cached answer / pruned output).\n' +
  '- **saved = baseline − thunder.** This is pure data cost: it EXCLUDES the fixed harness/sub-agent\n' +
  '  overhead (~10.6k/agent) AND the SKILL.md size (~4.3k) — those are not part of a per-answer data cost.\n\n' +
  'Written only while `.thunder/<framework>/.config` has `DEBUG=true`. Delete this file to reset.\n\n' +
  '| time (UTC) | plugin | op | detail | thunder tok | baseline tok | saved | saved % |\n' +
  '|---|---|---|---|---:|---:|---:|---:|\n';

/**
 * Append one gain row. No-op (and ~zero cost) when DEBUG is off for `fw`.
 * @param {string} root
 * @param {string} fw  framework key (java | angular | python | node) → reads `.thunder/<fw>.config`
 * @param {{plugin:string, op:string, detail?:string, thunder?:number, baseline?:number, nowIso?:string}} row
 */
export function trace(root, fw, { plugin, op, detail = '', thunder = 0, baseline = 0, nowIso }) {
  if (!debugEnabled(root, fw)) return;
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
