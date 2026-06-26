---
name: thunder-angular-codemap
description: Explore and understand an Angular/TypeScript codebase token-minimally via thunder-angular's pre-built YAML index (projects, feature contexts, routes, components, services, NgModules, dependency-injection graph, user-facing meaning). Use whenever the user asks how the app is structured, where a component/service lives, what routes/screens exist, or what a feature does — instead of reading .ts files.
allowed-tools: Read, Bash, Grep
---

# thunder-angular codemap — understand the app without reading it

thunder-angular maintains a hierarchical YAML index under `<project>/.claude/cache/thunder-angular/`.
Read the index, **never the `.ts` files**, while the index answers the question. Token cost stays
constant regardless of repo size.

## Golden rule (two-tier index)
**Card first, detail only when needed.** Each feature context has a **card** (`<feature>.card.yaml`,
≤20 lines: name, purpose, capabilities, component names, services, route signatures `path → target`) and a
**detail** (`<feature>.yaml`: full components, DI graph, NgModules, use-case flows, functional layer). The
card answers most structure/where/what questions at ~10% of the detail's tokens. Open the detail only for a
precise rule/flow/annotation; open a `.ts` only for a method body or template detail.

## Workflow
1. **One-payload retrieval (preferred)**:
   `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ask "<keywords>" "${CLAUDE_PROJECT_DIR}"`
   → returns the **cards** of matching feature contexts + relevant routes. One call. Enough for most questions.
2. Otherwise, manual drill-down:
   - **Top** — `Read .claude/cache/thunder-angular/index.yaml`: projects (+ theme/keywords), counts.
   - **Project** — `Read .../projects/<project>/_index.yaml`: one line per feature (with `card:` pointer).
   - **Card** — `Read .../projects/<project>/<feature>.card.yaml` (≤20 lines). **Answer from it if it suffices.**
   - **Detail (only if needed)** — `Read .../projects/<project>/<feature>.yaml` (the card's `detail` field gives the path):
     components (selector, standalone, inputs/outputs, deps), services, NgModules, routes (+intent), DI graph,
     use-case flows.

## Direct views
- All routes: `Read .claude/cache/thunder-angular/routes.yaml` (or `thunder.mjs routes <root>`).
- Discovery "which feature handles X?": `Grep` `capability-map.yaml` (do not load it whole).
- Counts: `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" overview "${CLAUDE_PROJECT_DIR}"`

## Notes
- `functional_stale: true` or `purpose: null` → propose `/thunder-angular:thunder-angular-reindex`.
- For a precise symbol (component/service def or references) use `/thunder-angular:thunder-angular-sym`.
