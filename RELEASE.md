# Thunder ⚡ — Release notes

Thunder is a marketplace of token-minimal codebase-comprehension plugins (one per stack) plus a shared
decision-index companion. All plugins share a pure-Node, zero-dependency engine, a sharded YAML index,
and a common **Tier-3** layer (answer cache · tool-output pruning · per-framework DEBUG trace).

## Current versions

| Plugin | Version | Highlights |
|---|---|---|
| `thunder-java` | 0.1.8 | Spring Boot index; rounds R2–R5.5; two-tier card/detail; Tier-3 |
| `thunder-angular` | 0.1.10 | Components/services/routes/guards/HTTP; per-feature granularity; ≥50-query sweep; Tier-3 |
| `thunder-python` | 0.1.4 | FastAPI/Flask/Django/plain auto-detection; analyze; Tier-3 |
| `thunder-node` | 0.0.2 | Express/Fastify/NestJS auto-detection; endpoints + DI |
| `thunder-react` | 0.0.1 | Function/class components + custom hooks + React Router; component→hook graph |
| `thunder-mind` | 0.2.0 | Shared decision index — tiered constitution + reliable capture |

> Versions reflect the number of measured optimization rounds (see each plugin's `BENCHMARK.md`).

## Highlights this release

### Shared Tier-3 layer (all plugins)
- **Answer cache** — `ask` relays a fresh prior answer at ~0 retrieval/reasoning; freshness gated by the
  index's `src_hash` + engine hash (never stale). Wired into the `codemap`/`grok` skills so the cache
  actually fills (`cache-answer` after a pure-index answer).
- **Tool-output pruning** — `thunder prune` keeps head/tail/diagnostics, elides the middle (~halves verbose logs).
- **Per-framework DEBUG** — a `.thunder/<framework>/.config` with `DEBUG=true` traces every operation's
  real **data-token** gain to `.thunder/gains.md` (excludes sub-agent overhead and SKILL.md size). Zero
  overhead when off.

### Benchmarks
- Every framework plugin ships a canonical `BENCHMARK.md` (identical 10-section format) with a **≥50-question
  routed sweep** — all currently **100% wins, 97–99% tokens saved** (java 95/95, angular 84/84, python 85/85,
  node 84/84, react 84/84).

### New language plugins
- **thunder-node** and **thunder-react** scaffolded via the internal `add-framework` skill, fully benched.

### thunder-mind 0.2.0 — scale + capture
- **Three-tier loading**: bounded **constitution** at session start (flat ~1.5k tokens at 200 *or* 2 000
  decisions), **per-domain cards** on demand, **recall** (inverted index + BM25). `scope: global|domain|local`
  controls *when* a decision loads, never *whether* — **no decision is ever lost** (full `domain-map.yaml`
  + recall reach 100%).
- **Reliable capture**: broadened `record` trigger (conventions/preferences, EN + FR), a `UserPromptSubmit`
  hint hook, and `add` now tolerates ```json fences.

### Repo / maintainer
- Internal project skills under `.claude/skills/`: `benchmark` (regenerate a canonical report),
  `add-framework` (scaffold a new plugin), `reinstall` (install + **enable** plugins in the Claude config).
- README: per-plugin descriptions + version/maturity table.

## Install / update
See [README — Installation](./README.md#installation). Maintainers: use the `reinstall` skill (it copies the
plugin into the cache, registers it in `installed_plugins.json`, **and sets `enabledPlugins`** — then reload
the session). Copilot variants are generated with `node build.mjs` into `dist/`.
