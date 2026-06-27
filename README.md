# Thunder ⚡ — marketplace

A marketplace of **token-minimal codebase-comprehension plugins**, **one plugin per language / stack**,
for **both Claude Code and GitHub Copilot CLI**. Each plugin builds a hierarchical YAML index (exact
technical layer + inferred functional layer) and exposes it through skills, an agent and hooks — so you
can explore, understand and navigate a codebase while spending **2–3 orders of magnitude fewer tokens**.

## Plugins

| Plugin | Stack | Version | Optimization rounds | Maturity |
|---|---|---|---|---|
| [`thunder-java`](./plugins/thunder-java) | Java / Spring Boot (Maven) | `0.1.9` | 6 — R2…R5.5, two-tier card/detail, Tier-3 | ⭐⭐⭐ Mature |
| [`thunder-angular`](./plugins/thunder-angular) | Angular / TypeScript | `0.1.10` | 4 — granularity, functional guards + HTTP (R2), ≥50-query sweep, Tier-3 | ⭐⭐⭐ Mature |
| [`thunder-python`](./plugins/thunder-python) | Python (FastAPI / Flask / Django / plain) | `0.1.4` | 2 — multi-framework detection, Tier-3 | ⭐⭐ Stable |
| [`thunder-node`](./plugins/thunder-node) | Node.js backend (Express / Fastify / NestJS) | `0.0.2` | 1 — initial (multi-framework) | ⭐ New |
| [`thunder-react`](./plugins/thunder-react) | React.js (components / hooks / React Router) | `0.0.1` | 1 — initial | ⭐ New |
| [`thunder-mind`](./plugins/thunder-mind) | **Any** — shared project-decision index (companion) | `0.2.0` | 2 — tiered constitution + reliable capture | ⭐⭐ Stable |

> The first five are **codebase-comprehension** plugins (one per language/stack). **`thunder-mind`** is a
> different beast: a **framework-agnostic decision index** — it captures architectural / technical /
> functional decisions as committed YAML (`.thunder/mind/decisions/`) and recalls them (inverted-index +
> BM25, bounded alignment brief) so two developers' AIs reuse the same decisions instead of diverging.
> It composes with any of the language plugins.

