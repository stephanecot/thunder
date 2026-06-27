import { readdirSync, statSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'coverage', '.git', '.idea', '.vscode', '.claude', 'out', 'tmp',
]);

function isBinary(absPath) {
  try {
    const fd = readFileSync(absPath);
    const len = Math.min(fd.length, 4096);
    for (let i = 0; i < len; i++) if (fd[i] === 0) return true;
    return false;
  } catch { return true; }
}

// React sources: .ts and .js (incl. .mjs/.cjs), excluding declarations and tests.
const isSource = (name) =>
  /\.(tsx|ts|jsx|js|mjs|cjs)$/.test(name) && !name.endsWith('.d.ts') &&
  !/\.(spec|test)\.(tsx|ts|jsx|js|mjs|cjs)$/.test(name);

/** Safely walk `root`, returning React/TS/JS source files (relative, posix-normalized). */
export function walkTs(root, { sizeCapMb = 2, skipDirs = DEFAULT_SKIP_DIRS } = {}) {
  const rootReal = realpathSync(root);
  const cap = sizeCapMb * 1024 * 1024;
  const found = [];

  const recurse = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      let st;
      try { st = lstatSync(abs); } catch { continue; }
      if (st.isSymbolicLink()) {
        try { if (!realpathSync(abs).startsWith(rootReal)) continue; } catch { continue; }
        try { st = statSync(abs); } catch { continue; }
      }
      if (st.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        recurse(abs);
      } else if (st.isFile() && isSource(e.name)) {
        if (st.size > cap || isBinary(abs)) continue;
        found.push(relative(root, abs).split(sep).join('/'));
      }
    }
  };

  recurse(root);
  found.sort();
  return found;
}
