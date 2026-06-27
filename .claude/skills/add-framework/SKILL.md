---
name: add-framework
description: Internal maintainer skill for the Thunder repo. Scaffold a brand-new language/framework plugin (thunder-<lang>) end-to-end — clone the closest existing plugin, rename everything, adapt the parser/derive/emit layer, wire the shared Tier-3 layer, add a demo + tests + benches, and register it in the marketplace. Use whenever the user wants to add support for a new language or framework.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# add-framework — scaffold a new `thunder-<lang>` plugin (internal to the Thunder repo)

Project skill (lives in `.claude/skills/`, never shipped). It turns "support <X>" into a working plugin
that matches the existing three. **Read `DESIGN.md` and one existing plugin before starting.** Work on a
dedicated branch.

## 0. Mental model — what a plugin is
A plugin is a **pure-Node, zero-dependency engine** that indexes a codebase into a hierarchical YAML
index, plus the skills/agent/hooks that read it. Pipeline (per `engine/lib/`):

```
WALK (list source files)  →  LEX (strip comments/strings)  →  PARSE (per-file facts: types, members,
routes, DI)  →  DERIVE (cross-file model: contexts, services, endpoints, graph)  →  EMIT (YAML index)
```
with a per-file cache (`cache.ndjson` + `manifest.json`), incremental rebuilds, an `ENGINE_HASH`
cache-bust, a per-context `src_hash` (freshness), and an inferred **functional layer** (Haiku
cartographer, evidence-hash staleness). The technical layer is exact & free; the functional layer is
inferred once per context and then read free.

## 1. What is SHARED vs PER-LANGUAGE (the single most important thing)

| File(s) | Status | Action when adding a plugin |
|---|---|---|
| `engine/lib/common/{prune,ledger,debug}.mjs` | **SHARED** (byte-identical, Tier-3) | pulled by `node shared/sync.mjs` — never edit per-plugin |
| `engine/test/common.test.mjs`, `engine/tools/tier3-bench.mjs` | **SHARED** | pulled by `shared/sync.mjs` |
| `engine/lib/hash.mjs`, `engine/lib/yaml.mjs` | **identical copies** | copy verbatim from any plugin |
| `engine/lib/cache.mjs` | near-identical | copy; change ONLY the `thunder-<lang>` suffix in `cacheDir` |
| `engine/lib/walk.mjs` | per-language | adapt the **file-extension** filter |
| `engine/lib/lexer.mjs` | per-language | comment/string syntax of the language |
| `engine/lib/parser.mjs` | **per-language (the core)** | extract types/functions/routes/DI for the framework |
| `engine/lib/derive.mjs` | per-language | build contexts/services/endpoints + framework detection |
| `engine/lib/emit.mjs` | per-language (shared *schema*) | write the index — **keep the emitted shape** (§4) |
| `engine/lib/build.mjs` | per-language | `locate()`/feature assignment, `projectsOf`, `ENGINE_HASH` list |
| `engine/lib/functional.mjs` | near-identical | evidence pack shape; usually copy as-is |
| `engine/thunder.mjs` | per-language (same commands) | the CLI: dispatch + `cmdAsk` (+ Tier-3 wiring, §3) |
| `skills/thunder-<lang>-{codemap,grok,reindex,sym}/` | per-language | rename + adjust language wording |
| `agents/thunder-<lang>-cartographer.md` | per-language | rename; adapt the "what a context is" prose |
| `hooks/{hooks.json,hook.mjs}` | per-language | `hook.mjs` extension regex |
| `engine/tools/{gen-*,sweep-bench,token-bench[,analyze,data-bench]}.mjs` | per-language | demo generator + benches |
| `demo/` | per-language | a small realistic project in the new language |
| `.claude-plugin/plugin.json`, `BENCHMARK.md`, `README.md` | per-language | metadata + docs |