> **Maturity** reflects how many dedicated optimization rounds a plugin has had (each round = a measured
> token-cost or correctness improvement, documented in the plugin's `BENCHMARK.md`). ⭐ New = freshly
> scaffolded & benched · ⭐⭐ Stable · ⭐⭐⭐ Mature (multiple measured rounds). All share the same Tier-3
> layer (answer cache · tool-output pruning · per-framework DEBUG trace) and the ≥50-question sweep.

### Each plugin in detail

- **[`thunder-java`](./plugins/thunder-java)** — Java / Spring Boot (Maven, mono- or multi-module). Indexes
  controllers → **endpoints**, services, JPA **entities** & relations, the **bean/DI graph**, and derived
  request **flows** (endpoint → controller → service → repository). Skills: `codemap`, `grok`, `sym`,
  `reindex`. The most battle-tested plugin (rounds R2–R5.5 + two-tier card/detail).
- **[`thunder-angular`](./plugins/thunder-angular)** — Angular / TypeScript. Indexes **components** (selector,
  in/out, standalone), **services**, **routes** with **guards** (incl. functional guards & factory-call
  guards), **NgModules**, the **DI graph**, and each service's **HTTP contract** (verb + normalized URL).
  Per-feature context granularity for big apps.
- **[`thunder-python`](./plugins/thunder-python)** — Python, **framework-aware & auto-detected**: FastAPI /
  Flask / Django / plain. Indexes **routes** (unified across frameworks), **models** (Pydantic / dataclass /
  SQLAlchemy / Django), **classes**, dependencies, plus an `analyze` for the mutating-route attack surface.
- **[`thunder-node`](./plugins/thunder-node)** — Node.js backends, **multi-framework auto-detected**:
  **NestJS** (`@Controller`/`@Get…` → endpoints, `@Injectable`, `@Module`, constructor DI), **Express** &
  **Fastify** (`app/router.<verb>('/path', …)` routes). Indexes controllers, services, HTTP endpoints, DI.
- **[`thunder-react`](./plugins/thunder-react)** — React.js (`.tsx/.jsx/.ts/.js`). Indexes **function & class
  components** (props + hooks used), **custom hooks** (modeled as the logic units), **React Router** routes,
  and the **component → hook** dependency graph. Derives route → component → hook flows.
- **[`thunder-mind`](./plugins/thunder-mind)** — the **companion**, framework-agnostic. Not a code index: a
  **shared decision index**. Each decision is one committed YAML in `.thunder/mind/decisions/`; the engine
  builds a **three-tier** view — a bounded **constitution** (cross-cutting invariants, the only thing injected
  at session start, *flat cost* even at 2 000+ decisions), **per-domain cards** (on demand), and **recall**
  (inverted index + BM25). Nothing is ever lost (full `domain-map.yaml` + recall reach 100%). Reliable
  **capture** of conventions stated in passing (broadened trigger + `UserPromptSubmit` hint). Skills:
  `record`, `recall`, `harvest`, `review`, `reindex`.

Every plugin: pure-Node **zero-dependency** engine · **2–3 orders of magnitude** fewer tokens to
explore/understand/navigate · committed-source vs gitignored-derived split · hooks that never spend tokens
silently · the shared **Tier-3** layer (answer cache · pruning · per-framework DEBUG).

> Shared architecture: pure Node.js engine (zero dependencies), cross-platform, sharded YAML index,
> incremental cache, hooks that never spend tokens silently. Each plugin writes its index to its own
> namespace (`.claude/cache/thunder-<language>/`) → no collision on a polyglot monorepo.

## Installation

### Claude Code

```bash
/plugin marketplace add stephanecot/thunder   # add the marketplace (from GitHub)
/plugin install thunder-java@thunder          # install the plugin you want
```

### GitHub Copilot CLI

The Copilot variants are **generated** from the same source (see [Dual-host build](#dual-host-build)):

```bash
node build.mjs                                 # build dist/copilot/ (+ dist/claude/)
copilot plugin marketplace add .               # reads .github/plugin/marketplace.json (repo root)
copilot plugin install thunder-java            # idem thunder-angular / thunder-python
```

See each plugin's README for details (e.g. [`plugins/thunder-java/README.md`](./plugins/thunder-java/README.md)).

## Dual-host build

`plugins/<name>` is the **single source of truth** (Claude-authored). `build.mjs` derives the Copilot
variant — skills, agents and hooks are authored **once**; the `engine/` is **symlinked** into every
output (one real copy). Host differences are purely mechanical (`${CLAUDE_PLUGIN_ROOT}`→`${PLUGIN_ROOT}`,
`hooks/hooks.json`→root `hooks.json`, `*.md`→`*.agent.md`, manifest location, …). See
[`dist/README.md`](./dist/README.md).

## Structure

```
.claude-plugin/marketplace.json     # Claude marketplace  → ./plugins/<name>
.github/plugin/marketplace.json     # Copilot marketplace → ./dist/copilot/<name>   (generated)
build.mjs                           # plugins/ (source) → dist/{claude,copilot}/
plugins/
  thunder-java/                     # source plugin (engine, skills, agents, hooks, demo, tests)
    .claude-plugin/plugin.json
  thunder-angular/  thunder-python/
dist/                               # generated — Claude + Copilot, installable
  claude/<name>/    copilot/<name>/
```

## Why one plugin per language

Each stack has its own structural conventions (Spring annotations & beans, Angular modules &
components, …). A dedicated parser + index schema per language stays exact and lean, while the engine,
caching, hooks and functional-inference machinery are shared patterns reused across plugins.

## Shared Tier-3 layer (cross-framework)

Language-agnostic token mechanics live once under `shared/engine/common/` and are synced byte-identical
into every plugin by `node shared/sync.mjs` (same precedent as `engine/lib/hash.mjs`/`yaml.mjs`):

- **Answer cache** — `ask` first consults `qa-ledger.ndjson`; a fresh prior answer is relayed at ~0
  retrieval/reasoning. Freshness is gated by the index's existing per-context `src_hash` + the engine
  hash, so a cached answer is **never stale**. Persist with
  `thunder cache-answer --q … --ctx … -- <answer on stdin>`; maintain with `cache-gc` / `cache-stats`.
- **Tool-output pruning** — `thunder prune` (stdin or file) keeps head + tail + every diagnostic line
  and elides the middle, halving the cost of verbose test/build logs.

### DEBUG mode — gain tracing

Drop a `.thunder/<framework>/.config` at your project root with `DEBUG=true`. Every operation then appends its token
saving (vs reading raw source) to `.thunder/gains.md` — a running ledger of the value the plugin
delivered. With `DEBUG=false` or no config file there is **zero overhead** (one memoized config read;
all gain computation is gated).
