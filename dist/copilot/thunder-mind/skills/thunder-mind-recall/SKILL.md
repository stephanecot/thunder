---
name: thunder-mind-recall
description: 'Recall what the project already DECIDED before making a new decision, token-minimally, by answering INLINE from thunder-mind''s shared decision index. Use whenever you''re about to choose an approach, library, pattern, convention, or architecture — "should we…", "how should we…", "what''s our approach to…", "which lib/pattern for…", "did we decide anything about X", "what''s the rule on Y". This keeps two developers'' AIs aligned instead of diverging.'
---

# recall — reuse existing project decisions, INLINE

## Rule #1 — recall BEFORE you decide
Before proposing an architectural / technical / functional / convention choice, **check what the team
already decided**. Two developers share one committed decision index; ignoring it is how their AIs
diverge. This costs ~1 command and keeps everyone consistent.

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${PWD}"
```

## Rule #2 — answer inline, sub-agent budget = 0
Answer from the index in the main loop. A sub-agent costs ~11k tokens of fixed overhead; one `recall`
costs ~0.2k. **Not spawning an agent IS the optimization.**

## Procedure (all inline)
1. **A specific choice / question** → one command:
   `node "$ENG" recall "<keywords>" "$ROOT"` → ranked decision cards. The **#1 hit is fully enriched**
   (context, decision, rationale, consequences, alternatives, evidence), so it's answerable from this
   single payload. Default scope = `active` + `proposed` (superseded/deprecated are hidden).
   - Narrow to a domain: `recall "<kw>" --domain <domain> "$ROOT"`.
   - Include superseded history: `recall "<kw>" --all "$ROOT"`.
   - Force more hits: `recall "<kw>" --top 6 "$ROOT"`.
2. **Overview / "what has this project decided"** → `node "$ENG" brief "$ROOT"` (per-domain counts + the
   structuring active decisions). Or `Grep` `.claude/cache/thunder-mind/domain-map.yaml` (one line per decision).
3. **Full text of one decision** → `node "$ENG" recall --detail <id> "$ROOT"`.

## Then act on it
- **A relevant active decision exists** → follow it. Cite it by `id` (e.g. `auth/2026-06-27-tenant-isolation-rls`).
- **The user wants to do something that contradicts an active decision** → say so explicitly, point at
  the decision, and either align or propose **superseding** it via `/thunder-mind-record`.
- **No decision found and a real decision is being made** → suggest recording it with
  `/thunder-mind-record` so the next developer reuses it.

## Worked example (no Task)
> Q: "How should we isolate tenant data?"
> `recall "tenant isolation multi-tenancy" "$ROOT"` → #1 = `auth/.../tenant-isolation-rls` with the full
> rationale and the superseded app-filter alternative. Answer directly, cite the id. **No sub-agent.**

> If the index is empty or `_FRENCH_/non-English text appears, the index must stay English — suggest a
> re-record. If nothing matches, you get the project brief automatically.

## Tiers — load on demand, never everything
The SessionStart injection is only the **tier-0 constitution** (cross-cutting invariants). For more:
- **Working in a domain?** Read its card: `node "${PLUGIN_ROOT}/engine/thunder.mjs" card <domain> "${PWD}"` (or `Read .claude/cache/thunder-mind/domains/<domain>.card.yaml`).
- **A specific concern?** `recall "<keywords>"` (this skill).
- **Need the exhaustive list?** grep `.claude/cache/thunder-mind/domain-map.yaml` (every decision).

Nothing is dropped: recall + domain-map reach **100%** of decisions regardless of corpus size.
