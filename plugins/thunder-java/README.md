# thunder-java ⚡

## ⚠️ First: index the project (required — manual, one-time)

The skills answer **only** from a pre-built index. **Before your first query, run the indexer once:**

```
/thunder-java:thunder-java-reindex
```

The **technical** layer builds free & instantly; the **functional/business** layer is inferred once by
the cartographer agent (budgeted & confirmed). `codemap` / `grok` / `sym` won't return anything useful
until the index exists. After this first run a hook keeps it fresh on edits automatically; re-run
`reindex` after a large refactor or to refresh the functional layer.

Claude Code plugin for **token-minimal comprehension / exploration / navigation** of a Java / Spring Boot
codebase. Pure **Node.js indexing engine, zero dependencies**, cross-platform (Windows/Linux/macOS).
See [`DESIGN.md`](./DESIGN.md) for the full architecture and [`BENCHMARK.md`](./BENCHMARK.md) for measured
token savings.

> Principle: *the cheapest token is the one you never read.* We read a compact, hierarchical YAML index —
> never the `.java` files — and delegate broad exploration to disposable sub-agents. Token cost becomes
> **independent of repo size**.

## Components

| Type | Name | Role |
|---|---|---|
| Engine | `engine/thunder.mjs` (+ `lib/`) | WALK → LEX → PARSE → DERIVE → EMIT; incremental cache; functional layer |
| Skill | `/thunder-java:thunder-java-codemap` | explore structure via the index (modules, contexts, endpoints, beans, entities) |
| Skill | `/thunder-java:thunder-java-sym` | locate a symbol (def / refs) without reading sources |
| Skill | `/thunder-java:thunder-java-reindex` | refresh the index; re-infer business meaning (budgeted); `--full` / `--tech` |
| Skill | `/thunder-java:thunder-java-grok` | answer a business/technical question (capped, seeded fan-out) |
| Agent | `thunder-java-cartographer` (Haiku) | infer the functional layer, grounded on an evidence pack (strict JSON) |
| Hooks | SessionStart / PostToolUse | keep the index fresh without ever spending tokens silently |

## Produced index (`<project>/.claude/cache/thunder-java/`)

```
index.yaml            # TOP: modules (+ inferred theme & keywords), always loadable
modules/<m>/_index.yaml   # the module's contexts (one line each, with purpose)
modules/<m>/<pkg>.yaml    # bounded-context shard: technical + functional
endpoints.yaml        # global endpoint table
capability-map.yaml   # one line per context, greppable (cheap discovery)
cache.ndjson          # internal source of truth (JSON, never read by the model)
manifest.json         # incremental (file→hash) + visible parse errors
functional.json       # inferred functional layer (evidence-hash)
```

Each shard carries two layers: **technical** (deterministic, exact) + **functional** (inferred: purpose,
capabilities, business_rules, intents). Functional staleness is keyed on an **evidence-hash** that is
sensitive to method bodies. All index content is written in **English**, whatever the source language.

## Install (via the marketplace)

```bash
/plugin marketplace add stephanecot/thunder
/plugin install thunder-java@thunder
```

Hooks index the project on session start and keep the index up to date on every edit.

## Direct engine use (CLI)

```bash
ENG=engine/thunder.mjs
node $ENG build <project>            # (re)index, incremental
node $ENG ensure <project>           # refresh + pointer line (SessionStart hook)
node $ENG overview <project>         # counters overview
node $ENG endpoints <project>        # endpoint table
node $ENG sym def|refs <Name> <project>
node $ENG stale <project>            # contexts whose business layer is stale
node $ENG evidence <ctxId> <project>            # evidence pack (for the cartographer)
node $ENG set-functional <ctxId> <project> < data.json   # merge inferred business meaning
node $ENG reset-functional <project>            # (for reindex --full)
node engine/tools/analyze.mjs <project>         # architecture/security insights (entity leaks, attack surface…)
```

## Performance (measured)

| Codebase | Cold build | Incremental |
|---|---|---|
| 3 840 `.java` files, 8 Maven modules | **~270 ms** (single-thread) | **~240 ms** |
| 1 320 files, realistic services (~108 lines) | **~150 ms** | quasi-free |

Full drill-down: `index.yaml` (~10 lines) → module `_index` (~80 lines) → shard (~110 lines).

## Tests

```bash
node --test                              # 36 unit tests (lexer, yaml, parser, derive, functional, module rollup)
node engine/thunder.mjs --selftest       # integration test on demo/
node engine/tools/gen-realdemo.mjs realdemo 3 40   # generate a realistic benchmark codebase
```

## Status

Phases 1 → 4 **delivered and tested**: technical engine, functional layer + cartographer, skills
(codemap / sym / reindex / grok), hooks + plugin packaging.

Future ideas: read a `thunder.config.json` (excludes/budget), index method-level annotations (e.g.
`@Valid` coverage), `worker_threads` (not needed below ~10k files given current perf), `--precise` via
jdtls (experimental).
