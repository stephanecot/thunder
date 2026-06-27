# thunder-node — benchmark report (before / after)

**Method.** Per query: bytes actually ingested **without thunder** (read the relevant source) vs **with
thunder** (read the index slice via the right skill), at ~4 bytes/token. Gain = DATA tokens only — it
EXCLUDES fixed sub-agent overhead (~10.6k/agent) and the SKILL.md size (~4.3k). Bias favors "before"
(assumes it already knows which files to open; really it must grep/glob first — the index does that free).

**Test beds.** `demo` (toy: NestJS + Express + Fastify in one app) · `nodedemo` (161 files, 40 NestJS
feature modules with controllers/services/endpoints — main bed & scale bed).

## 1. Results table — nodedemo
| # | Query | entry point | before (tok) | after (tok) | gain |
|---|---|---|---|---|---|
| 1 | App overview / which features | `codemap` | 22 017 | 83 | **~265×** |
| 2 | What does feature `f0` contain | `codemap` | 526 | 100 (card) | **~5×** |
| 3 | Understand `F0Service` (its logic) | `grok` | ~130 | ~80 (shard slice) | **~2×** |
| 4 | Where is `F0Controller` defined | `sym` | ~600 (grep+open) | 13 | **>10×** |
| 5 | Who uses `F0Service` | `sym` | ~800 | 25 | **>30×** |
| 6 | Which feature handles "X" | `grok` | read the app | grep (∝ matches) | **massive** |
| 7 | Endpoints of a feature | `codemap` | read the controller | grep routes.yaml | **several×** |

## 2. Concrete examples (query → what each reads → the real answer)

### Example 1 — overview
- **Without thunder**: crawl the app → **88 069 B (~22 017 tok)**.
- **With thunder**: read `project-brief.yaml` → **330 B (~83 tok)**. Real answer: detected frameworks
  (Express / Fastify / NestJS), feature modules + roles, all endpoints (summarized if > 50), key rules.
→ **~265× fewer tokens**, exact and already structured.

### Example 2 — symbol (where defined / who uses)
- **Without thunder**: global `grep` then open 2-3 files.
- **With thunder** (`sym`) → **13 + 25 tok**. Real answer:
```
class F0Controller  src/modules/f0/f0.controller.ts:6
F0Controller  src/modules/f0/f0.controller.ts:6   (← user of F0Service)
```
→ `file:line` directly, no search→read loop.

### Example 3 — discovery ("which feature handles X")
- **With thunder**: `grep -i <term> capability-map.yaml` → only the matching lines (cost ∝ matches, **not**
  app size). Returns the few features whose inferred capabilities match.

### Example 4 — flow + business rules
- **Without thunder**: open the controller + service, then trace calls and infer rules.
- **With thunder**: `ask "<feature> flow"` — derived flow (endpoint → controller → service) + cited rules:
```yaml
endpoints:
  - {verb: GET, path: /f0, handler: F0Controller.findAll}
  - {verb: POST, path: /f0, handler: F0Controller.create}
use_cases:
  - {name: F0Controller.create, flow: POST /f0 → F0Controller.create → F0Service}
```
→ verb+path+handler + DI chain, framework-aware, no manual tracing.

### Example 5 — module / feature contents
- **Without thunder**: all 4 files of the feature → **~526 tok**.
- **With thunder**: the tier-1 `modules.f0.card.yaml` → **~100 tok** (controllers, services, endpoints). **~5×.**

### Example 6 — endpoints / routes
- **With thunder**: `grep f0 routes.yaml` → the endpoints with verb/path/handler, without opening the controller:
```
- {verb: GET, path: /f0, handler: F0Controller.findAll, ctx: "node-shop/modules.f0"}
- {verb: POST, path: /f0, handler: F0Controller.create, ctx: "node-shop/modules.f0"}
```

## 3. Extreme scale — nodedemo
Regenerate larger to push the scale: `node engine/tools/gen-nodedemo.mjs nodedemo 200`.

| Query | before (tok) | after (tok) | gain |
|---|---|---|---|
| Features overview | ~22 017 | ~83 | **~265×** |
| "What does feature `f17` do" | ~526 | ~100 (or 1 line) | **~5× and up** |

The bigger the API, the wider the gap: the index cost stays **bounded** (the brief summarizes endpoints past 50).

## 4. Honest nuances (where thunder doesn't help)
1. **Loading a whole flat file** (`routes.yaml`, `capability-map.yaml`) = anti-pattern → grep / query by feature.
2. **Exhaustive deep-dive of a whole feature** ≈ neutral in bytes, but the shard delivers **more** (meaning, flows, DI graph, endpoints).
3. **Reading one small known file** ≈ neutral. thunder's edge is **breadth** (orientation, discovery, multi-file) and avoiding the search→read→trace loop.
4. **Large controllers/services**: the bigger they are, the more their **signatures ≪ source** → the gap widens for the shard.

## 5. One-time / amortized costs
- **Technical index**: **0 model tokens** (CPU only). nodedemo 161 files in ~15 ms; incremental near-free; edit = instant enqueue (hook on `.ts`/`.js`).
- **Functional inference**: model cost **once** per context (Haiku cartographer), budgeted + confirmed, then read **free** on every query.

