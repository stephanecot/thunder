---
name: thunder-java-codemap
description: Explore and understand a Java/Spring Boot codebase token-minimally by answering INLINE from thunder's pre-built YAML index (modules, contexts, endpoints, beans, JPA entities, business meaning). Use whenever the user asks how the app is structured, where something lives, what endpoints/services/entities exist, or what a module does — instead of reading .java files.
allowed-tools: Read, Bash, Grep
---

# codemap — understand the codebase, INLINE

thunder maintains a YAML index under `<project>/.thunder/java/`. Answer from it **in the main
loop**; never read `.java` while the index answers.

## Rule #1 — answer inline, sub-agent budget = 0
**Do NOT spawn ANY sub-agent (Task/Explore) for structure / where / what / which endpoint / which flow /
which business rule.** A sub-agent costs ~**11k tokens of fixed overhead**; answering inline costs ~**1k**
(≈8× cheaper). Not spawning an agent IS the optimization. A sub-agent is justified only to read a real
`.java` method body — then 1 agent max, seeded with exact `file:line` from the index.

## Route the question FIRST (do this before reaching for `ask`)
| Question shape | Entry point (cheapest) |
|---|---|
| "where is X defined", "who uses/calls X", "find the class/method X" | `thunder.mjs sym def\|refs <Name>` (~30 tok, exact) |
| "architecture", "how is it structured", "which modules", "overview" | `Read project-brief.yaml` — **not `ask`** |
| "which endpoints", "list the routes" | `Read endpoints.yaml` |
| "who handles / where is X processed" (discovery) | `Grep capability-map.yaml` |
| business rule, flow, config value, "what does X do" | `ask --facts "<kw>"` then `ask` |

## Workflow (all inline)

1. **Architecture / overview / "what does the app do" / list all endpoints** → read **one** file:
   `Read .thunder/java/project-brief.yaml` (arch style, modules + roles, all endpoints
   verb+path+controller, key business rules). Answer from it. **Do not also read `index.yaml` or cards.**

2. **A specific feature / where / flow / rule** → **one** command:
   `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ask "<keywords>" "${CLAUDE_PROJECT_DIR}"`
   → ranked top-3 cards; the **#1 hit carries its `business_rules` + `flows`** so it is self-sufficient.
   **Do NOT combine** this with reading `index.yaml` / `capability-map.yaml` / individual `.card.yaml`
   (measured waste). Need more: `--top N`. Need full detail of one context: `ask --detail <id> "$ROOT"`.

3. Manual drill-down (only if you prefer files over `ask`):
   - **Card** — `Read .../modules/<module>/<packages>.card.yaml` (≤20 lines, the `card:` field in the
     module `_index.yaml` points to it). Answer from the card if it suffices.
   - **Detail (only if the card is not enough)** — `Read .../modules/<module>/<packages>.yaml` (the card's
     `detail` field gives the path).

> Example: "endpoints / types / dependencies of module X" → project-brief or `ask`. "exact validation on
> the email field" → `ask` #1 hit rules, or the detail shard. "the body of register()" → 1 seeded agent.

## Inline vs fan-out artifacts
- **Inline** (read directly, no agent): `project-brief.yaml`, `ask` output, `capability-map.yaml` (grep),
  `endpoints.yaml`.
- **Fan-out** (seed a single agent with it): a specific `<ctx>.yaml` detail shard.

## Notes
- `functional_stale: true` or `purpose: null` → suggest `/thunder-java:thunder-java-reindex`.
- For a precise symbol (definition/references): `/thunder-java:thunder-java-sym`.
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
