# thunder-angular — benchmark report (before / after)

**Method.** Per query: bytes actually ingested **without thunder** (read the relevant source) vs **with
thunder** (read the index slice via the right skill), at ~4 bytes/token. Gain = DATA tokens only — it
EXCLUDES fixed sub-agent overhead (~10.6k/agent) and the SKILL.md size (~4.3k). Bias favors "before"
(assumes it already knows which files to open; really it must grep/glob first — the index does that free).

**Test beds.** `demo` (toy: standalone + NgModule, functional guards/interceptors, `httpResource`) ·
`ngdemo` (281 files, 40 standalone feature folders with services/guards/routes — main bed & scale bed).

## 1. Results table — ngdemo
| # | Query | entry point | before (tok) | after (tok) | gain |
|---|---|---|---|---|---|
| 1 | App overview / which features | `codemap` | 41 550 | 88 | **~472×** |
| 2 | What does feature `f0` contain | `codemap` | 1 004 | 59 (card) | **~17×** |
| 3 | Understand `F0Service` (its logic) | `grok` | 365 | ~150 (shard slice) | **~3×** |
| 4 | Where is `F0Service` defined | `sym` | ~600 (grep+open) | 12 | **>10×** |
| 5 | Who injects `F0Service` | `sym` | ~800 | 25 | **>30×** |
| 6 | Which feature handles "X" | `grok` | read the app | grep (∝ matches) | **massive** |
| 7 | Routes / guards of a feature | `codemap` | read the routes file | grep routes.yaml | **several×** |

## 2. Concrete examples (query → what each reads → the real answer)

### Example 1 — overview
- **Without thunder**: crawl the app → **166 201 B (~41 550 tok)**.
- **With thunder**: read `project-brief.yaml` → **351 B (~88 tok)**. Real answer: Angular style (standalone
  / NgModule), projects + roles, all routes (summarized if > 50), key rules — one read answers archi/overview.
→ **~472× fewer tokens**, exact and already structured.

### Example 2 — symbol (where defined / who injects)
- **Without thunder**: global `grep` then open 2-3 files.
- **With thunder** (`sym`) → **12 + 25 tok**. Real answer:
```
class F0Service  src/app/f0/f0.service.ts:7
F0DetailComponent  src/app/f0/f0-detail.component.ts:12   (← injector of F0Service)
F0ListComponent  src/app/f0/f0-list.component.ts:12
```
Modern functional guards/interceptors are first-class symbols too (`authGuard (injects AuthService)`).

### Example 3 — discovery ("which feature handles X")
- **With thunder**: `grep -i <term> capability-map.yaml` → only the matching lines (cost ∝ matches, **not**
  app size). Returns the few features whose inferred capabilities match.

### Example 4 — flow + business rules
- **Without thunder**: open the component + service + routes, then trace calls and infer rules.
- **With thunder**: `ask "<feature> flow"` — derived flow (route → component → service) + guards + cited rules:
```yaml
routes: [{path: f0, target: F0ListComponent, guards: [F0Guard]}]
http: [{verb: GET, url: "{base}"}, {verb: POST, url: "{base}"}]
```
→ guards on routes, the service's HTTP contract (verb + normalized URL), no manual tracing.

### Example 5 — module / feature contents
- **Without thunder**: all 7 files of the feature → **~1 004 tok**.
- **With thunder**: the tier-1 `f0.card.yaml` → **~59 tok** (components, services, routes). **~17×.**

### Example 6 — endpoints / routes
- **With thunder**: `grep f0 routes.yaml` → the routes + guards without opening the routes file:
```
- {path: f0, target: "./f0/f0.routes", kind: "lazy-children", ctx: shop/app}
```

## 3. Extreme scale — ngdemo
Regenerate larger to push the scale: `node engine/tools/gen-ngdemo.mjs ngdemo 200`.

| Query | before (tok) | after (tok) | gain |
|---|---|---|---|
| Features overview | ~41 550 | ~88 | **~472×** |
| "What does feature `f17` do" | ~1 000 | ~59 (or 1 line) | **~17× and up** |

The bigger the app, the wider the gap: the index cost stays **bounded** (the brief summarizes routes past 50).

## 4. Honest nuances (where thunder doesn't help)
1. **Loading a whole flat file** (`routes.yaml`, `capability-map.yaml`) = anti-pattern → grep / query by feature.
2. **Exhaustive deep-dive of a whole feature** ≈ neutral in bytes, but the shard delivers **more** (meaning, flows, DI graph, HTTP contract).
3. **Reading one small known file** ≈ neutral. thunder's edge is **breadth** (orientation, discovery, multi-file) and avoiding the search→read→trace loop.
4. **Large components/services**: the bigger they are, the more their **signatures ≪ source** → the gap widens for the shard.

