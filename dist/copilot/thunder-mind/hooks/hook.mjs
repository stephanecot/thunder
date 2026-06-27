#!/usr/bin/env node
// Cross-platform PostToolUse wrapper: read the hook JSON on stdin, enqueue the edited file into
// thunder-mind's dirty.list (cheap append — the real rebuild is lazy, on the next `ensure`). No output,
// so it never pollutes the model's context. No-op unless the project already has a thunder-mind index.
//
// Two things matter to thunder-mind: (a) a decision YAML changed → rebuild the index; (b) any source
// file changed → it may be cited as `evidence`, so `conflicts` can later flag drift. We enqueue both.
import { existsSync } from 'node:fs';
import { appendDirty, cacheDir } from '../engine/lib/cache.mjs';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input || '{}');
  const ti = payload?.tool_input || payload?.toolInput || {};
  const file = ti.file_path || ti.filePath || ti.path || ti.file;
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  if (file && existsSync(cacheDir(root))) appendDirty(root, file);
} catch { /* never fail an edit because of a hook */ }
