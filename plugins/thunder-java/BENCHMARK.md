# thunder-java — benchmark report (before / after)

**Method.** Per query: bytes actually ingested **without thunder** (read the relevant source) vs **with
thunder** (read the index slice via the right skill), at ~4 bytes/token. Gain = DATA tokens only — it
EXCLUDES fixed sub-agent overhead (~10.6k/agent) and the SKILL.md size (~4.3k). Bias favors "before"
(assumes it already knows which files to open; really it must grep/glob first — the index does that free).

**Test beds.** `demo` (toy) · `realdemo` (1 320 files, 3 modules, 120 contexts, 840 endpoints, services
~108 lines with real logic — main bed) · `bigdemo` (3 840 files, extreme scale).

## 1. Results table — realdemo
| # | Query | entry point | before (tok) | after (tok) | gain |
|---|---|---|---|---|---|
| 1 | App overview / which domains | `codemap` | 297 525 | 206 | **~1 444×** |
| 2 | What does module `mod0` contain | `codemap` | 99 175 | 2 176 | **~46×** |
| 3 | Understand `R0_0Service` (its logic) | `grok` | 1 006 | ~204 (card) | **~5×** |
| 4 | Where is `R0_0Service` defined | `sym` | ~600 (grep+open) | 51 | **>10×** |
| 5 | Who uses `R0_0Repository` | `sym` | ~800 | 17 | **>40×** |
| 6 | Which context handles "approve" | `grok` | read the repo | grep (∝ matches) | **massive** |
| 7 | Endpoints of a domain | `codemap` | read the controller | grep endpoints.yaml | **several×** |

## 2. Concrete examples (query → what each reads → the real answer)

### Example 1 — overview
- **Without thunder**: crawl the codebase → **1 190 100 B (~297 525 tok)**.
- **With thunder**: read `index.yaml` → **825 B (~206 tok)**. Real answer:
```yaml
meta: {modules: 3, contexts: 120, endpoints: 840}
modules:
  - name: mod0
```
→ **~1 444× fewer tokens**, exact and already structured (business theme per module).

### Example 2 — symbol (where defined / who uses)
- **Without thunder**: global `grep` then open 2-3 files (~hundreds-thousands of tokens).
- **With thunder** (`sym`) → **51 + 17 tok**. Real answer:
```
class R0_0Service  mod0/src/main/java/com/real/mod0/dom0/R0_0Service.java:18
method R0_0Service.R0_0Service(R0_0Repository, R0_0Mapper)  …:25
R0_0Service  mod0/src/main/java/com/real/mod0/dom0/R0_0Service.java:18   (← user of R0_0Repository)
```
→ `file:line` + signature directly, no search→read loop.

### Example 3 — discovery ("which context handles X")
- **With thunder**: `grep dom13 capability-map.yaml` → only the matching lines (cost ∝ matches, **not**
  repo size), each one self-sufficient (id + purpose + capabilities together). Real answer:
```
mod0/com.real.mod0.dom13: "Manage the R0_13 lifecycle: creation, update, approval and search — Create a R0_13; …; Approve a R0_13; Reject a R0_13"
```

### Example 4 — flow + business rules
- **Without thunder**: open `R0_0Service` (108 l.) + Controller + Request + Entity + Mapper + exceptions,
  then trace calls and infer rules.
- **With thunder**: one shard slice — derived flows + cited rules, already digested:
```yaml
business_rules:
  - {rule: "An approved record cannot be modified", src: "R0_0Service.java update(): status == APPROVED"}
use_cases:
  - {name: "Approve a R0_0", flow: "POST /api/r0_0/{id}/approve → R0_0Controller.approve → R0_0Service → R0_0Repository"}
```
→ rules anchored on real code (cite the method), flows without manual tracing.

### Example 5 — module / feature contents
- **Without thunder**: 440 files of the module → **~99 175 tok**.
- **With thunder**: `modules/mod0/_index.yaml` → **~2 176 tok** (one line/context with purpose). **~46×.**

### Example 6 — endpoints / routes
- **With thunder**: `grep <domain> endpoints.yaml` → one self-sufficient line per endpoint (verb, path,
  handler, req/resp types, context), without opening the controller:
```
POST /api/r0_0  R0_0Controller.create  R0_0Request -> R0_0Response  (mod0/com.real.mod0.dom0)
POST /api/r0_0/{id}/approve  R0_0Controller.approve  -> R0_0Response  (mod0/com.real.mod0.dom0)
```

## 3. Extreme scale — bigdemo
| Query | before (tok) | after (tok) | gain |
|---|---|---|---|
| Domains overview | ~485 700 | ~433 | **~1 100×** |
| "What does module `mod3` do" | ~60 700 | ~433 (or 1 line) | **~140× and up** |

The bigger the repo, the wider the gap: the index cost stays **bounded** (top ~70 lines).

## 4. Honest nuances (where thunder doesn't help)
1. **Loading a whole flat file** (`endpoints.yaml`, `capability-map.yaml`) = anti-pattern → grep / query by module.
2. **Exhaustive deep-dive of a whole context** ≈ neutral in bytes, but the shard delivers **more** (meaning, flows, relations).
3. **Reading one small known file** ≈ neutral. thunder's edge is **breadth** (orientation, discovery, multi-file) and avoiding the search→read→trace loop.
4. **Large-logic files**: the bigger a service, the more its **signatures ≪ source** → the gap widens for the shard.

## 5. One-time / amortized costs
- **Technical index**: **0 model tokens** (CPU only). realdemo 1 320 files in ~150 ms; bigdemo 3 840 in ~270 ms; incremental near-free; edit = instant enqueue (hook).
- **Functional inference**: model cost **once** per context (Haiku cartographer), budgeted + confirmed, then read **free** on every query.

## 6. Two-tier index (card / detail) — token-bench
`node engine/tools/token-bench.mjs realdemo` (A = thunder inline · B = raw inline · C = +sub-agent):
- **(A) vs (B)** on structure/where/what/flux/endpoint: **1%** (target ≤ 25%) ✅
- **(A) vs (C)** overall: **11%** (target ≤ 15%) ✅ → *spawning an agent is the error, not the index*
- **7/7** answered inline without a sub-agent (target ≥ 6/7) ✅

## 7. Expanded sweep — ≥50 routed questions
`node engine/tools/sweep-bench.mjs realdemo` — ≥50 questions over every entity (classes, services, models/controllers/components, features, contexts), each routed to its cheapest entry point and compared to the raw cost. thunder wins **95/95** (100%) · aggregate **59783 vs 3413939 tok → 98% saved**. Full per-question table (every tested question):

