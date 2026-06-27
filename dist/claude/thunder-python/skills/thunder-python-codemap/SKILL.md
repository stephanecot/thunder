---
name: thunder-python-codemap
description: Explore and understand a Python codebase (FastAPI / Flask / Django / plain) token-minimally by answering INLINE from thunder-python's pre-built YAML index (projects, package contexts, routes, models, classes, dependency injection, framework per context, business meaning). Use whenever the user asks how the app is structured, where a class/function lives, what routes/endpoints/models exist, or what a package does — instead of reading .py files.
allowed-tools: Read, Bash, Grep
---

# codemap — understand the Python app, INLINE

thunder-python maintains a YAML index under `<project>/.claude/cache/thunder-python/`. Answer from it **in
the main loop**; never read `.py` while the index answers. It auto-detects the framework per package
(FastAPI/Flask/Django/plain) and unifies routes, models and DI.

## Rule #1 — answer inline, sub-agent budget = 0
**Do NOT spawn ANY sub-agent (Task/Explore) for structure / where / what / which route / which model /
which rule.** A sub-agent costs ~**11k tokens of fixed overhead**; answering inline costs ~**1k** (≈8×
cheaper). Not spawning an agent IS the optimization. A sub-agent is justified only to read a real `.py`
function body — then 1 agent max, seeded with exact `file:line` from the index.

## Route the question FIRST (before reaching for `ask`)
| Question shape | Entry point (cheapest) |
|---|---|
| "where is X defined", "who uses/calls X", "find the class/function X" | `thunder.mjs sym def\|refs <Name>` (~30 tok, exact) |
| "architecture", "which frameworks/projects", "overview" | `Read project-brief.yaml` — **not `ask`** |
| "which routes/endpoints", "list the URLs" | `Read routes.yaml` |
| "who handles / where is X processed" (discovery) | `Grep capability-map.yaml` |
| business rule, flow, model, "what does X do" | `ask --facts "<kw>"` then `ask` |

## Workflow (all inline)
1. **Overview / archi / routes** → `Read project-brief.yaml` (frameworks, projects+roles, all routes, key rules).
2. **A specific package / where / flow / rule** → `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ask "<kw>" "${CLAUDE_PROJECT_DIR}"`
   → ranked top-3 cards; #1 hit carries `business_rules` + route `flows`. **Do not also load `index.yaml` /
   cards.** `--top N` to widen; `ask --detail <id>` for the full shard.
3. Manual drill-down only if preferred: `<package>.card.yaml` (≤20 lines) → `<package>.yaml` (detail) via the card's `detail` field.

## Inline vs fan-out
- Inline: `project-brief.yaml`, `ask` output, `capability-map.yaml` (grep), `routes.yaml`.
- Fan-out (seed one agent): a specific `<package>.yaml` detail shard.
- `functional_stale` / `purpose: null` → suggest `/thunder-python:thunder-python-reindex`.
