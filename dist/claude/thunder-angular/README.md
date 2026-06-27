# thunder-angular ⚡

## ⚠️ First: index the project (required — manual, one-time)

The skills answer **only** from a pre-built index. **Before your first query, run the indexer once:**

```
/thunder-angular:thunder-angular-reindex
```

The **technical** layer builds free & instantly; the **functional/business** layer is inferred once by
the cartographer agent (budgeted & confirmed). `codemap` / `grok` / `sym` won't return anything useful
until the index exists. After this first run a hook keeps it fresh on edits automatically; re-run
`reindex` after a large refactor or to refresh the functional layer.

Claude Code plugin for **token-minimal comprehension / exploration / navigation** of an Angular /
TypeScript codebase. Pure **Node.js indexing engine, zero dependencies**, cross-platform. Shares the
thunder engine architecture (WALK → LEX → PARSE → DERIVE → EMIT, NDJSON cache, sharded YAML index,
inferred functional layer, hooks) with a **TypeScript lexer**, an **Angular-decorator parser**, and
**Angular-semantic derivation**.

> Principle: *the cheapest token is the one you never read.* Read a compact, hierarchical YAML index —
> never the `.ts` files — so token cost is **independent of repo size**.

## What it extracts (technical layer, exact)

- **Components** — selector, standalone flag, `@Input`/`@Output`, injected deps
- **Services** — `@Injectable` providedIn, injected deps
- **NgModules** — declarations / imports / providers / exports
- **Routes** — `path → component / loadComponent / loadChildren / redirectTo` (the navigable surface)
- **Directives & Pipes**, and the **dependency-injection graph** (constructor + `inject()`)
- **Use-case flows** — derived `route → component → service(s)`

Plus a **functional layer** (inferred by the cartographer: purpose, capabilities, user-facing rules,
route intents) — all index text in **English**.

## Components

| Type | Name | Role |
|---|---|---|
| Skill | `/thunder-angular:thunder-angular-codemap` | explore via the index (projects, features, routes, components, services) |
| Skill | `/thunder-angular:thunder-angular-sym` | locate a symbol (def / refs / DI usages) without reading sources |
| Skill | `/thunder-angular:thunder-angular-reindex` | refresh the index; re-infer meaning (budgeted); `--full` / `--tech` |
| Skill | `/thunder-angular:thunder-angular-grok` | answer a feature/technical question (capped, seeded fan-out) |
| Agent | `thunder-angular-cartographer` (Haiku) | infer the functional layer, grounded on an evidence pack |
| Hooks | SessionStart / PostToolUse | keep the index fresh, never spending tokens silently |

## Index (`<project>/.claude/cache/thunder-angular/`)

```
index.yaml                    # TOP: projects (+ theme & keywords)
projects/<p>/_index.yaml      # the project's feature contexts (one line each)
projects/<p>/<feature>.yaml   # feature shard: components, services, routes, NgModules, DI + functional
routes.yaml                   # global route table
capability-map.yaml           # one line per feature, greppable
cache.ndjson / manifest.json / functional.json   # internal
```

Workspace detection: reads `angular.json` `projects` (multi-project → top level = projects); otherwise a
single app with feature folders under `src/app/` as contexts.

## Install (via the marketplace)

```bash
/plugin marketplace add stephanecot/thunder
/plugin install thunder-angular@thunder
```

## CLI

```bash
ENG=engine/thunder.mjs
node $ENG build <project>      # (re)index, incremental
node $ENG routes <project>     # route table
node $ENG overview <project>   # counters
node $ENG sym def|refs <Name> <project>
node $ENG stale <project> ; node $ENG evidence <ctxId> <project> ; node $ENG set-functional <ctxId> <project> < data.json
```

## Tests

```bash
node --test                          # 26 unit tests (lexer, yaml, parser, derive)
node engine/thunder.mjs --selftest   # integration test on demo/ (standalone + NgModule features)
```
