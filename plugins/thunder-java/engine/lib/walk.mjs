import { readdirSync, statSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_SKIP_DIRS = new Set([
  'target', 'build', 'out', 'bin', '.git', 'node_modules', '.idea', '.claude', '.gradle', 'generated',
]);

function isBinary(absPath) {
  // sniff the first 4KB for a NUL byte
  try {
    const fd = readFileSync(absPath);
    const len = Math.min(fd.length, 4096);
    for (let i = 0; i < len; i++) if (fd[i] === 0) return true;
    return false;
  } catch { return true; }
}

/**
 * Safely walk `root`, returning java source files (relative paths, posix-normalized).
 * Skips excluded dirs, binaries, oversized files, and symlinks that escape `root`.
 */
export function walkJava(root, { sizeCapMb = 2, skipDirs = DEFAULT_SKIP_DIRS } = {}) {
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
        // only follow symlinks that stay inside root
        try { if (!realpathSync(abs).startsWith(rootReal)) continue; } catch { continue; }
        try { st = statSync(abs); } catch { continue; }
      }
      if (st.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        recurse(abs);
      } else if (st.isFile() && e.name.endsWith('.java')) {
        if (st.size > cap) continue;
        if (isBinary(abs)) continue;
        found.push(relative(root, abs).split(sep).join('/'));
      }
    }
  };

  recurse(root);
  found.sort();
  return found;
}
