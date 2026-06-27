# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This repository is a
**marketplace of several plugins**, each independently versioned with [Semantic Versioning](https://semver.org/);
the version a change applies to is noted inline. Per-plugin measured results live in each `plugins/<name>/BENCHMARK.md`.

## Current plugin versions

| Plugin | Version |
|---|---|
| `thunder-java` | 0.1.9 |
| `thunder-angular` | 0.1.10 |
| `thunder-python` | 0.1.4 |
| `thunder-node` | 0.0.2 |
| `thunder-react` | 0.0.1 |
| `thunder-mind` | 0.2.0 |

## [Unreleased]

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
