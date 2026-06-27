# Thunder ⚡ — marketplace

A marketplace of **token-minimal codebase-comprehension plugins**, **one plugin per language / stack**,
for **both Claude Code and GitHub Copilot CLI**. Each plugin builds a hierarchical YAML index (exact
technical layer + inferred functional layer) and exposes it through skills, an agent and hooks — so you
can explore, understand and navigate a codebase while spending **2–3 orders of magnitude fewer tokens**.

## Plugins

| Plugin | Stack | Status |
|---|---|---|
| [`thunder-java`](./plugins/thunder-java) | Java / Spring Boot (Maven) | ✅ available |
| [`thunder-angular`](./plugins/thunder-angular) | Angular / TypeScript | ✅ available |
| [`thunder-python`](./plugins/thunder-python) | Python (FastAPI / Flask / Django / plain) | ✅ available |

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
