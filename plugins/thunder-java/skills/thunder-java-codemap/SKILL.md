---
name: thunder-java-codemap
description: Explore and understand a Java/Spring Boot codebase token-minimally via thunder's pre-built YAML index (modules, contexts, endpoints, beans, JPA entities, business meaning). Use whenever the user asks how the app is structured, where something lives, what endpoints/services/entities exist, or what a module does — instead of reading .java files.
allowed-tools: Read, Bash, Grep
---

# codemap — understand the codebase without reading it

thunder maintains a hierarchical YAML index under `<project>/.claude/cache/thunder-java/`. Read the index,
**never the `.java` files**, while the index answers the question. Token cost stays constant regardless of
repo size.

## Golden rule (two-tier index)

> **Card first, detail only when needed.** Each context has a **card** (`<ctx>.card.yaml`, ≤20 lines:
> name, purpose, capabilities, type names, endpoints `verb+path`, #beans/#entities) and a **detail**
> (`<ctx>.yaml`: full signatures, field annotations, cited `business_rules`, intents, use-cases). The
> **card answers ~80% of questions** (structure / where / what / endpoints / flow) at ~10% of the detail's
> tokens. Open the **detail** only for a precise business rule, a full signature or a field annotation;
> open a `.java` only for a method body.

## Workflow

1. **One-payload retrieval (preferred)**:
   `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ask "<keywords from the question>" "${CLAUDE_PROJECT_DIR}"`
   → returns the **cards** of matching contexts + relevant endpoints. One call, no manual grep+drill.
   Enough for most questions.

2. Otherwise, manual drill-down:
   - **Top** — `Read .claude/cache/thunder-java/index.yaml`: modules + counters (~10 lines).
   - **Module** — `Read .../modules/<module>/_index.yaml`: one line per context (with `card:` pointer).
   - **Card** — `Read .../modules/<module>/<packages>.card.yaml` (≤20 lines). **Answer from the card if it
     suffices.**
   - **Detail (only if the card is not enough)** — `Read .../modules/<module>/<packages>.yaml` (the card's
     `detail` field gives the path).

> Example: "which endpoints / types / dependencies of module X" → card. "the exact validation on the email
> field" → detail. "the body of the register method" → the `.java`.

## Direct views

- All endpoints: `Read .claude/cache/thunder-java/endpoints.yaml` (or `thunder.mjs endpoints <root>`).
- Discovery "who handles X?": `Grep` `capability-map.yaml` (flat, greppable) — do not load it whole.
- Counters: `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" overview "${CLAUDE_PROJECT_DIR}"`

## Notes

- A `functional_stale: true` field in a shard means the inferred meaning may be outdated →
  suggest `/thunder-java:thunder-java-reindex`.
- If `purpose` is `null`, the functional layer has not been inferred yet → `/thunder-java:thunder-java-reindex`.
- For a precise symbol (definition/references), prefer `/thunder-java:thunder-java-sym`.
