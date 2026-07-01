#!/usr/bin/env node
// Sync the language-agnostic shared layer into every thunder-<lang> plugin so each stays a
// self-contained Claude Code plugin while the *source* lives in one place (shared/).
// Copies are byte-identical (same precedent as engine/lib/hash.mjs / yaml.mjs).
// Run after editing anything under shared/ — and as part of the version-bump ritual.
//   node shared/sync.mjs            (sync all)
//   node shared/sync.mjs --check    (fail if any copy is out of date — for CI/pre-commit)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = ['thunder-java', 'thunder-angular', 'thunder-python', 'thunder-node', 'thunder-react', 'thunder-mind'];
// (sourceDir under shared/, destDir under plugins/<p>/, optional {except} — plugins that must NOT
// receive it: tier3-bench.mjs assumes a framework model (model.contexts) and breaks on thunder-mind,
// whose own tools/bench.mjs already measures the Tier-3 layer)
const MAP = [
  ['engine/common', 'engine/lib/common'],
  ['engine/test', 'engine/test'],
  ['engine/tools', 'engine/tools', { except: ['thunder-mind'] }],
];
const check = process.argv.includes('--check');

let copied = 0, stale = 0;
for (const [srcRel, dstRel, opts] of MAP) {
  const srcDir = join(ROOT, 'shared', srcRel);
  if (!existsSync(srcDir)) continue;
  for (const f of readdirSync(srcDir).filter((n) => n.endsWith('.mjs'))) {
    const src = readFileSync(join(srcDir, f), 'utf8');
    for (const p of PLUGINS.filter((x) => !(opts?.except || []).includes(x))) {
      const dst = join(ROOT, 'plugins', p, dstRel, f);
      const cur = existsSync(dst) ? readFileSync(dst, 'utf8') : null;
      if (cur === src) continue;
      if (check) { console.error(`stale: plugins/${p}/${dstRel}/${f}`); stale++; continue; }
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, src);
      console.log(`synced → plugins/${p}/${dstRel}/${f}`);
      copied++;
    }
  }
}
if (check) { if (stale) { console.error(`${stale} file(s) out of date — run: node shared/sync.mjs`); process.exit(1); } console.log('shared layer in sync.'); }
else console.log(`done — ${copied} file(s) synced.`);
