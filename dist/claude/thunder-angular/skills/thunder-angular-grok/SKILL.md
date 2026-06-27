---
name: thunder-angular-grok
description: Answer a question about what an Angular app does or how it works (user-facing or technical), token-minimally, by answering INLINE from thunder-angular's index. Use for "how does the X screen work", "where is feature Y handled", "what does the orders feature do", "which routes exist", "trace what happens on /users".
allowed-tools: Read, Grep, Bash, Task
---

# grok — answer a question about the Angular app, INLINE

## Rule #1 — answer inline, sub-agent budget = 0
**Answer from the index in the main loop. Do NOT spawn ANY sub-agent (Task/Explore) for a question about
structure / where / what / which route / which flow / which rule.** Those are answered by reading one or
two small index files here, in the main loop.

> Why: a sub-agent costs ~**11k tokens of fixed overhead**, whatever it reads. Answering inline costs
> ~**1k** (≈8× cheaper). Not spawning an agent IS the optimization. A sub-agent is justified only to read a
> real `.ts` **method body / template** the index can't give you — then **1 agent max**, seeded with the
> exact `file:line` from the index.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Route the question FIRST (before reaching for `ask`)
| Question shape | Entry point (cheapest) |
|---|---|
| "where is X defined", "who uses/injects X", "find the component/service X" | `node "$ENG" sym def\|refs <Name> "$ROOT"` (~30 tok, exact) |
| "architecture", "how is it structured", "which projects/features", "overview" | `Read project-brief.yaml` — **not `ask`** |
| "which routes", "list the screens" | `Read routes.yaml` |
| "who handles / where is X" (discovery) | `Grep capability-map.yaml` |
| business rule, flow, "what does X do" | `ask --facts "<kw>"` then `ask` |

(If `ask` matches nothing, it now returns the project brief automatically.)

## Procedure (all inline)

1. **Architecture / overview / "what does the app do" / list routes** → read **one** file:
   `Read .claude/cache/thunder-angular/project-brief.yaml` (arch style, projects + roles, all routes, key
   rules). Answer from it. **Do not also read `index.yaml` or cards.**

2. **A specific feature / where / flow / rule** → **one** command:
   `node "$ENG" ask "<keywords>" "$ROOT"` → ranked top-3 feature cards; the **#1 hit is enriched with its
   `business_rules` and route `flows`**, so it is answerable from this single payload. **Do NOT also load
   `index.yaml`, `capability-map.yaml`, or individual `.card.yaml` files.**
   - More hits: `ask "<kw>" --top 6 "$ROOT"`. Full detail of one context: `ask --detail <id> "$ROOT"`.

3. **Only if a real `.ts` body/template is required**: `sym def <Name>` for `file:line`, then **at most one**
   `Explore` sub-agent seeded with it. Still ~11k — avoid unless truly necessary.

4. **Synthesize** with `file:line` citations. Separate **exact** (technical) from **inferred** (functional).

## Worked example (no Task)
> Q: "What does the users feature do and how does opening /users work?"
> `ask "users" "$ROOT"` → #1 hit returns the components (UserListComponent), the injected UserService, and
> the route `flows` (`route 'users' → UserListComponent → UserService`). Answer directly. **No sub-agent.**

## Inline vs fan-out
- Inline (read directly): `project-brief.yaml`, `ask` output, `capability-map.yaml` (grep), `routes.yaml`.
- Fan-out (seed one agent): a specific `<feature>.yaml` detail shard.
- If `purpose: null` / `functional_stale`, suggest `/thunder-angular:thunder-angular-reindex` first.
