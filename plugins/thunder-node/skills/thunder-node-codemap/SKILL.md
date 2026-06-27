---
name: thunder-node-codemap
description: Explore and understand a Node.js backend codebase (Express / Fastify / NestJS) token-minimally by answering INLINE from thunder-node's pre-built YAML index (projects, feature contexts, routes, controllers, services, modules, dependency-injection graph, user-facing meaning). Use whenever the user asks how the app is structured, where a controller/service lives, what endpoints exist, or what a feature does — instead of reading .ts/.js files.
allowed-tools: Read, Bash, Grep
---

# codemap — understand the Node.js backend, INLINE

thunder-node maintains a YAML index under `<project>/.claude/cache/thunder-node/`. Answer from it **in
the main loop**; never read `.ts` while the index answers.

## Rule #1 — answer inline, sub-agent budget = 0
**Do NOT spawn ANY sub-agent (Task/Explore) for structure / where / what / which route / which flow / which
rule.** A sub-agent costs ~**11k tokens of fixed overhead**; answering inline costs ~**1k** (≈8× cheaper).
Not spawning an agent IS the optimization. A sub-agent is justified only to read a real `.ts` method body /
template — then 1 agent max, seeded with exact `file:line` from the index.

## Route the question FIRST (before reaching for `ask`)
| Question shape | Entry point (cheapest) |
|---|---|
| "where is X defined", "who uses/injects X", "find the controller/service X" | `thunder.mjs sym def\|refs <Name>` (~30 tok, exact) |
| "architecture", "how is it structured", "which projects/features", "overview" | `Read project-brief.yaml` — **not `ask`** |
| "which routes", "list the screens" | `Read routes.yaml` |
| "who handles / where is X" (discovery) | `Grep capability-map.yaml` |
| business rule, flow, "what does X do" | `ask --facts "<kw>"` then `ask` |

## Workflow (all inline)

1. **Architecture / overview / "what does the app do" / list routes** → read **one** file:
   `Read .claude/cache/thunder-node/project-brief.yaml` (arch style, projects + roles, all routes, key
   rules). Answer from it. **Do not also read `index.yaml` or cards.**

2. **A specific feature / where / flow / rule** → **one** command:
   `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ask "<keywords>" "${CLAUDE_PROJECT_DIR}"`
   → ranked top-3 feature cards; the **#1 hit carries its `business_rules` + route `flows`** so it is
   self-sufficient. **Do NOT combine** with reading `index.yaml` / `capability-map.yaml` / individual
   `.card.yaml`. Need more: `--top N`. Full detail of one context: `ask --detail <id> "$ROOT"`.

3. Manual drill-down (only if you prefer files over `ask`):
   - **Card** — `Read .../projects/<project>/<feature>.card.yaml` (≤20 lines; `card:` in the project
     `_index.yaml` points to it). Answer from it if it suffices.
   - **Detail (only if the card is not enough)** — `Read .../projects/<project>/<feature>.yaml` (the card's
     `detail` field gives the path).

## Inline vs fan-out artifacts
- **Inline** (read directly, no agent): `project-brief.yaml`, `ask` output, `capability-map.yaml` (grep),
  `routes.yaml`.
- **Fan-out** (seed a single agent): a specific `<feature>.yaml` detail shard.

## Notes
- `functional_stale: true` or `purpose: null` → suggest `/thunder-node:thunder-node-reindex`.
- For a precise symbol (controller/service def or references): `/thunder-node:thunder-node-sym`.
## Tier-3 — persist a pure-index answer (this is what fills the answer cache)
`ask` already CHECKS the answer cache first and relays a fresh prior answer at ~0 tokens — but the cache
only ever HITS if something WRITES to it. After you answered a question **purely from the index** (no
source-body read, no guessing), persist it so the next identical/paraphrased question is free:

```
printf '%s' "<your answer text>" | node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" \
  cache-answer --q "<the user's question>" --ctx <ctxId[,ctxId...]> --scope <archi|routes|where|flow|feature|endpoint> "${CLAUDE_PROJECT_DIR}"
```

- `--ctx` = the context id(s) your answer relied on (the `id` of each card you read). Freshness is gated
  on their `src_hash`, so the entry **auto-invalidates** when that source changes (never stale).
- Persist ONLY deterministic, index-derived answers — skip it if you read source files or made a judgment
  call. This is the only thing that makes Tier-3 pay off across repeated/teammate questions.
