---
name: thunder-angular-grok
description: Answer a question about what an Angular app does or how it works (user-facing or technical), token-minimally, using thunder-angular's index and bounded fan-out. Use for "how does the X screen work", "where is feature Y handled", "what does the orders feature do", "trace what happens when the user opens /users". Seeds sub-agents with index slices so they don't re-explore.
allowed-tools: Read, Grep, Bash, Task
---

# thunder-angular grok — answer a question about the app

Answer **correctly** with the **fewest tokens**. Start from the index; read `.ts` only if needed; delegate
broad exploration to sub-agents **seeded** with the relevant index slice.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Procedure
1. **Target the feature(s)**: `Grep` the question's keywords in
   `.claude/cache/thunder-angular/capability-map.yaml` and/or `routes.yaml`; `Read index.yaml` to find the
   project.
2. **Load the shard(s)**: `Read` 1–3 context shards (`projects/<project>/<feature>.yaml`) — components,
   services, routes (+intent), DI graph, use-case flows, functional layer. **Often enough — stop here.**
3. **Only if real code is needed** (a method body, a template detail): delegate to `Explore` sub-agents
   (Task), **capped ~3-4**, each given the relevant shard + exact `file:line`. They return short
   conclusions, not dumps. Use `sym def <Name>` to locate a symbol before delegating.
4. **Synthesize** with `file:line` citations. Separate **exact** (technical, from the index) from
   **inferred** (functional layer, marked inferred).

## Token guards
- Never read a whole feature's `.ts` files. Prefer shard → targeted fan-out.
- Fan-out spends tokens in sub-agents: cap it, and only when the index is insufficient. Pure structure
  questions are answered by the index alone.
- If the functional layer is missing (`purpose: null`) or `functional_stale`, suggest
  `/thunder-angular:thunder-angular-reindex` before answering a feature-level question.
