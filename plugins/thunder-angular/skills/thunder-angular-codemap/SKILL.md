---
name: thunder-angular-codemap
description: Explore and understand an Angular/TypeScript codebase token-minimally via thunder-angular's pre-built YAML index (projects, feature contexts, routes, components, services, NgModules, dependency-injection graph, user-facing meaning). Use whenever the user asks how the app is structured, where a component/service lives, what routes/screens exist, or what a feature does — instead of reading .ts files.
allowed-tools: Read, Bash, Grep
---

# thunder-angular codemap — understand the app without reading it

thunder-angular maintains a hierarchical YAML index under `<project>/.claude/cache/thunder-angular/`.
Read the index, **never the `.ts` files**, while the index answers the question. Token cost stays
constant regardless of repo size.

## Golden rule
Load the top → drill one level → read **one shard**. Only open a `.ts` file if the index lacks the
precise detail asked (e.g. a method body).

## Workflow
1. Ensure the index exists (the SessionStart hook does this): otherwise
   `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ensure "${CLAUDE_PROJECT_DIR}"`
2. **Top** — `Read .claude/cache/thunder-angular/index.yaml`: projects (+ theme/keywords), counts.
3. **Project drill-down** — `Read .claude/cache/thunder-angular/projects/<project>/_index.yaml`: one line
   per feature context (with purpose).
4. **Context shard** — `Read .claude/cache/thunder-angular/projects/<project>/<feature>.yaml`: components
   (selector, standalone, inputs/outputs, deps), services (providedIn, deps), NgModules, routes (+intent),
   the DI graph, and use-cases (route → component → service flows).

## Direct views
- All routes: `Read .claude/cache/thunder-angular/routes.yaml` (or `thunder.mjs routes <root>`).
- Discovery "which feature handles X?": `Grep` `capability-map.yaml` (do not load it whole).
- Counts: `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" overview "${CLAUDE_PROJECT_DIR}"`

## Notes
- `functional_stale: true` or `purpose: null` → propose `/thunder-angular:thunder-angular-reindex`.
- For a precise symbol (component/service def or references) use `/thunder-angular:thunder-angular-sym`.
