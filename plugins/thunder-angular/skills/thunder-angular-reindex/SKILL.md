---
name: thunder-angular-reindex
description: Rebuild or refresh thunder-angular's index of an Angular project. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/user-facing layer for stale feature contexts via the cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.
allowed-tools: Bash, Task, AskUserQuestion
---

# thunder-angular reindex

Two layers: the **technical** one is free and deterministic; the **functional** one costs tokens
(inference) → budgeted, never run silently.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Modes (read `$ARGUMENTS`)
- **`--tech`**: `node "$ENG" build "$ROOT"`. Free, instant. STOP.
- **`--full`**: `node "$ENG" reset-functional "$ROOT"`, then the flow below.
- **(default)**: incremental — the flow below.

## Functional enrichment flow
1. Refresh + list stale: `node "$ENG" build "$ROOT" >/dev/null` then `node "$ENG" stale --json "$ROOT"`.
   If empty, say "functional layer already up to date" and stop.
2. **Budget & consent**: default 10 contexts/run. If more are stale (or it looks costly), **ask for
   confirmation** (AskUserQuestion) stating how many will be inferred. Never infer hundreds silently.
3. For each retained context (up to budget):
   a. `node "$ENG" evidence <id> "$ROOT"` → evidence pack JSON.
   b. Delegate to the **thunder-angular-cartographer** sub-agent (Task) with that JSON → it returns strict
      JSON (name, purpose, capabilities, business_rules, intents keyed by route path, glossary, confidence).
   c. Pipe it into `node "$ENG" set-functional <id> "$ROOT"` (stdin). Run several in parallel, capped ~6.
4. **Project rollup**: `node "$ENG" stale-modules --json "$ROOT"`; for each → `module-evidence <project>` →
   cartographer (rollup mode → `{theme, keywords}`) → `set-module-functional <project>`.
5. Summary: how many contexts/projects (re)inferred, what remains stale.

> **All index text must be ENGLISH** (name, purpose, capabilities, business_rules, intents, theme,
> keywords). The cartographer handles it; never write other languages into the index.
