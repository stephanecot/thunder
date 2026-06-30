---
name: thunder-react-reindex
description: Rebuild or refresh thunder-react's index of a React app. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/user-facing layer for stale feature contexts via the cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.
allowed-tools: Bash, Task, AskUserQuestion
---

# thunder-react reindex


> **Prerequisite:** opt the project in first — run `/thunder-react:thunder-react-init` once (it writes the committed `.thunder/react/config.yaml` marker). Running this skill also writes that marker when it builds a non-empty index, so reindex works standalone too.

Two layers: the **technical** one is free and deterministic; the **functional** one costs tokens
(inference) → budgeted, never run silently.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Modes (read `$ARGUMENTS`)
- **`--tech`**: `node "$ENG" build "$ROOT"`. Free, instant. STOP.
- **`--full`**: `node "$ENG" reset-functional "$ROOT"`, then the flow below.
- **(default)**: incremental — the flow below.

## ⚡ Cost model — read before inferring
The functional pass must scale to **hundreds of contexts** cheaply. Two rules:
1. **Never let evidence packs pass through your (orchestrator) context** — each is ~4k tokens of source;
   piping hundreds through here is a quadratic blow-up on the expensive model. `evidence-batch` writes each
   pack to a **file**; you hand the cartographer only the **paths** (it `Read`s them itself).
2. **Batch contexts per sub-agent** — ~10 contexts per cartographer call, a few in parallel — instead of
   one ~10k-token sub-agent boot per context.
> Do **not** loop the single-context `evidence`/`set-functional` here — that pattern cost ~7M tokens on a
> real project. Use `evidence-batch` + batched Tasks + `set-functional-batch`.

## Functional enrichment flow
1. **Refresh + count stale** (cheap — ids only): `node "$ENG" build "$ROOT" >/dev/null` then
   `node "$ENG" stale --json "$ROOT"`. If empty, say "functional layer already up to date" and stop.
2. **Budget & consent**: default **40 contexts/run**. If the stale count reaches/exceeds the budget or it
   looks costly, **ask for confirmation** (AskUserQuestion) stating how many will be inferred and that the
   rest stay stale for the next run. Never infer hundreds silently; never truncate silently.
3. **Materialize packs to disk** (NOT into your context):
   `node "$ENG" evidence-batch "$ROOT" --limit <budget>` → prints a tiny manifest
   `{outDir, totalStale, written, contexts:[{id, reason, path}, …]}`. Only ids + paths reach you; the
   packs stay in files. (Omit `--limit` to materialize all stale contexts.)
4. **Infer in batches** — split `contexts` into groups of **~10**. For each group spawn ONE
   **thunder-react-cartographer** (Task, `subagent_type: "thunder-react-cartographer"`), passing only the ids + paths of that group:
   `{"contexts":[{"id":"…","path":"/…/evidence/….json"}, …]}`. Run up to **~4 groups in parallel**
   (several Task calls in one message). Each returns a **JSON array** of `{id, name, purpose, capabilities,
   business_rules, intents, glossary, confidence}` (one per context, id echoed).
5. **Persist the batch in one call** — concatenate every array the cartographer returned into a single JSON
   array, write it to a temp file, then `node "$ENG" set-functional-batch "$ROOT" < /tmp/thunder-func.json`
   → `{set, failed}` (re-emits shards once). If a group returned non-JSON, retry it once at half size; drop
   and report any context that still fails.
6. **Project rollup** (small & cheap, no source): `node "$ENG" stale-modules --json "$ROOT"`; for each →
   `module-evidence <project>` → cartographer (rollup → `{theme, keywords}`) → `set-module-functional
   <project>`. Run several in parallel.
7. Summary: how many contexts/projects (re)inferred, what remains stale.

> **All index text must be ENGLISH** (name, purpose, capabilities, business_rules, intents, theme,
> keywords). The cartographer handles it; never write other languages into the index.