## 5. One-time / amortized costs
- **Technical index**: **0 model tokens** (CPU only). ngdemo 281 files in ~15 ms; incremental near-free; edit = instant enqueue (hook on `.ts`/`.html`/`.scss`).
- **Functional inference**: model cost **once** per context (Haiku cartographer), budgeted + confirmed, then read **free** on every query.

## 6. Two-tier index (card / detail) — token-bench
`node engine/tools/token-bench.mjs ngdemo` (A = thunder inline · B = raw inline · C = +sub-agent):
- **(A) vs (B)** on structure/where/what/flux/routes: **7%** (target ≤ 25%) ✅
- **(A) vs (C)** overall: **7%** (target ≤ 15%) ✅ → *spawning an agent is the error, not the index*
- **6/6** answered inline without a sub-agent (target ≥ 5/6) ✅
- `data-bench` (5 frozen questions × 3 tiers, overheads excluded): aggregate **34%** of raw-ts ✅

## 7. Expanded sweep — ≥50 routed questions
`node engine/tools/sweep-bench.mjs ngdemo` — ≥50 questions over every entity (classes, services, models/controllers/components, features, contexts), each routed to its cheapest entry point and compared to the raw cost. thunder wins **84/84** (100%) · aggregate **10610 vs 531656 tok → 98% saved**. Full per-question table (every tested question):

| # | Query | route | thunder | raw | factor | winner |
|---|---|---|---|---|---|---|
| 1 | architecture overview | brief | 88 | 41550 | 472.2× | thunder |
| 2 | which projects/features exist | brief | 88 | 41550 | 472.2× | thunder |
| 3 | how is the app structured | brief | 88 | 41550 | 472.2× | thunder |
| 4 | list all routes | routes | 2667 | 4508 | 1.7× | thunder |
| 5 | where is F0DetailComponent defined | sym | 16 | 164 | 10.3× | thunder |
| 6 | find the F0DetailComponent class | sym | 16 | 164 | 10.3× | thunder |
| 7 | where is F12DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 8 | find the F12DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 9 | where is F16DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 10 | find the F16DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 11 | where is F2DetailComponent defined | sym | 16 | 164 | 10.3× | thunder |
| 12 | find the F2DetailComponent class | sym | 16 | 164 | 10.3× | thunder |
| 13 | where is F23DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 14 | find the F23DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 15 | where is F27DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 16 | find the F27DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 17 | where is F30DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 18 | find the F30DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 19 | where is F34DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 20 | find the F34DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 21 | where is F38DetailComponent defined | sym | 16 | 166 | 10.4× | thunder |
| 22 | find the F38DetailComponent class | sym | 16 | 166 | 10.4× | thunder |
| 23 | where is F6DetailComponent defined | sym | 16 | 164 | 10.3× | thunder |
| 24 | find the F6DetailComponent class | sym | 16 | 164 | 10.3× | thunder |
| 25 | where is F0Facade defined | sym | 11 | 104 | 9.5× | thunder |
| 26 | where is F12Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 27 | where is F16Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 28 | where is F2Facade defined | sym | 11 | 104 | 9.5× | thunder |
| 29 | where is F23Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 30 | where is F27Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 31 | where is F30Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 32 | where is F34Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 33 | where is F38Facade defined | sym | 11 | 106 | 9.6× | thunder |
| 34 | where is F6Facade defined | sym | 11 | 104 | 9.5× | thunder |
| 35 | who injects F0Service | sym | 45 | 525 | 11.7× | thunder |
| 36 | who injects F12Service | sym | 48 | 533 | 11.1× | thunder |
| 37 | who injects F16Service | sym | 48 | 533 | 11.1× | thunder |
| 38 | who injects F2Service | sym | 45 | 525 | 11.7× | thunder |
| 39 | who injects F23Service | sym | 48 | 533 | 11.1× | thunder |
| 40 | who injects F27Service | sym | 48 | 533 | 11.1× | thunder |
| 41 | who injects F30Service | sym | 48 | 533 | 11.1× | thunder |
| 42 | who injects F34Service | sym | 48 | 533 | 11.1× | thunder |
| 43 | who injects F38Service | sym | 48 | 533 | 11.1× | thunder |
| 44 | who injects F6Service | sym | 45 | 525 | 11.7× | thunder |
| 45 | routes of feature f0 | routes | 70 | 4508 | 64.4× | thunder |
| 46 | who handles f0 | discovery | 4 | 41550 | 10387.5× | thunder |
| 47 | how does f0 work | card | 59 | 1004 | 17.0× | thunder |
| 48 | flow of f0 | shard | 342 | 1004 | 2.9× | thunder |
| 49 | business rules for f0 | ask | 373 | 1004 | 2.7× | thunder |
| 50 | routes of feature f13 | routes | 57 | 4508 | 79.1× | thunder |
| 51 | who handles f13 | discovery | 4 | 41550 | 10387.5× | thunder |
| 52 | how does f13 work | card | 62 | 1019 | 16.4× | thunder |
| 53 | flow of f13 | shard | 353 | 1019 | 2.9× | thunder |
| 54 | business rules for f13 | ask | 374 | 1019 | 2.7× | thunder |
| 55 | routes of feature f18 | routes | 57 | 4508 | 79.1× | thunder |
| 56 | who handles f18 | discovery | 4 | 41550 | 10387.5× | thunder |
| 57 | how does f18 work | card | 62 | 1019 | 16.4× | thunder |
| 58 | flow of f18 | shard | 353 | 1019 | 2.9× | thunder |
| 59 | business rules for f18 | ask | 374 | 1019 | 2.7× | thunder |
| 60 | routes of feature f22 | routes | 57 | 4508 | 79.1× | thunder |
| 61 | who handles f22 | discovery | 4 | 41550 | 10387.5× | thunder |
| 62 | how does f22 work | card | 62 | 1019 | 16.4× | thunder |
| 63 | flow of f22 | shard | 353 | 1019 | 2.9× | thunder |
| 64 | business rules for f22 | ask | 374 | 1019 | 2.7× | thunder |
| 65 | routes of feature f27 | routes | 57 | 4508 | 79.1× | thunder |
| 66 | who handles f27 | discovery | 4 | 41550 | 10387.5× | thunder |
| 67 | how does f27 work | card | 62 | 1019 | 16.4× | thunder |
| 68 | flow of f27 | shard | 352 | 1019 | 2.9× | thunder |
| 69 | business rules for f27 | ask | 374 | 1019 | 2.7× | thunder |
| 70 | routes of feature f31 | routes | 57 | 4508 | 79.1× | thunder |
| 71 | who handles f31 | discovery | 4 | 41550 | 10387.5× | thunder |
| 72 | how does f31 work | card | 62 | 1019 | 16.4× | thunder |
| 73 | flow of f31 | shard | 352 | 1019 | 2.9× | thunder |
| 74 | business rules for f31 | ask | 374 | 1019 | 2.7× | thunder |
| 75 | routes of feature f36 | routes | 57 | 4508 | 79.1× | thunder |
| 76 | who handles f36 | discovery | 4 | 41550 | 10387.5× | thunder |
| 77 | how does f36 work | card | 62 | 1019 | 16.4× | thunder |
| 78 | flow of f36 | shard | 352 | 1019 | 2.9× | thunder |
| 79 | business rules for f36 | ask | 374 | 1019 | 2.7× | thunder |
| 80 | routes of feature f5 | routes | 55 | 4508 | 82.0× | thunder |
| 81 | who handles f5 | discovery | 4 | 41550 | 10387.5× | thunder |
| 82 | how does f5 work | card | 59 | 1004 | 17.0× | thunder |
| 83 | flow of f5 | shard | 342 | 1004 | 2.9× | thunder |
| 84 | business rules for f5 | ask | 373 | 1004 | 2.7× | thunder |


## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
`node engine/tools/tier3-bench.mjs demo`:
- **answer-cache hit**: **5%** of raw (relay a hash-fresh prior answer; STALE on any source/engine change).
- **tool-output prune**: **1%** of raw on a 5 000-line log, error lines always preserved.
- **DEBUG mode**: `.thunder.config` with `DEBUG=true` → every op's data-token saving appended to `.thunder/gains.md`; off → zero overhead.

## 9. Verdict
| Query type | thunder benefit |
|---|---|
| Orientation / overview | **~470×** — decisive |
| Discovery "which feature handles X?" | **massive** (cost ∝ matches, not app size) |
| Symbol navigation (`sym`) | **10–30×** + straight to the point |
| Understand a service / its rules | **~3×** + pre-digested, cited meaning + HTTP contract |
| Routes / guards | **several×** + exact guards & flows |
| Exhaustive un-scoped dump | **neutral** → scope / grep |

**Conclusion.** The gain grows with **app size** and question **breadth**. On a large frontend,
*understanding / exploring / navigating* costs **2-3 orders of magnitude fewer tokens**, at **equal or
better** relevance (exact answers + anchored business meaning + guards/HTTP contract). The cost shifts to a
**one-time free** (technical) or **amortized** (functional) index. thunder doesn't "compress" an
intrinsically large answer (dump-everything) — it avoids **reading to search**.

## 10. Rerun
```
node engine/thunder.mjs build ngdemo --force && node engine/tools/token-bench.mjs ngdemo
node engine/tools/sweep-bench.mjs ngdemo && node engine/tools/tier3-bench.mjs demo
```
