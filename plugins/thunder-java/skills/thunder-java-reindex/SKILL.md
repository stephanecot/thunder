---
name: thunder-java-reindex
description: Rebuild or refresh thunder's index of a Java/Spring project. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/business layer for stale contexts via the thunder-java-cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a large refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.
allowed-tools: Bash, Task, AskUserQuestion
---

# reindex — keep the index up to date


> **Prerequisite:** opt the project in first — run `/thunder-java:thunder-java-init` once (it writes the committed `.thunder/java/config.yaml` marker). Running this skill also writes that marker when it builds a non-empty index, so reindex works standalone too.

> **Prerequisite:** the project must be opted in first — run `/thunder-java:thunder-java-init` once (it writes the committed `.thunder/java/config.yaml` marker). Running this skill also writes that marker when it builds a non-empty index, so reindex works standalone too.

Two layers, two regimes: the **technical** one is free and deterministic; the **functional** one costs
tokens (inference) → it is **budgeted and never run silently**.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${CLAUDE_PROJECT_DIR}"
```

## Modes (read `$ARGUMENTS`)

- **`--tech`**: technical only. `node "$ENG" build "$ROOT"`. Free, instant. **STOP here.**
- **`--full`**: `node "$ENG" reset-functional "$ROOT"` (everything becomes stale), then follow the flow below.
- **(default)**: incremental — follow the flow below.

## Functional enrichment flow

1. **Refresh + list stale**:
   ```bash
   node "$ENG" build "$ROOT" >/dev/null
   node "$ENG" stale --json "$ROOT"
   ```
   → JSON array `[{id, reason, hash}, …]`. If **empty**, say "functional layer already up to date" and stop.

2. **Budget & consent**: default budget = **15 contexts/run** (a full vertical feature ≈ 10-12 contexts —
   the budget must clear it without truncation). If the number of stale contexts **reaches or exceeds** the
   budget (≥, not >), or it looks costly, **ask for confirmation** (AskUserQuestion) before continuing,
   stating how many will be inferred. Never infer hundreds of contexts without explicit approval, and never
   silently truncate — if you stop at the budget, say which contexts remain stale.

3. **For each retained context** (up to the budget):
   a. Get the evidence pack: `node "$ENG" evidence <id> "$ROOT"` (JSON on stdout).
   b. Delegate to the **thunder-java-cartographer** sub-agent (Task, `subagent_type: "thunder-java-cartographer"`)
      passing it that JSON. It returns **strict JSON** (name, purpose, capabilities, business_rules, intents,
      glossary, confidence).
   c. Pipe it back into `node "$ENG" set-functional <id> "$ROOT"` (stdin).
   - You can process several contexts **in parallel** (several Task calls in one message), capped at ~6.

4. **Module rollup** (makes `index.yaml` navigable functionally):
   ```bash
   node "$ENG" stale-modules --json "$ROOT"
   ```
   For each returned module: `node "$ENG" module-evidence <module> "$ROOT"` (JSON of its contexts'
   purposes/capabilities) → delegate to **thunder-java-cartographer** (rollup mode → returns `{theme, keywords}`
   in **English**) → `node "$ENG" set-module-functional <module> "$ROOT"` (stdin). These calls are small
   (already-inferred text, no source) → run them in parallel, capped.

5. **Summary**: report how many contexts and modules were (re)inferred, and what remains stale (if the
   budget was reached).

> **Language: all text written into the index (name, purpose, capabilities, business_rules, intents, theme,
> keywords) MUST be in ENGLISH.** The thunder-java-cartographer handles this; never write other languages
> into the index.

## Reminders

- The thunder-java-cartographer's `business_rules` must **cite their source**; if it returns empty or
  non-JSON, retry once, otherwise mark the context `confidence: low` and continue.
- Do not read `.java` files yourself here: the evidence pack already contains the source needed.
