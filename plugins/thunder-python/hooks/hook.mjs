#!/usr/bin/env node
// Cross-platform PostToolUse wrapper: read the hook JSON on stdin, enqueue the edited
// file into thunder's dirty.list (cheap append — the real re-parse is lazy). No output,
// so it never pollutes the model's context. No-op unless the project already has a
// thunder index (avoids touching non-Java projects).
import { existsSync } from 'node:fs';
import { appendDirty, isInitialized } from '../engine/lib/cache.mjs';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input || '{}');
  const file = payload?.tool_input?.file_path;
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  if (file && /\.(py|pyi|toml|cfg)$/.test(file) && isInitialized(root)) {
    appendDirty(root, file);
  }
} catch { /* never fail an edit because of a hook */ }