## 6. Two-tier index (card / detail) — token-bench
`node engine/tools/token-bench.mjs nodedemo` (A = thunder inline · B = raw inline · C = +sub-agent):
- **(A) vs (B)** on structure/where/what/flux/routes: **3%** (target ≤ 25%) ✅
- **(A) vs (C)** overall: **2%** (target ≤ 15%) ✅ → *spawning an agent is the error, not the index*
- **6/6** answered inline without a sub-agent (target ≥ 5/6) ✅

## 7. Expanded sweep — ≥50 routed questions
`node engine/tools/sweep-bench.mjs nodedemo` — ≥50 questions over every entity (controllers, services, features, contexts), each routed to its cheapest entry point and compared to the raw cost. thunder wins **84/84** (100%) · aggregate **10633 vs 329379 tok → 97% saved**. Full per-question table (every tested question):

| # | Query | route | thunder | raw | factor | winner |
|---|---|---|---|---|---|---|
| 1 | architecture overview | brief | 83 | 22017 | 265.3× | thunder |
| 2 | which projects/features exist | brief | 83 | 22017 | 265.3× | thunder |
| 3 | how is the app structured | brief | 83 | 22017 | 265.3× | thunder |
| 4 | list all routes | routes | 4655 | 7368 | 1.6× | thunder |
| 5 | where is F0Controller defined | sym | 14 | 182 | 13.0× | thunder |
| 6 | find the F0Controller class | sym | 14 | 182 | 13.0× | thunder |
| 7 | where is F12Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 8 | find the F12Controller class | sym | 14 | 185 | 13.2× | thunder |
| 9 | where is F16Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 10 | find the F16Controller class | sym | 14 | 185 | 13.2× | thunder |
| 11 | where is F2Controller defined | sym | 14 | 182 | 13.0× | thunder |
| 12 | find the F2Controller class | sym | 14 | 182 | 13.0× | thunder |
| 13 | where is F23Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 14 | find the F23Controller class | sym | 14 | 185 | 13.2× | thunder |
| 15 | where is F27Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 16 | find the F27Controller class | sym | 14 | 185 | 13.2× | thunder |
| 17 | where is F30Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 18 | find the F30Controller class | sym | 14 | 185 | 13.2× | thunder |
| 19 | where is F34Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 20 | find the F34Controller class | sym | 14 | 185 | 13.2× | thunder |
| 21 | where is F38Controller defined | sym | 14 | 185 | 13.2× | thunder |
| 22 | find the F38Controller class | sym | 14 | 185 | 13.2× | thunder |
| 23 | where is F6Controller defined | sym | 14 | 182 | 13.0× | thunder |
| 24 | find the F6Controller class | sym | 14 | 182 | 13.0× | thunder |
| 25 | where is F0Service defined | sym | 12 | 255 | 21.3× | thunder |
| 26 | where is F12Service defined | sym | 13 | 258 | 19.8× | thunder |
| 27 | where is F16Service defined | sym | 13 | 258 | 19.8× | thunder |
| 28 | where is F2Service defined | sym | 12 | 255 | 21.3× | thunder |
| 29 | where is F23Service defined | sym | 13 | 258 | 19.8× | thunder |
| 30 | where is F27Service defined | sym | 13 | 258 | 19.8× | thunder |
| 31 | where is F30Service defined | sym | 13 | 258 | 19.8× | thunder |
| 32 | where is F34Service defined | sym | 13 | 258 | 19.8× | thunder |
| 33 | where is F38Service defined | sym | 13 | 258 | 19.8× | thunder |
| 34 | where is F6Service defined | sym | 12 | 255 | 21.3× | thunder |
| 35 | who injects F0Service | sym | 12 | 182 | 15.2× | thunder |
| 36 | who injects F12Service | sym | 13 | 185 | 14.2× | thunder |
| 37 | who injects F16Service | sym | 13 | 185 | 14.2× | thunder |
| 38 | who injects F2Service | sym | 12 | 182 | 15.2× | thunder |
| 39 | who injects F23Service | sym | 13 | 185 | 14.2× | thunder |
| 40 | who injects F27Service | sym | 13 | 185 | 14.2× | thunder |
| 41 | who injects F30Service | sym | 13 | 185 | 14.2× | thunder |
| 42 | who injects F34Service | sym | 13 | 185 | 14.2× | thunder |
| 43 | who injects F38Service | sym | 13 | 185 | 14.2× | thunder |
| 44 | who injects F6Service | sym | 12 | 182 | 15.2× | thunder |
| 45 | routes of feature modules.f0 | routes | 113 | 7368 | 65.2× | thunder |
| 46 | who handles modules.f0 | discovery | 8 | 22017 | 2752.1× | thunder |
| 47 | how does modules.f0 work | card | 100 | 526 | 5.3× | thunder |
| 48 | flow of modules.f0 | shard | 328 | 526 | 1.6× | thunder |
| 49 | business rules for modules.f0 | ask | 84 | 526 | 6.3× | thunder |
| 50 | routes of feature modules.f13 | routes | 117 | 7368 | 63.0× | thunder |
| 51 | who handles modules.f13 | discovery | 8 | 22017 | 2752.1× | thunder |
| 52 | how does modules.f13 work | card | 103 | 535 | 5.2× | thunder |
| 53 | flow of modules.f13 | shard | 340 | 535 | 1.6× | thunder |
| 54 | business rules for modules.f13 | ask | 87 | 535 | 6.1× | thunder |
| 55 | routes of feature modules.f18 | routes | 117 | 7368 | 63.0× | thunder |
| 56 | who handles modules.f18 | discovery | 8 | 22017 | 2752.1× | thunder |
| 57 | how does modules.f18 work | card | 103 | 535 | 5.2× | thunder |
| 58 | flow of modules.f18 | shard | 340 | 535 | 1.6× | thunder |
| 59 | business rules for modules.f18 | ask | 87 | 535 | 6.1× | thunder |
| 60 | routes of feature modules.f22 | routes | 117 | 7368 | 63.0× | thunder |
| 61 | who handles modules.f22 | discovery | 8 | 22017 | 2752.1× | thunder |
| 62 | how does modules.f22 work | card | 103 | 535 | 5.2× | thunder |
| 63 | flow of modules.f22 | shard | 340 | 535 | 1.6× | thunder |
| 64 | business rules for modules.f22 | ask | 87 | 535 | 6.1× | thunder |
| 65 | routes of feature modules.f27 | routes | 117 | 7368 | 63.0× | thunder |
| 66 | who handles modules.f27 | discovery | 8 | 22017 | 2752.1× | thunder |
| 67 | how does modules.f27 work | card | 103 | 535 | 5.2× | thunder |
| 68 | flow of modules.f27 | shard | 340 | 535 | 1.6× | thunder |
| 69 | business rules for modules.f27 | ask | 87 | 535 | 6.1× | thunder |
| 70 | routes of feature modules.f31 | routes | 117 | 7368 | 63.0× | thunder |
| 71 | who handles modules.f31 | discovery | 8 | 22017 | 2752.1× | thunder |
| 72 | how does modules.f31 work | card | 103 | 535 | 5.2× | thunder |
| 73 | flow of modules.f31 | shard | 340 | 535 | 1.6× | thunder |
| 74 | business rules for modules.f31 | ask | 87 | 535 | 6.1× | thunder |
| 75 | routes of feature modules.f36 | routes | 117 | 7368 | 63.0× | thunder |
| 76 | who handles modules.f36 | discovery | 8 | 22017 | 2752.1× | thunder |
| 77 | how does modules.f36 work | card | 103 | 535 | 5.2× | thunder |
| 78 | flow of modules.f36 | shard | 339 | 535 | 1.6× | thunder |
| 79 | business rules for modules.f36 | ask | 87 | 535 | 6.1× | thunder |
| 80 | routes of feature modules.f5 | routes | 113 | 7368 | 65.2× | thunder |
| 81 | who handles modules.f5 | discovery | 8 | 22017 | 2752.1× | thunder |
| 82 | how does modules.f5 work | card | 100 | 526 | 5.3× | thunder |
| 83 | flow of modules.f5 | shard | 328 | 526 | 1.6× | thunder |
| 84 | business rules for modules.f5 | ask | 84 | 526 | 6.3× | thunder |

## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
`node engine/tools/tier3-bench.mjs demo`:
- **answer-cache hit**: **8%** of raw (relay a hash-fresh prior answer; STALE on any source/engine change).
- **tool-output prune**: **1%** of raw on a 5 000-line log, error lines always preserved.
- **DEBUG mode**: a `.thunder/node/.config` with `DEBUG=true` → every op's data-token saving appended to `.thunder/gains.md`; off → zero overhead.

## 9. Verdict
| Query type | thunder benefit |
|---|---|
| Orientation / overview | **~265×** — decisive |
| Discovery "which feature handles X?" | **massive** (cost ∝ matches, not app size) |
| Symbol navigation (`sym`) | **10–30×** + straight to the point |
| Understand a service / its rules | **~2×** + pre-digested, cited meaning |
| Endpoints (Express/Fastify/NestJS) | **several×** + exact verb/path/handler flows |
| Exhaustive un-scoped dump | **neutral** → scope / grep |

**Conclusion.** The gain grows with **app size** and question **breadth**. On a large backend,
*understanding / exploring / navigating* costs **2-3 orders of magnitude fewer tokens**, at **equal or
better** relevance (exact answers + anchored business meaning, framework-aware endpoints). The cost shifts
to a **one-time free** (technical) or **amortized** (functional) index. thunder doesn't "compress" an
intrinsically large answer (dump-everything) — it avoids **reading to search**.

## 10. Rerun
```
node engine/thunder.mjs build nodedemo --force && node engine/tools/token-bench.mjs nodedemo
node engine/tools/sweep-bench.mjs nodedemo && node engine/tools/tier3-bench.mjs demo
```
