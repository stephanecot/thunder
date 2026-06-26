# Thunder ⚡ — marketplace

A Claude Code marketplace of **token-minimal codebase-comprehension plugins**, **one plugin per
language / stack**. Each plugin builds a hierarchical YAML index (exact technical layer + inferred
functional layer) and exposes it through skills, an agent and hooks — so you can explore, understand and
navigate a codebase while spending **2–3 orders of magnitude fewer tokens**.

## Plugins

| Plugin | Stack | Status |
|---|---|---|
| [`thunder-java`](./plugins/thunder-java) | Java / Spring Boot (Maven) | ✅ available |
| `thunder-angular` | Angular / TypeScript | 🔜 planned |

> Shared architecture: pure Node.js engine (zero dependencies), cross-platform, sharded YAML index,
> incremental cache, hooks that never spend tokens silently. Each plugin writes its index to its own
> namespace (`.claude/cache/thunder-<language>/`) → no collision on a polyglot monorepo.

## Installation

```bash
# add the marketplace (from GitHub)
/plugin marketplace add stephanecot/thunder

# install the plugin you want
/plugin install thunder-java@thunder
```

See each plugin's README for details (e.g. [`plugins/thunder-java/README.md`](./plugins/thunder-java/README.md)).

## Structure

```
.claude-plugin/marketplace.json   # marketplace manifest
plugins/
  thunder-java/                   # Java plugin (engine, skills, agents, hooks, demo, tests)
    .claude-plugin/plugin.json
  thunder-angular/                # (coming soon)
```

## Why one plugin per language

Each stack has its own structural conventions (Spring annotations & beans, Angular modules &
components, …). A dedicated parser + index schema per language stays exact and lean, while the engine,
caching, hooks and functional-inference machinery are shared patterns reused across plugins.