## 2. Pick the closest plugin to clone (by **parsing strategy**, not by language family)
- **Brace-delimited blocks** (Java, Kotlin, C#, Go, Rust, Swift, plain TS/JS): clone **thunder-java**
  (its parser tracks `{`/`}` depth + annotations).
- **TS + decorators / component model** (Angular, NestJS, Vue-TS): clone **thunder-angular** (decorator
  scan, `captureParensSpan`, route/guard/HTTP extraction).
- **Indentation-delimited** (Python; also a starting point for Ruby/Elixir-ish): clone **thunder-python**
  (indentation logical-lines, multi-framework detection).

## 3. Step-by-step

1. **Branch + clone**
   ```
   git checkout -b add-thunder-<lang>
   cp -R plugins/thunder-<closest> plugins/thunder-<lang>
   rm -rf plugins/thunder-<lang>/{demo,bigdemo,ngdemo,pydemo,realdemo,.claude}   # drop the cloned demo + caches
   ```
2. **Rename `thunder-<closest>` → `thunder-<lang>` everywhere.** Exact targets:
   - `.claude-plugin/plugin.json`: `name`, `displayName`, `version` (reset to `0.0.1`), `description`, `keywords`.
   - `engine/lib/cache.mjs`: the `cacheDir` suffix `thunder-<lang>`.
   - rename `skills/thunder-<closest>-*` dirs → `thunder-<lang>-*`, and fix `name:` in each `SKILL.md` frontmatter + any `/thunder-<closest>:` references in the body.
   - rename `agents/thunder-<closest>-cartographer.md` → `thunder-<lang>-cartographer.md`, fix `name:`.
   - `hooks/hook.mjs`: the file-extension regex; `hooks/hooks.json` references `${CLAUDE_PLUGIN_ROOT}` (host-agnostic — no rename needed).
   - any `thunder-<closest>` string in `engine/thunder.mjs`, tools, README, BENCHMARK.
   - Verify: `grep -rn "thunder-<closest>" plugins/thunder-<lang>` returns nothing.
3. **Pull the shared layer** (so Tier-3 is byte-identical): add `'thunder-<lang>'` to `PLUGINS` in
   `shared/sync.mjs`, then `node shared/sync.mjs`. Confirm `engine/lib/common/`, `engine/test/common.test.mjs`,
   `engine/tools/tier3-bench.mjs` are present and identical.
4. **Adapt the language layer**, in this order, testing after each (`node engine/thunder.mjs build demo --force`):
   - `walk.mjs` — the source extensions.
   - `lexer.mjs` — blank out comments/strings (preserve line count & columns) so the parser sees clean code.
   - `parser.mjs` — emit per-file facts: `{ file, types:[{n,kind,line,methods,props,...}], routes/endpoints, functionals, di, hash }`. This is the bulk of the work; mirror the cloned parser's shape.
   - `derive.mjs` — assemble contexts, services, endpoints/routes, the DI graph; set `ctx.src_hash` and (if relevant) `ctx.framework`. **Multi-framework**: copy thunder-python's `_sig` set + `order.find(...)` detection.
   - `emit.mjs` — write the index files. **Do not change the schema (§4).**
   - `build.mjs` — `projectsOf()` (the project/module model of the ecosystem), `locate()`/feature assignment, and extend `ENGINE_HASH` to every parse/derive-affecting file you changed (lexer+parser at minimum; add derive/build if their changes affect output).
5. **Keep the emitted index contract identical** (§4) — skills, the shared Tier-3 `ask` lookup, and the
   benchmark skill all depend on it.
6. **Demo + generator**: write a small realistic `demo/` (≈10-30 files) exercising the framework's
   routes/services/DI/rules, plus `engine/tools/gen-<lang>demo.mjs` for a large synthetic bench bed
   (mirror `gen-ngdemo.mjs`/`gen-realdemo.mjs`). Add `**/<lang>demo/` to `.gitignore`.
7. **Tier-3 wiring** (already present if you cloned a current plugin — verify): `cmdAsk` consults
   `ledger.lookup(...)` first; `cache-answer`/`cache-gc`/`cache-stats`/`prune` commands dispatch; `ask:index`,
   `ask:cache-hit`, `prune` `debug.trace(...)` calls fire. Imports: `cacheDir, readManifest` from cache, and
   `* as ledger`, `prune`, `* as debug` from `./lib/common/`.
8. **Tests + benches green**: `node --test` (port the cloned parser/derive/card/yaml tests to the new
   syntax + keep `common.test.mjs`), `node engine/thunder.mjs --selftest`, then
   `token-bench` / `sweep-bench` / `tier3-bench`. Targets: sweep ≥70% wins & ≥70% saved, token-bench A/B≤25% A/C≤15%, tier3-bench PASS.
9. **Register the plugin**:
   - `.claude-plugin/marketplace.json` — add the entry (`name`, `source: ./plugins/thunder-<lang>`, `description`, `version`, `keywords`).
   - `shared/sync.mjs` `PLUGINS` — already done in step 3.
   - `.claude/skills/benchmark/SKILL.md` — add a row to the per-plugin params table (bed names, gen cmd, extra bench).
   - `README.md` — mention the new plugin. (`build.mjs` auto-discovers `plugins/thunder-*` — no change.)
10. **Build + install**: `node build.mjs` (regenerate `dist/`), bump version, then install/reinstall to test.

## 4. The emitted index contract (MUST stay identical across plugins)
Under `<root>/.claude/cache/thunder-<lang>/`:
- `project-brief.yaml` (tier-0 overview) · `index.yaml` + per-project `_index.yaml`
- `<ctx>.card.yaml` (tier-1, ≤20 lines) **and** `<ctx>.yaml` (tier-2 detail, carries `src_hash`) — both required (skills + `sym` depend on them)
- `routes.yaml` **or** `endpoints.yaml` · `capability-map.yaml`
- `manifest.json` (`engineHash` + per-file `hash`) · `cache.ndjson` (internal source of truth) · `dirty.list`
A context object exposes at least: `id, project, name, feature, packages, files, src_hash`, plus the
language's units (`types`/`classes`, `services`, `routes`/`endpoints`, `di`). Keep these — the shared
`ask`/ledger/benchmark code reads them.

## 5. Invariants & guardrails
- **Zero npm dependencies.** Pure Node. Cross-platform (Win/macOS/Linux), works on large codebases.
- **All index content in English** (names, purpose, capabilities, rules, theme, keywords).
- **Skills/agents bodies in English.** Skill names prefixed `thunder-<lang>-`; agent `thunder-<lang>-cartographer`.
- **Don't touch** the cartographer inference contract, the evidence-pack format, or the stale/reindex cycle.
- **Reuse the existing hashes** for invalidation (`src_hash`, `engineHash`); never invent a parallel cycle.
- **Retro-compat**: only ADD fields to `<ctx>.yaml`/`*.card.yaml`.
- Commit only when done; bump version; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 6. Acceptance checklist (all must pass before declaring done)
- [ ] `grep -rn "thunder-<closest>" plugins/thunder-<lang>` → empty.
- [ ] `node shared/sync.mjs --check` → in sync (shared layer pulled).
- [ ] `node engine/thunder.mjs build demo --force` → builds; `--selftest` OK.
- [ ] `node --test` green (ported language tests + `common.test.mjs`).
- [ ] `sweep-bench` ≥50 questions, ≥70% wins & ≥70% saved; `token-bench` targets met; `tier3-bench` PASS.
- [ ] `cmdAsk` ledger hit works (cache-answer → paraphrase hit → STALE on source edit).
- [ ] index contract present (§4): brief, card+detail, routes/endpoints, capability-map, manifest.
- [ ] registered in marketplace.json + sync PLUGINS + benchmark skill table; `node build.mjs` clean.
- [ ] `/benchmark` regenerates `plugins/thunder-<lang>/BENCHMARK.md` in the canonical format.