| # | Query | route | thunder | raw | factor | winner |
|---|---|---|---|---|---|---|
| 1 | architecture overview | brief | 237 | 297525 | 1255.4× | thunder |
| 2 | which modules exist | brief | 237 | 297525 | 1255.4× | thunder |
| 3 | how is the app structured | brief | 237 | 297525 | 1255.4× | thunder |
| 4 | list all endpoints | endpoints | 20923 | 43748 | 2.1× | thunder |
| 5 | where is R0_0Service defined | sym | 49 | 1006 | 20.5× | thunder |
| 6 | what does R0_0Service do | ask | 274 | 1006 | 3.7× | thunder |
| 7 | where is R0_2Service defined | sym | 49 | 1006 | 20.5× | thunder |
| 8 | what does R0_2Service do | ask | 274 | 1006 | 3.7× | thunder |
| 9 | where is R0_30Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 10 | what does R0_30Service do | ask | 280 | 1019 | 3.6× | thunder |
| 11 | where is R0_6Service defined | sym | 49 | 1006 | 20.5× | thunder |
| 12 | what does R0_6Service do | ask | 274 | 1006 | 3.7× | thunder |
| 13 | where is R1_16Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 14 | what does R1_16Service do | ask | 280 | 1019 | 3.6× | thunder |
| 15 | where is R1_27Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 16 | what does R1_27Service do | ask | 280 | 1019 | 3.6× | thunder |
| 17 | where is R1_38Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 18 | what does R1_38Service do | ask | 280 | 1019 | 3.6× | thunder |
| 19 | where is R2_12Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 20 | what does R2_12Service do | ask | 280 | 1019 | 3.6× | thunder |
| 21 | where is R2_23Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 22 | what does R2_23Service do | ask | 280 | 1019 | 3.6× | thunder |
| 23 | where is R2_34Service defined | sym | 51 | 1019 | 20.0× | thunder |
| 24 | what does R2_34Service do | ask | 280 | 1019 | 3.6× | thunder |
| 25 | callers of R0_0Service | sym | 19 | 362 | 19.1× | thunder |
| 26 | callers of R0_2Service | sym | 19 | 362 | 19.1× | thunder |
| 27 | callers of R0_30Service | sym | 20 | 366 | 18.3× | thunder |
| 28 | callers of R0_6Service | sym | 19 | 362 | 19.1× | thunder |
| 29 | callers of R1_16Service | sym | 20 | 366 | 18.3× | thunder |
| 30 | callers of R1_27Service | sym | 20 | 366 | 18.3× | thunder |
| 31 | callers of R1_38Service | sym | 20 | 366 | 18.3× | thunder |
| 32 | callers of R2_12Service | sym | 20 | 366 | 18.3× | thunder |
| 33 | callers of R2_23Service | sym | 20 | 366 | 18.3× | thunder |
| 34 | callers of R2_34Service | sym | 20 | 366 | 18.3× | thunder |
| 35 | find the R0_0Controller class | sym | 49 | 362 | 7.4× | thunder |
| 36 | endpoints of R0_0Controller | endpoints | 169 | 362 | 2.1× | thunder |
| 37 | find the R0_22Controller class | sym | 51 | 366 | 7.2× | thunder |
| 38 | endpoints of R0_22Controller | endpoints | 176 | 366 | 2.1× | thunder |
| 39 | find the R0_36Controller class | sym | 51 | 366 | 7.2× | thunder |
| 40 | endpoints of R0_36Controller | endpoints | 176 | 366 | 2.1× | thunder |
| 41 | find the R1_13Controller class | sym | 51 | 366 | 7.2× | thunder |
| 42 | endpoints of R1_13Controller | endpoints | 176 | 366 | 2.1× | thunder |
| 43 | find the R1_27Controller class | sym | 51 | 366 | 7.2× | thunder |
| 44 | endpoints of R1_27Controller | endpoints | 176 | 366 | 2.1× | thunder |
| 45 | find the R1_5Controller class | sym | 49 | 362 | 7.4× | thunder |
| 46 | endpoints of R1_5Controller | endpoints | 169 | 362 | 2.1× | thunder |
| 47 | find the R2_18Controller class | sym | 51 | 366 | 7.2× | thunder |
| 48 | endpoints of R2_18Controller | endpoints | 176 | 366 | 2.1× | thunder |
| 49 | find the R2_31Controller class | sym | 51 | 366 | 7.2× | thunder |
| 50 | endpoints of R2_31Controller | endpoints | 176 | 366 | 2.1× | thunder |
| 51 | who uses R0_0Repository | sym | 18 | 1006 | 55.9× | thunder |
| 52 | who uses R0_30Repository | sym | 19 | 1019 | 53.6× | thunder |
| 53 | who uses R1_16Repository | sym | 19 | 1019 | 53.6× | thunder |
| 54 | who uses R1_38Repository | sym | 19 | 1019 | 53.6× | thunder |
| 55 | who uses R2_23Repository | sym | 19 | 1019 | 53.6× | thunder |
| 56 | where is R0_0 defined | sym | 16 | 378 | 23.6× | thunder |
| 57 | where is R0_22 defined | sym | 17 | 380 | 22.4× | thunder |
| 58 | where is R0_36 defined | sym | 17 | 380 | 22.4× | thunder |
| 59 | where is R1_13 defined | sym | 17 | 380 | 22.4× | thunder |
| 60 | where is R1_27 defined | sym | 17 | 380 | 22.4× | thunder |
| 61 | where is R1_5 defined | sym | 16 | 378 | 23.6× | thunder |
| 62 | where is R2_18 defined | sym | 17 | 380 | 22.4× | thunder |
| 63 | where is R2_31 defined | sym | 17 | 380 | 22.4× | thunder |
| 64 | who handles dom0 | discovery | 171 | 297525 | 1739.9× | thunder |
| 65 | business rules for dom0 | ask | 804 | 2460 | 3.1× | thunder |
| 66 | flow of creating dom0 | ask | 1500 | 2460 | 1.6× | thunder |
| 67 | how does dom0 work | ask | 1497 | 2460 | 1.6× | thunder |
| 68 | who handles dom13 | discovery | 178 | 297525 | 1671.5× | thunder |
| 69 | business rules for dom13 | ask | 821 | 2486 | 3.0× | thunder |
| 70 | flow of creating dom13 | ask | 1560 | 2486 | 1.6× | thunder |
| 71 | how does dom13 work | ask | 1557 | 2486 | 1.6× | thunder |
| 72 | who handles dom18 | discovery | 178 | 297525 | 1671.5× | thunder |
| 73 | business rules for dom18 | ask | 821 | 2486 | 3.0× | thunder |
| 74 | flow of creating dom18 | ask | 1560 | 2486 | 1.6× | thunder |
| 75 | how does dom18 work | ask | 1557 | 2486 | 1.6× | thunder |
| 76 | who handles dom22 | discovery | 178 | 297525 | 1671.5× | thunder |
| 77 | business rules for dom22 | ask | 821 | 2486 | 3.0× | thunder |
| 78 | flow of creating dom22 | ask | 1560 | 2486 | 1.6× | thunder |
| 79 | how does dom22 work | ask | 1557 | 2486 | 1.6× | thunder |
| 80 | who handles dom27 | discovery | 178 | 297525 | 1671.5× | thunder |
| 81 | business rules for dom27 | ask | 821 | 2486 | 3.0× | thunder |
| 82 | flow of creating dom27 | ask | 1560 | 2486 | 1.6× | thunder |
| 83 | how does dom27 work | ask | 1557 | 2486 | 1.6× | thunder |
| 84 | who handles dom31 | discovery | 178 | 297525 | 1671.5× | thunder |
| 85 | business rules for dom31 | ask | 821 | 2486 | 3.0× | thunder |
| 86 | flow of creating dom31 | ask | 1560 | 2486 | 1.6× | thunder |
| 87 | how does dom31 work | ask | 1557 | 2486 | 1.6× | thunder |
| 88 | who handles dom36 | discovery | 178 | 297525 | 1671.5× | thunder |
| 89 | business rules for dom36 | ask | 821 | 2486 | 3.0× | thunder |
| 90 | flow of creating dom36 | ask | 1560 | 2486 | 1.6× | thunder |
| 91 | how does dom36 work | ask | 1557 | 2486 | 1.6× | thunder |
| 92 | who handles dom5 | discovery | 171 | 297525 | 1739.9× | thunder |
| 93 | business rules for dom5 | ask | 804 | 2460 | 3.1× | thunder |
| 94 | flow of creating dom5 | ask | 1500 | 2460 | 1.6× | thunder |
| 95 | how does dom5 work | ask | 1497 | 2460 | 1.6× | thunder |


## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
`node engine/tools/tier3-bench.mjs demo`:
- **answer-cache hit**: **3%** of raw (relay a hash-fresh prior answer; STALE on any source/engine change).
- **tool-output prune**: **1%** of raw on a 5 000-line log, error lines always preserved.
- **DEBUG mode**: `.thunder/<framework>/.config` with `DEBUG=true` → every op's data-token saving appended to `.thunder/gains.md`; off → zero overhead.

## 9. Verdict
| Query type | thunder benefit |
|---|---|
| Orientation / overview | **~1 100–1 500×** — decisive |
| Discovery "who handles X?" | **massive** (cost ∝ matches, not repo size) |
| Symbol navigation (`sym`) | **10–40×** + straight to the point |
| Understand a service / its rules | **~5×** + pre-digested, cited meaning |
| Endpoints / routes | **several×** + exact cross-file flows |
| Exhaustive un-scoped dump | **neutral** → scope / grep |

**Conclusion.** The gain grows with **repo size** and question **breadth**. On a large codebase,
*understanding / exploring / navigating* costs **2-3 orders of magnitude fewer tokens**, at **equal or
better** relevance (exact answers + anchored business meaning). The cost shifts to a **one-time free**
(technical) or **amortized** (functional) index. thunder doesn't "compress" an intrinsically large answer
(dump-everything) — it avoids **reading to search**.

## 10. Rerun
```
node engine/thunder.mjs build realdemo --force && node engine/tools/token-bench.mjs realdemo
node engine/tools/sweep-bench.mjs realdemo && node engine/tools/tier3-bench.mjs demo
```
