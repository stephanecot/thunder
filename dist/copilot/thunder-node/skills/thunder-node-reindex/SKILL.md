---
name: thunder-node-reindex
description: 'Rebuild or refresh thunder-node''s index of a Node.js backend. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/user-facing layer for stale feature contexts via the cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.'
---

# thunder-node reindex


> **Prerequisite:** opt the project in first — run `/thunder-node-init` once (it writes the committed `.thunder/node/config.yaml` marker). Running this skill also writes that marker when it builds a non-empty index, so reindex works standalone too.

Two layers: the **technical** one is free and deterministic; the **functional** one costs tokens
(inference) → budgeted, never run silently.

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${PWD}"
```

## Modes (read `$ARGUMENTS`)
- **`--tech`**: `node "$ENG" build "$ROOT"`. Free, instant. STOP.
- **`--full`**: `node "$ENG" reset-functional "$ROOT"`, then the flow below.
- **(default)**: incremental — the flow below.

## Functional enrichment flow
1. Refresh + list stale: `node "$ENG" build "$ROOT" >/dev/null` then `node "$ENG" stale --json "$ROOT"`.
   If empty, say "functional layer already up to date" and stop.
2. **Budget & consent**: default **15 contexts/run** (a full feature ≈ 10-12 contexts — clear it without
   truncation). If the number of stale contexts **reaches or exceeds** the budget (≥, not >), or it looks
   costly, **ask for confirmation** (AskUserQuestion) stating how many will be inferred. Never infer
   hundreds silently, and never silently truncate — if you stop at the budget, say what remains stale.
3. For each retained context (up to budget):
   a. `node "$ENG" evidence <id> "$ROOT"` → evidence pack JSON.
   b. Delegate to the **thunder-node-cartographer** sub-agent (Task) with that JSON → it returns strict
      JSON (name, purpose, capabilities, business_rules, intents keyed by route path, glossary, confidence).
   c. Pipe it into `node "$ENG" set-functional <id> "$ROOT"` (stdin). Run several in parallel, capped ~6.
4. **Project rollup**: `node "$ENG" stale-modules --json "$ROOT"`; for each → `module-evidence <project>` →
   cartographer (rollup mode → `{theme, keywords}`) → `set-module-functional <project>`.
5. Summary: how many contexts/projects (re)inferred, what remains stale.

> **All index text must be ENGLISH** (name, purpose, capabilities, business_rules, intents, theme,
> keywords). The cartographer handles it; never write other languages into the index.
