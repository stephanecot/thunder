import { readdirSync, statSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_SKIP_DIRS = new Set([
  '__pycache__', '.venv', 'venv', 'env', '.env', 'node_modules', '.git', '.idea', '.vscode',
  '.claude', '.mypy_cache', '.pytest_cache', '.tox', 'build', 'dist', '.eggs', 'site-packages', 'migrations',
]);

function isBinary(absPath) {
  try {
    const fd = readFileSync(absPath);
    const len = Math.min(fd.length, 4096);
    for (let i = 0; i < len; i++) if (fd[i] === 0) return true;
    return false;
  } catch { return true; }
}

const isSource = (name) => (name.endsWith('.py') || name.endsWith('.pyi')) && !name.endsWith('_test.py') && !name.startsWith('test_');

/** Safely walk `root`, returning Python source files (relative paths, posix-normalized). */
export function walkPy(root, { sizeCapMb = 2, skipDirs = DEFAULT_SKIP_DIRS } = {}) {
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
