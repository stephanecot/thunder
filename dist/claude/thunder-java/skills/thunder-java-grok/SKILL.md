---
name: thunder-java-grok
description: Answer a question about what a Java/Spring codebase does or how it works (business or technical), token-minimally, by answering INLINE from thunder's index. Use for "how does the auth work", "where is X handled", "what does the billing module do", "which endpoints exist", "trace the flow of Y", "what's the rule on Z".
allowed-tools: Read, Grep, Bash, Task
---

# grok — answer a question about the codebase, INLINE

## Rule #1 — answer inline, sub-agent budget = 0
**Answer from the index in the main loop. Do NOT spawn ANY sub-agent (Task/Explore) for a question about
structure / where / what / which endpoint / which flow / which business rule.** Those are answered by
reading one or two small index files here, in the main loop.

> Why: a sub-agent costs ~**11k tokens of fixed overhead**, whatever it reads. Answering inline from the
> index costs ~**1k**. For token cost, inline wins ~8×. The index format barely matters next to this —
> **not spawning an agent is the optimization.** Default = inline.

A sub-agent (Task/Explore) is allowed **only** to read a real `.java` **method body** the index can't give
you, and then: **1 agent max**, seeded with the exact `file:line` taken from the index (never "go explore").

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Route the question FIRST (do this before reaching for `ask`)
`ask` is not the cheapest tool for everything. Pick the entry point by the question's shape:

| Question shape | Entry point (cheapest) |
|---|---|
| "where is X defined", "who uses/calls X", "find the class/method X" | `node "$ENG" sym def\|refs <Name> "$ROOT"` (~30 tok, exact) |
| "architecture", "how is it structured", "which modules", "overview" | `Read project-brief.yaml` (direct) — **not `ask`** |
| "which endpoints", "list the routes" | `Read endpoints.yaml` |
| "who handles / where is X processed" (discovery) | `Grep capability-map.yaml` |
| business rule, flow, config value, "what does X do" | `ask --facts "<kw>"` then `ask` if needed |

Only fall to `ask` for the last row. (If `ask` matches nothing, it now returns the project brief
automatically.)

## Procedure (all inline)

1. **Architecture / overview / "what does the app do" / list endpoints** → read **one** file:
   `Read .claude/cache/thunder-java/project-brief.yaml` (arch style, modules + roles, all endpoints, key
   rules). Answer from it. **Do not also read `index.yaml` or cards.**

2. **A specific feature / where / flow / rule** → **one** command:
   `node "$ENG" ask "<keywords from the question>" "$ROOT"`
   It returns the ranked top-3 context cards; the **#1 hit is enriched with its `business_rules` and
   `flows`**, so the question is answerable **from this single payload**. **Do NOT also load `index.yaml`,
   `capability-map.yaml`, or individual `.card.yaml` files** — that combo is pure waste.
   - Need more hits: `ask "<kw>" --top 6 "$ROOT"`.
   - Punctual factual question (a rule, an endpoint signature): `ask --facts "<kw>" "$ROOT"` → lean payload
     (only `business_rules` + endpoint signatures, no purpose/capabilities/types).
   - Need the full detail of one context (precise signatures, field annotations, all use-cases):
     `node "$ENG" ask --detail <id> "$ROOT"` (one call, prints the detail shard).

3. **Only if a real method body is required** (precise runtime logic not in the index): `sym def <Name>` to
   get `file:line`, then **at most one** `Explore` sub-agent seeded with that `file:line`. This is the only
   case where spawning is justified — and it still costs ~11k, so avoid it unless truly necessary.

4. **Synthesize** with `file:line` citations. Separate **exact** (technical, from the index) from
   **inferred** (functional layer).

## Worked example (no Task, ~1 payload)

> Q: "How is a user registered and what are the rules?"
> `ask "register user" "$ROOT"` → #1 hit `user/com.demo.user` returns purpose, capabilities, the
> `business_rules` (email unique, @Min(18)…, with `src` citations) and the `flows`
> (`POST /users → UserController.create → UserService → UserRepository`). Answer directly, cite the `src`.
> **No sub-agent, no extra Read.**

## Guards
- Inline is the default. Reach for a sub-agent only for a method body, 1 max, seeded by `file:line`.
- Inline artifacts (read directly): `project-brief.yaml`, `ask` output, `capability-map.yaml` (grep),
  `endpoints.yaml`. Fan-out artifacts (seed a single agent): a specific `.yaml` detail shard.
- If `purpose: null` / `functional_stale`, suggest `/thunder-java:thunder-java-reindex` first.
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
