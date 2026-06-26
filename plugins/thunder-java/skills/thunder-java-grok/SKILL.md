---
name: thunder-java-grok
description: Answer a question about what a Java/Spring codebase does or how it works (business or technical), token-minimally, using thunder's index and bounded fan-out. Use for "how does the auth work", "where is X handled", "what does the billing module do", "trace the flow of Y". Seeds sub-agents with index slices so they don't re-explore from scratch.
allowed-tools: Read, Grep, Bash, Task
---

# grok — answer a question about the codebase

Goal: answer **correctly** with the **fewest tokens**. Start from the index (compact, already built), read
source only when needed, and delegate broad exploration to sub-agents **seeded** with the relevant index
slice (so they don't re-explore from scratch).

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Procedure

1. **Deterministic one-payload retrieval (default step)**:
   `node "$ENG" ask "<keywords from the question>" "$ROOT"` → returns the **cards** of matching contexts
   (name, purpose, capabilities, types, endpoints) + relevant endpoints. **One call.** For a structure /
   where / what / endpoint / flow question, **this is enough — answer from it.**
   (Manual alternative: `Grep` `capability-map.yaml`, then `Read` the targeted `<ctx>.card.yaml`.)

2. **Detail only if the card is not enough** (precise business rule, exact validation, full signature,
   field annotation): `Read .../modules/<m>/<pkg>.yaml` (path is in the card's `detail` field). Open **one**
   detail shard at a time, only for the relevant context.

3. **Only if real code is needed** (a method body, precise logic):
   - Delegate to `Explore` sub-agents (Task), **capped ~3-4 in parallel**, each given the relevant shard +
     exact `file:line` to inspect. They return a short conclusion, not dumps. Their context is discarded →
     the main context stays clean.
   - To locate a symbol before delegating: `node "$ENG" sym def <Name> "$ROOT"`.

4. **Synthesize**: answer with `file:line` citations. Separate what is **exact** (technical, from the index)
   from what is **inferred** (functional layer, marked inferred).

## Token guards

- Never read a whole module of `.java`. Always prefer card → detail → targeted fan-out.
- Fan-out spends tokens in sub-agents: cap it, and only when the index is insufficient. A pure structure
  question is answered by the index alone.
- If the functional layer is missing (`purpose: null`) or `functional_stale`, suggest
  `/thunder-java:thunder-java-reindex` before answering a clearly business-level question.
