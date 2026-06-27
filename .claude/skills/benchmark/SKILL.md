---
name: benchmark
description: Internal maintainer skill for the Thunder repo. Regenerate a plugin's BENCHMARK.md in the canonical format (identical structure across thunder-java/-angular/-python) by running the engine benches and writing real measured numbers. Use when asked to (re)produce, refresh, or standardize a plugin's benchmark report.
allowed-tools: Read, Write, Bash, Grep
---

# benchmark — (re)generate a plugin's BENCHMARK.md (internal to the Thunder repo)

This is a **project skill** (lives in `.claude/skills/`, not shipped inside any plugin). It writes
`plugins/<plugin>/BENCHMARK.md` so every plugin's report shares the **exact same structure**
(modeled on thunder-java). All numbers are **measured live** — never invented.

## Golden rule — gain = DATA tokens only
Every before/after is **thunder output (card / answer / index command) vs raw source read WITHOUT the
plugin**, at ~4 bytes/token. It **EXCLUDES** the fixed sub-agent overhead (~10.6k/agent) and the
SKILL.md size (~4.3k) — not part of a per-answer data cost. State this in the report.

## Per-plugin parameters
| plugin | realistic bed | extreme bed | generate the bed |
|---|---|---|---|
| thunder-java | `realdemo` | `bigdemo` | `gen-realdemo.mjs realdemo && populate-realdemo.mjs realdemo` |
| thunder-angular | `ngdemo` | `ngdemo` | `gen-ngdemo.mjs ngdemo 40` |
| thunder-python | `pydemo` | `pydemo` | `gen-pydemo.mjs pydemo` |
| thunder-node | `nodedemo` | `nodedemo` | `gen-nodedemo.mjs nodedemo 40` |

`<cache>` = `<bed>/.claude/cache/<plugin>`. Extra bench: java/python `analyze.mjs <bed>`, angular `data-bench.mjs demo`.

## Procedure (run from `plugins/<plugin>/`)
1. **Build + sanity** — generate the bed if missing, then:
   `node engine/thunder.mjs build <bed> --force` · `node engine/thunder.mjs --selftest` · `node --test` (must be green).
2. **Benches — capture the summary lines:**
   `node engine/tools/token-bench.mjs <bed>` · `node engine/tools/sweep-bench.mjs <bed>` · `node engine/tools/tier3-bench.mjs demo` · the extra bench.
3. **~6 real example outputs** (paste verbatim, trimmed) + measure each raw cost:
   overview (`index.yaml`/`project-brief.yaml`) · `sym def`/`sym refs <Type>` · `grep <term> capability-map.yaml` · `ask "<feature> flow"` · a module/feature `_index.yaml`/card · `grep <name> {endpoints,routes}.yaml`.

## Output — write `plugins/<plugin>/BENCHMARK.md` with EXACTLY these 10 sections
Keep the headings, order, and table columns identical for every plugin (only language, bed names and
numbers differ):

```markdown
# <plugin> — benchmark report (before / after)

**Method.** <data-token methodology, excludes sub-agent overhead + SKILL.md size>
**Test beds.** demo · <realistic bed> · <extreme bed>

## 1. Results table — <realistic bed>
<table: # | Query | entry point | before (tok) | after (tok) | gain>   (7 representative rows)

## 2. Concrete examples (query → what each reads → the real answer)
### Example 1 — overview
### Example 2 — symbol (where defined / who uses|injects)
### Example 3 — discovery ("which <unit> handles X")
### Example 4 — flow + business rules
### Example 5 — module / feature contents
### Example 6 — endpoints / routes

## 3. Extreme scale — <extreme bed>
<table: Query | before | after | gain>

## 4. Honest nuances (where thunder doesn't help)

## 5. One-time / amortized costs

## 6. Two-tier index (card / detail) — token-bench
<A/B and A/C ratios + inline-answered count [+ the plugin's extra bench line]>

## 7. Expanded sweep — ≥50 routed questions
<intro + summary line, THEN the FULL per-question markdown table from sweep-bench
(ALL ≥50 rows: # | Query | route | thunder | raw | factor | winner) — paste verbatim so every
tested question is visible. Do NOT collapse to just the aggregate.>

## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
<tier3-bench: answer-cache hit % of raw, prune % of raw; DEBUG via .thunder/<framework>/.config>

## 9. Verdict
<table by query type + one conclusion paragraph>

## 10. Rerun
<the exact build + bench commands>
```

## Guardrails
- Never invent a number — omit a row if its bench wasn't run, and say so.
- Section set + order identical across the three plugins; English throughout.
- Section 7 MUST contain the full ≥50-row table, not just the aggregate.
