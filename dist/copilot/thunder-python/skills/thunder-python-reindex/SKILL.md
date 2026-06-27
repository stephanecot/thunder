---
name: thunder-python-reindex
description: 'Rebuild or refresh thunder-python''s index of a Python project. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/business layer for stale package contexts via the cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.'
---

# reindex — keep the index up to date


> **Prerequisite:** opt the project in first — run `/thunder-python-init` once (it writes the committed `.thunder/python/config.yaml` marker). Running this skill also writes that marker when it builds a non-empty index, so reindex works standalone too.

Two layers: the **technical** one is free and deterministic; the **functional** one costs tokens → budgeted,
never run silently.

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${PWD}"
```

## Modes (read `$ARGUMENTS`)
- **`--tech`**: `node "$ENG" build "$ROOT"`. Free, instant. STOP. (Use `build --force` to bypass the cache after an engine change.)
- **`--full`**: `node "$ENG" reset-functional "$ROOT"`, then the flow below.
- **(default)**: incremental — the flow below.

## Functional enrichment flow
1. `node "$ENG" build "$ROOT" >/dev/null` then `node "$ENG" stale --json "$ROOT"`. If empty, say "already up to date" and stop.
2. **Budget & consent**: default **15 contexts/run** (a full vertical feature ≈ 10-12 — clear it without
   truncation). If stale count **reaches or exceeds** the budget (≥, not >), or it looks costly, **ask for
   confirmation** (AskUserQuestion) stating how many will be inferred. Never truncate silently — say what remains stale.
3. For each retained context: `node "$ENG" evidence <id> "$ROOT"` → delegate to **thunder-python-cartographer**
   (the @thunder-python-cartographer agent) → it returns strict JSON → pipe into
   `node "$ENG" set-functional <id> "$ROOT"`. Run several in parallel, capped ~6.
4. **Project rollup**: `node "$ENG" stale-modules --json "$ROOT"`; for each → `module-evidence <project>` →
   cartographer (rollup → `{theme, keywords}`) → `set-module-functional <project>`.
5. Summary: how many contexts/projects (re)inferred, what remains stale.

> **All index text must be ENGLISH.** The cartographer handles it; never write other languages into the index.
