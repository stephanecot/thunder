# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This repository is a
**marketplace of several plugins**, each independently versioned with [Semantic Versioning](https://semver.org/);
the version a change applies to is noted inline. Per-plugin measured results live in each `plugins/<name>/BENCHMARK.md`.

## Current plugin versions

| Plugin | Version |
|---|---|
| `thunder-java` | 0.1.13 |
| `thunder-angular` | 0.1.14 |
| `thunder-python` | 0.1.8 |
| `thunder-node` | 0.0.6 |
| `thunder-react` | 0.0.5 |
| `thunder-mind` | 0.2.1 |

## [Unreleased]

## [2026-07-01]

### Changed
- **All framework plugins** (`thunder-java` `0.1.13`, `thunder-angular` `0.1.14`, `thunder-python` `0.1.8`,
  `thunder-node` `0.0.6`, `thunder-react` `0.0.5`) — **token-lean emitted artifacts**:
  - **YAML emitter**: non-flowable list items hoist their first key onto the dash line (`- verb: POST`) —
    no more orphan dashes (java realdemo: 6 362 wasted lines → 0, ~3% of every index read);
  - **`endpoints.yaml` / `routes.yaml`**: ONE grep-friendly line per endpoint/route
    (`VERB path  Controller.fn  Req -> Resp  (ctx)`) — java realdemo: 29 575 → 20 923 tok (**−29%**) on
    "list all endpoints", the costliest sweep-bench query;
  - **`capability-map.yaml`**: mapping `id: "purpose — capabilities"`, one line per context (**−59%** on
    realdemo) — a single grep hit now carries id + purpose + capabilities (multi-line hits used to come
    back without their id, useless on their own);
  - **cartographer**: `glossary`/`confidence` removed from the output schema — generated and stored but
    never emitted to any artifact (pure Haiku output waste per context).
  BENCHMARK.md re-measured: java sweep aggregate 67 735 → **59 783 tok** (95/95 wins kept).
- **`thunder-mind`** `0.2.1` — same token treatment: fixed YAML emitter (orphan dashes gone from the
  session-injected `brief.yaml`), `domain-map.yaml` ONE line per decision (**−36%** at 200 decisions,
  grep hits now self-sufficient), Tier-3 `cache-answer` section added to the recall skill (the answer
  cache was read but never written), scribe gained a **batch mode** for harvest (one sub-agent for N
  candidates instead of N boots) and an `evidence` output field, `add` defaults the author to
  `git config user.name`, and CLI/session messages are English (the index language).

### Fixed
- **`thunder-mind`** `0.2.1`:
  - **`capture-hint` hook is now opt-in and precise** — it only speaks in projects with `.thunder/mind/`
    (it used to inject reminders into every repo of every plugin user) and the French cues require a
    verbal rule form ("il faut toujours…") — an incidental "toujours" no longer triggers it;
  - **hand-edited decisions parse safely** — folded/literal block scalars (`key: >` / `key: |`) are
    parsed instead of silently storing `">"` as the value, and ` #` inline comments are stripped per
    YAML semantics;
  - **`evidence` false positives** — `v2.0`, `RFC 7807.1`, `PR #245`, URLs are no longer treated as file
    paths (no more phantom `evidence-missing`);
  - **range-aware evidence drift** — `file.sql:12` evidence now hashes the cited lines, so an unrelated
    edit elsewhere in the file no longer flags the decision stale (legacy whole-file hashes still work);
  - **`tier3-bench.mjs`** (a shared tool assuming a framework model) is no longer synced into
    thunder-mind, where it crashed on import — `shared/sync.mjs` supports per-entry exclusions; mind's
    own `tools/bench.mjs` already measures the Tier-3 layer.

## [2026-06-30]

### Changed
- **`thunder-java`** `0.1.12` — **functional reindex made cheap at scale.** Inferring the business layer of
  a large project previously spawned **one sub-agent per context** and routed each ~4k-token evidence pack
  through the (Opus) orchestrator → quadratic blow-up (~7M tokens / 350 sub-agents on a real project). Now:
  - new engine commands `evidence-batch` (writes every stale context's pack to a **file**, prints only a
    tiny ids+paths manifest) and `set-functional-batch` (merges a whole batch in one call, re-emits once);
  - the cartographer agent gained a **batch mode** (given file paths, it `Read`s the packs itself);
  - the `reindex` skill now materializes packs to disk and infers **~10 contexts per sub-agent**, a few in
    parallel — so packs never touch the orchestrator's context and N sub-agents collapse to N/10.
  Net: a 350-context project drops from ~7M tokens to **~2M, almost all on cheap Haiku input** (the expensive
  Opus share, which dominated, nearly disappears). Evidence packs live under the gitignored
  `.thunder/java/evidence/`.
- **Same batched, file-based reindex propagated to every framework plugin** — `thunder-angular` `0.1.13`,
  `thunder-python` `0.1.7`, `thunder-node` `0.0.5`, `thunder-react` `0.0.4`: identical `evidence-batch` /
  `set-functional-batch` commands, cartographer batch mode, and the rewritten `reindex` cost-model flow.

## [2026-06-27a]

### Added
- **Per-project opt-in via a new `init` skill** (all framework plugins: java `0.1.11`, angular `0.1.12`,
  python `0.1.6`, node `0.0.4`, react `0.0.3`) — `/<plugin>:<plugin>-init` writes a committed marker
  `.thunder/<lang>/config.yaml` (`enabled: true`) and builds the technical index. New `init` engine
  command (`node thunder.mjs init <root>`).

### Fixed
- **Plugins polluted unrelated projects** — an installed framework plugin's SessionStart hook ran
  `ensure`→`build` on *every* project, creating empty `.thunder/<lang>/` directories on repos with no
  matching sources. Indexing is now **opt-in**: `ensure` and the PostToolUse hook stay completely idle
  (no directory, no tokens) until the project is initialized (committed `.thunder/<lang>/config.yaml`).
  An explicit `build`/`reindex` that produces a non-empty index also writes the marker, so the index is
  never left orphaned from the hooks.

## [2026-06-27]

### Added
- **`thunder-node`** `0.0.2` — Node.js backend plugin: NestJS (`@Controller`/`@Get…` → endpoints,
  `@Injectable`, `@Module`, constructor DI), Express & Fastify (`app/router.<verb>('/path', …)` routes),
  framework auto-detection. Demo + `gen-nodedemo`, canonical `BENCHMARK.md`.
- **`thunder-react`** `0.0.1` — React plugin: function/class components (props + hooks used), custom hooks
  (as logic units), React Router routes, component→hook graph. Demo + `gen-reactdemo`, canonical `BENCHMARK.md`.
- **Shared Tier-3 layer** (all plugins) — answer cache (`qa-ledger.ndjson`, hash-validated), tool-output
  pruning (`thunder prune`), per-framework DEBUG trace.
- **≥50-question routed sweep** benchmarks for every framework plugin (currently 100% wins, 97–99% saved).
- **`thunder-mind`** `0.2.0` — three-tier loading (bounded constitution + per-domain cards + recall), the
  `scope: global|domain|local` field, and a new `card <domain>` command.
- **Internal maintainer skills** under `.claude/skills/`: `benchmark`, `add-framework`, `reinstall`.
- **Docs** — `CHANGELOG.md`; README per-plugin detail + version/maturity table.

### Changed
- **Framework index is now committed & shared** (java `0.1.10`, angular `0.1.11`, python `0.1.5`,
  node `0.0.3`, react `0.0.2`) — relocated from the gitignored `.claude/cache/thunder-<lang>/` to a
  **committed `.thunder/<language>/`** (project-brief, shards, cards, capability-map, routes/endpoints,
  and the inferred `functional.json`). Two developers share one index on a branch and don't re-spend
  tokens re-inferring the functional layer. Only per-dev volatile files stay gitignored (`cache.ndjson`,
  `manifest.json`, `dirty.list`, `qa-ledger.ndjson`, `.config`).
- **`thunder-angular`** `0.1.10` — ROUND 2: factory-call route guards (`scopeGuard('x')`) and real HTTP
  verb + normalized URL extraction; expanded sweep to ≥50 questions.
- **DEBUG config** is now **per-framework** at `.thunder/<framework>/.config` (was a single `.thunder.config`),
  so a polyglot repo can enable DEBUG for one plugin without the others.
- **`thunder-mind`** `0.2.0` — only a bounded **constitution** (cross-cutting invariants) is injected at
  session start: flat ~1.5k tokens at 200 *or* 2 000 decisions; everything else loads on demand
  (per-domain cards, recall). No decision is ever lost — `domain-map.yaml` + recall reach 100%.
- Benchmarks consolidated into one canonical 10-section `BENCHMARK.md` format across plugins, each
  embedding its full ≥50-question sweep table.

### Fixed
- **Tier-3 answer cache was never populated** in real use — the `codemap`/`grok` skills now call
  `cache-answer` after a pure-index answer, so the cache actually fills and hits.
- **Plugins not visible after install** — installation also requires `enabledPlugins` in
  `~/.claude/settings.json`; the `reinstall` skill now sets cache + `installed_plugins.json` + `enabledPlugins`.
- **`thunder-mind` capture unreliable** — broadened `record` trigger (conventions/preferences, EN + FR),
  new `UserPromptSubmit` hint hook, and `add` now tolerates ```json fences.

[Unreleased]: https://github.com/stephanecot/thunder/compare/main...HEAD
