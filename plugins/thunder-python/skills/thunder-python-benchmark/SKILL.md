---
name: thunder-python-benchmark
description: Regenerate this plugin's BENCHMARK.md in the canonical Thunder format (before/after data-token tables, concrete examples, two-tier token-bench, ≥50-query sweep, Tier-3 layer, verdict, rerun). Runs the engine benches and writes real measured numbers. Use whenever the user asks to (re)produce, refresh, or standardize the benchmark report.
allowed-tools: Read, Write, Bash, Grep
---

# benchmark — produce BENCHMARK.md in the canonical format

This skill (re)generates `BENCHMARK.md` for **thunder-python** so every plugin's report shares the
**exact same structure** (modeled on thunder-java). All numbers are **measured live** — never invented.

## Golden rule — gain = DATA tokens only
Every "before/after" is **thunder output (card / answer / index command) vs raw source read WITHOUT the
plugin**, converted at ~4 bytes/token. It **EXCLUDES** the fixed sub-agent overhead (~10.6k/agent) and the
SKILL.md size (~4.3k) — those are not part of a per-answer data cost. State this in the report.

## Step 1 — build + sanity
```
cd <plugin>
node engine/thunder.mjs build pydemo --force      # realistic bench bed (generate it first if missing: node engine/tools/gen-pydemo.mjs pydemo)
node engine/thunder.mjs --selftest
node --test                                              # must be green before publishing numbers
```

## Step 2 — run the benches, capture the summary lines
```
node engine/tools/token-bench.mjs pydemo          # two-tier / inline A·B·C — data tokens
node engine/tools/sweep-bench.mjs pydemo          # ≥50 routed questions → wins/total + % saved
node engine/tools/tier3-bench.mjs demo                  # answer-cache hit + prune gains
node engine/tools/analyze.mjs pydemo              # architecture / security insights
```
Keep the final summary line of each (the `**x/y** … % saved` / `PASS` lines).

## Step 3 — capture ~6 real example outputs (paste verbatim, trimmed)
Run each and keep the **actual** output + measure raw cost (bytes of the source files you'd otherwise read):
1. **Overview** — `cat <cache>/index.yaml` (or `project-brief.yaml`)  vs reading the whole repo.
2. **Symbol** — `node engine/thunder.mjs sym def <Type> pydemo` and `sym refs <Type>`  vs grep+open.
3. **Discovery** — `grep -i <term> <cache>/capability-map.yaml`  vs reading the repo.
4. **Flow + rules** — `node engine/thunder.mjs ask "<feature> flow" pydemo`  vs reading the feature.
5. **Module / feature** — the relevant `_index.yaml` / card  vs reading all its files.
6. **Endpoints / routes** — `grep <name> <cache>/{endpoints,routes}.yaml`  vs reading the controller/routes.

`<cache>` = `pydemo/.claude/cache/thunder-python`.

## Step 4 — write BENCHMARK.md with EXACTLY these sections (fill from Steps 2-3)
Use this skeleton verbatim (same headings, same order, same table columns for every plugin):

```markdown
# thunder-python — benchmark report (before / after)

**Method.** Per query: bytes actually ingested **without thunder** (read the relevant source) vs **with
thunder** (read the index slice via the right skill), at ~4 bytes/token. Gain = DATA tokens only — it
EXCLUDES fixed sub-agent overhead (~10.6k/agent) and the SKILL.md size (~4.3k). Bias favors "before"
(assumes it already knows which files to open; really it must grep/glob first — the index does that free).

**Test beds.** `demo` (toy) · `pydemo` (realistic, main bed) · `pydemo` (extreme scale).

## 1. Results table — pydemo
| # | Query | entry point | before (tok) | after (tok) | gain |
|---|---|---|---|---|---|
<one row per Step-3 example, real numbers>

## 2. Concrete examples (query → what each reads → the real answer)
### Example 1 — overview
### Example 2 — symbol (where defined / who uses)
### Example 3 — discovery ("which part handles X")
### Example 4 — flow + business rules
### Example 5 — module / feature contents
### Example 6 — endpoints / routes
<each: "without thunder" cost, "with thunder" cost, and the REAL output fenced>

## 3. Extreme scale — pydemo
| Query | before (tok) | after (tok) | gain |
<overview + one module/feature row; index cost stays bounded>

## 4. Honest nuances (where thunder doesn't help)
<dumping a whole flat file = anti-pattern; reading one small known file ≈ neutral; thunder wins on breadth>

## 5. One-time / amortized costs
<technical index = 0 model tokens (CPU only), build time; functional inference = once per context, then free>

## 6. Two-tier index (card / detail) — token-bench
<token-bench table + the A/B and A/C ratios and inline-answered count>

## 7. Expanded sweep — ≥50 routed questions
<the FULL per-question markdown table from `sweep-bench` (ALL ≥50 rows: # | Query | route | thunder |
raw | factor | winner) — paste it verbatim so every tested question is visible — then the summary line
wins/total (100%?) · aggregate before vs after · % saved>. Do NOT collapse to just the aggregate.

## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
<tier3-bench: answer-cache hit % of raw, prune % of raw; DEBUG trace via .thunder.config>

## 9. Verdict
| Query type | thunder benefit |
<orientation / discovery / sym / understand-a-service / endpoints-routes / exhaustive-dump>
**Conclusion.** <one paragraph: gain grows with repo size & question breadth; cost shifts to a one-time
free (technical) / amortized (functional) index; thunder avoids "read to search", not large dumps.>

## 10. Rerun
\`\`\`
node engine/thunder.mjs build pydemo --force && node engine/tools/token-bench.mjs pydemo
node engine/tools/sweep-bench.mjs pydemo && node engine/tools/tier3-bench.mjs demo
\`\`\`
```

## Guardrails
- Never invent a number — if a bench wasn't run, omit the row and say so.
- Keep the **section set and order identical** across thunder-java / -angular / -python; only the language,
  demo names, and per-plugin numbers differ.
- English throughout. Tables use the exact columns above.
