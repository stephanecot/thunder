---
name: thunder-mind-reindex
description: Rebuild thunder-mind's derived decision index from the committed YAML decision files. Free and deterministic (no tokens) — normally the hook keeps it fresh, so use this after a git pull/merge that changed many decisions, after hand-editing decision files, or to validate the index in CI. Args: empty = rebuild; --validate = schema-check only.
allowed-tools: Bash
---

# reindex — rebuild the derived decision index (free)

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

The technical layer is **free and deterministic**: the engine reads `.thunder/mind/decisions/**/*.yaml`
(the committed source of truth) and rebuilds the gitignored derived index under `.claude/cache/thunder-mind/`
(brief, domain-map, inverted index). No model tokens are spent — unlike capturing a decision, which uses
the scribe (see `/thunder-mind:thunder-mind-record`).

## Modes (read `$ARGUMENTS`)
- **`--validate`**: `node "$ENG" validate "$ROOT"` — schema-check every decision (and flag non-English
  prose). Exit non-zero on errors. Good for CI / pre-commit. STOP.
- **(default)**: `node "$ENG" build "$ROOT" --force` — full rebuild from the decision files.

After a rebuild, report the counts (decisions / domains) and run
`node "$ENG" conflicts "$ROOT"` to surface anything a merge introduced.
