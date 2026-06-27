---
name: thunder-python-grok
description: Answer a question about what a Python app (FastAPI/Flask/Django) does or how it works, token-minimally, by answering INLINE from thunder-python's index. Use for "how does the auth work", "where is X handled", "what does the catalog package do", "which routes exist", "trace what happens on POST /users", "what's the rule on Z".
allowed-tools: Read, Grep, Bash, Task
---

# grok — answer a question about the Python app, INLINE

## Rule #1 — answer inline, sub-agent budget = 0
**Answer from the index in the main loop. Do NOT spawn ANY sub-agent for a question about structure / where
/ what / which route / which model / which rule.** A sub-agent costs ~**11k tokens fixed**; inline ~**1k**
(≈8× cheaper). A sub-agent is justified only to read a real `.py` body — then 1 agent max, seeded with the
exact `file:line` from the index.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Route the question FIRST (before reaching for `ask`)
| Question shape | Entry point (cheapest) |
|---|---|
| "where is X defined", "who uses/calls X" | `node "$ENG" sym def\|refs <Name> "$ROOT"` (~30 tok, exact) |
| "architecture", "which frameworks", "overview" | `Read project-brief.yaml` — **not `ask`** |
| "which routes / endpoints / URLs" | `Read routes.yaml` |
| "who handles / where is X" (discovery) | `Grep capability-map.yaml` |
| business rule, flow, model, "what does X do" | `ask --facts "<kw>"` then `ask` |

## Procedure (all inline)
1. Overview/archi/routes → `Read project-brief.yaml`. Answer from it.
2. A specific package/where/flow/rule → `node "$ENG" ask "<kw>" "$ROOT"` → top-3 cards, #1 hit enriched with
   `business_rules` + route `flows` → self-sufficient. **Do not combine with `index.yaml`/cards.**
   `ask --facts "<kw>"` for a punctual fact; `ask --detail <id>` for the full shard.
3. Only if a real `.py` body is required: `sym def <Name>` → `file:line`, then **one** `Explore` sub-agent
   seeded with it (~11k — avoid unless necessary).
4. Synthesize with `file:line` citations; separate **exact** (technical) from **inferred** (functional).

## Worked example (no Task)
> Q: "How does creating a user work and what are the rules?"
> `ask "create user" "$ROOT"` → #1 hit returns the Pydantic models, the route `flow`
> (`POST /users → create_user → get_user_service`) and the `business_rules`. Answer directly. **No sub-agent.**

If `purpose: null` / `functional_stale`, suggest `/thunder-python:thunder-python-reindex` first.
