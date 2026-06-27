# thunder-python ⚡

## ⚠️ First: index the project (required — manual, one-time)

The skills answer **only** from a pre-built index. **Before your first query, run the indexer once:**

```
/thunder-python:thunder-python-reindex
```

The **technical** layer builds free & instantly; the **functional/business** layer is inferred once by
the cartographer agent (budgeted & confirmed). `codemap` / `grok` / `sym` won't return anything useful
until the index exists. After this first run a hook keeps it fresh on edits automatically; re-run
`reindex` after a large refactor or to refresh the functional layer.

Claude Code plugin for **token-minimal comprehension / exploration / navigation** of a Python codebase —
**FastAPI, Flask, Django, or plain Python** (auto-detected per package). Pure **Node.js indexing engine,
zero dependencies**, cross-platform.

> Principle: *the cheapest token is the one you never read.* Read a compact, hierarchical YAML index —
> never the `.py` files — so token cost is **independent of repo size**.

## What it extracts (technical layer, exact)
- **Routes** — unified across **FastAPI** (`@router.get/post`), **Flask** (`@bp.route(..., methods=[…])`)
  and **Django** (`urlpatterns = [path(…)]`). `verb · path · handler`.
- **Models** — Pydantic (`BaseModel`), Django (`models.Model`), dataclasses, SQLAlchemy. Fields + types.
- **Classes & functions**, the **dependency-injection graph** (FastAPI `Depends(…)`), and per-package
  **framework detection**.
- **Use-case flows** — derived `route → handler → injected deps`.

Plus an inferred **functional layer** (purpose, capabilities, business_rules, route intents) — all index
text in **English**. Indentation-aware parser (no braces), zero external deps.

## Components
| Type | Name | Role |
|---|---|---|
| Skill | `/thunder-python:thunder-python-codemap` | explore via the index (projects, packages, routes, models) |
| Skill | `/thunder-python:thunder-python-sym` | locate a symbol (def / refs / DI usages) |
| Skill | `/thunder-python:thunder-python-reindex` | refresh the index; re-infer meaning (budgeted); `--full` / `--tech` |
| Skill | `/thunder-python:thunder-python-grok` | answer a question (inline-first, routed, capped fan-out) |
| Agent | `thunder-python-cartographer` (Haiku) | infer the functional layer, grounded on an evidence pack |
| Hooks | SessionStart / PostToolUse | keep the index fresh, never spending tokens silently |

## Index (`<project>/.thunder/python/`)
```
project-brief.yaml            # frameworks, projects+roles, all routes, key rules (one inline read)
index.yaml                    # projects (+ theme/keywords)
projects/<p>/_index.yaml      # the project's package contexts (one line each)
projects/<p>/<package>.yaml   # package shard: routes, models, classes, DI + functional   (+ .card.yaml tier-1)
routes.yaml · capability-map.yaml · cache.ndjson · manifest.json · functional.json
```
Layout auto-detected (src-layout / single package / multi-package). Context = Python package (dotted path).

## Install (via the marketplace)
```bash
/plugin marketplace add stephanecot/thunder
/plugin install thunder-python@thunder
```

## CLI
```bash
ENG=engine/thunder.mjs
node $ENG build <project> [--force]   # (re)index (--force bypasses the cache after an engine change)
node $ENG routes <project>            # route table
node $ENG ask "<kw>" <project> [--facts|--detail <id>|--top N]
node $ENG sym def|refs <Name> <project>
```

## Tests
```bash
node --test                          # 25 unit tests (lexer, yaml, parser, derive — multi-framework)
node engine/thunder.mjs --selftest   # integration on demo/ (FastAPI + Flask + Django in one repo)
```
