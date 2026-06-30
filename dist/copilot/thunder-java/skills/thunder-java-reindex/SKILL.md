---
name: thunder-java-reindex
description: 'Rebuild or refresh thunder''s index of a Java/Spring project. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/business layer for stale contexts via the thunder-java-cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a large refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.'
---

# reindex — keep the index up to date

> **Prerequisite:** opt the project in first — run `/thunder-java-init` once (it writes the
> committed `.thunder/java/config.yaml` marker). Running this skill also writes that marker when it builds a
> non-empty index, so reindex works standalone too.

Two layers, two regimes: the **technical** one is free and deterministic; the **functional** one costs
tokens (inference) → it is **budgeted and never run silently**.

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${PWD}"
```

## ⚡ Cost model — read this before inferring

The functional pass must scale to **hundreds of contexts** without burning millions of tokens. Two rules
make that possible — **follow them exactly**:

1. **Never let an evidence pack pass through your (the orchestrator's) context.** Each pack is ~4k tokens
   of source; with hundreds of contexts, piping them through here is a quadratic blow-up on the expensive
   model. Instead, `evidence-batch` writes every pack to a **file** and you hand the cartographer only the
   **file paths** — it `Read`s them itself.
2. **Batch contexts per sub-agent.** One `Task` per context means hundreds of ~10k-token sub-agent boots.
   Send **~10 contexts per cartographer call** instead, a few calls in parallel.

> Do **not** use the single-context `evidence` / `set-functional` commands in a loop here — that is the
> exact pattern that cost 7M tokens. Use `evidence-batch` + batched Tasks + `set-functional-batch`.

## Modes (read `$ARGUMENTS`)

- **`--tech`**: technical only. `node "$ENG" build "$ROOT"`. Free, instant. **STOP here.**
- **`--full`**: `node "$ENG" reset-functional "$ROOT"` (everything becomes stale), then follow the flow below.
- **(default)**: incremental — follow the flow below.

## Functional enrichment flow

1. **Refresh + count stale** (cheap — ids only, no source):
   ```bash
   node "$ENG" build "$ROOT" >/dev/null
   node "$ENG" stale --json "$ROOT"
   ```
   → JSON array `[{id, reason, hash}, …]`. If **empty**, say "functional layer already up to date" and stop.

2. **Budget & consent**: default budget = **40 contexts/run**. If the stale count **reaches or exceeds** the
   budget, or it looks costly, **ask for confirmation** (AskUserQuestion) before continuing, stating how many
   will be inferred and that the rest stay stale for the next run. Never infer hundreds without explicit
   approval; never silently truncate.

3. **Materialize the packs to disk** (NOT into your context):
   ```bash
   node "$ENG" evidence-batch "$ROOT" --limit <budget>
   ```
   → prints a tiny manifest `{outDir, totalStale, written, contexts:[{id, reason, path}, …]}`. Only ids +
   paths reach you — the packs stay in files. (Omit `--limit` to materialize all stale contexts.)

4. **Infer in batches** — split `contexts` into groups of **~10**. For each group, spawn ONE
   **thunder-java-cartographer** sub-agent (the @thunder-java-cartographer agent), passing it
   **only the ids + paths** of that group, e.g.:
   > `Infer these contexts. Read each pack file and return a JSON array (one object per context, echo each id):`
   > `{"contexts":[{"id":"…","path":"/…/evidence/….json"}, …]}`
   Run **up to ~4 groups in parallel** (several Task calls in one message). Each call returns a **JSON array**
   of `{id, name, purpose, capabilities, business_rules, intents, glossary, confidence}`.

5. **Persist the whole batch in one call**. Concatenate all the arrays the cartographer returned into a single
   JSON array, write it to a temp file, and merge it at once:
   ```bash
   node "$ENG" set-functional-batch "$ROOT" < /tmp/thunder-func.json
   ```
   → `{set, failed}`. Re-emits shards once. (If a group returned non-JSON, retry that group once at half the
   size; drop any context that still fails and report it.)

6. **Module rollup** (makes `index.yaml` navigable functionally — small & cheap, no source):
   ```bash
   node "$ENG" stale-modules --json "$ROOT"
   ```
   For each returned module: `node "$ENG" module-evidence <module> "$ROOT"` → delegate to
   **thunder-java-cartographer** (rollup mode → returns `{theme, keywords}` in **English**) →
   `node "$ENG" set-module-functional <module> "$ROOT"` (stdin). These are tiny → run several in parallel.

7. **Summary**: report how many contexts and modules were (re)inferred, and what remains stale (if the budget
   was reached).

> **Language: all text written into the index (name, purpose, capabilities, business_rules, intents, theme,
> keywords) MUST be in ENGLISH.** The thunder-java-cartographer handles this; never write other languages
> into the index.

## Reminders

- The cartographer `Read`s the packs — **do not read `.java` files or the pack files yourself here**, and
  do not paste pack contents into a Task prompt (paths only).
- `business_rules` must **cite their source**; if a batch returns empty/non-JSON, retry it once smaller,
  otherwise mark those contexts `confidence: low` and continue.
