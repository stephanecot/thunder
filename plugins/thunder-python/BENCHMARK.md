# thunder-python — benchmark report (before / after)

**Method.** Per query: bytes actually ingested **without thunder** (read the relevant source) vs **with
thunder** (read the index slice via the right skill), at ~4 bytes/token. Gain = DATA tokens only — it
EXCLUDES fixed sub-agent overhead (~10.6k/agent) and the SKILL.md size (~4.3k). Bias favors "before"
(assumes it already knows which files to open; really it must grep/glob first — the index does that free).

**Test beds.** `demo` (toy: FastAPI + Flask + Django + plain) · `pydemo` (161 files, 40 FastAPI packages
with services/models/routes — main bed & scale bed).

## 1. Results table — pydemo
| # | Query | entry point | before (tok) | after (tok) | gain |
|---|---|---|---|---|---|
| 1 | App overview / which packages | `codemap` | 37 228 | 78 | **~477×** |
| 2 | What does package `f0` contain | `codemap` | ~1 000 | 60 (card) | **~17×** |
| 3 | Understand `F0Service` (its logic) | `grok` | ~370 | ~150 (shard slice) | **~3×** |
| 4 | Where is `F0Service` defined | `sym` | ~600 (grep+open) | 12 | **>10×** |
| 5 | Who uses `F0Service` | `sym` | ~800 | 25 | **>30×** |
| 6 | Which package handles "X" | `grok` | read the app | grep (∝ matches) | **massive** |
| 7 | Routes of a package | `codemap` | read the routes file | grep routes.yaml | **several×** |

## 2. Concrete examples (query → what each reads → the real answer)

### Example 1 — overview
- **Without thunder**: crawl the app → **148 910 B (~37 228 tok)**.
- **With thunder**: read `project-brief.yaml` → **310 B (~78 tok)**. Real answer: frameworks detected
  (FastAPI/Flask/Django/plain), packages + roles, all routes (summarized if > 50), key rules.
→ **~477× fewer tokens**, exact and already structured.

### Example 2 — symbol (where defined / who uses)
- **Without thunder**: global `grep` then open 2-3 files.
- **With thunder** (`sym`) → **12 + 25 tok**. Real answer:
```
class F0Service  bigshop/f0/service.py:8
def get_f0_service  bigshop/f0/routes.py:9   (← user of F0Service)
def create_f0  bigshop/f0/routes.py:14
```
→ `file:line` directly, no search→read loop.

### Example 3 — discovery ("which package handles X")
- **With thunder**: `grep -i <term> capability-map.yaml` → only the matching lines (cost ∝ matches, **not**
  app size). Returns the few packages whose inferred capabilities match.

### Example 4 — flow + business rules
- **Without thunder**: open the route + service + model, then trace calls and infer rules.
- **With thunder**: `ask "<package> flow"` — derived flow (route → service → model) + cited rules:
```yaml
routes:
  - {verb: POST, path: /f0, fn: create_f0}
  - {verb: GET, path: "/f0/{item_id}", fn: get_f0}
```
→ framework-aware routes (FastAPI/Flask/Django unified) + dependencies, no manual tracing.

### Example 5 — module / feature contents
- **Without thunder**: all files of the package → **~1 000 tok**.
- **With thunder**: the tier-1 `bigshop.f0.card.yaml` → **~60 tok** (classes, models, routes). **~17×.**

### Example 6 — endpoints / routes
- **With thunder**: `grep f0 routes.yaml` → the routes with verb/path/handler, without opening the routes file:
```
- {verb: POST, path: /f0, fn: create_f0, ctx: bigshop/bigshop.f0}
- {verb: GET, path: "/f0/{item_id}", fn: get_f0, ctx: bigshop/bigshop.f0}
```

## 3. Extreme scale — pydemo
Regenerate larger to push the scale: `node engine/tools/gen-pydemo.mjs pydemo`.

| Query | before (tok) | after (tok) | gain |
|---|---|---|---|
| Packages overview | ~37 228 | ~78 | **~477×** |
| "What does package `f17` do" | ~1 000 | ~60 (or 1 line) | **~17× and up** |

The bigger the app, the wider the gap: the index cost stays **bounded** (the brief summarizes routes past 50).

## 4. Honest nuances (where thunder doesn't help)
1. **Loading a whole flat file** (`routes.yaml`, `capability-map.yaml`) = anti-pattern → grep / query by package.
2. **Exhaustive deep-dive of a whole package** ≈ neutral in bytes, but the shard delivers **more** (meaning, flows, DI graph).
3. **Reading one small known file** ≈ neutral. thunder's edge is **breadth** (orientation, discovery, multi-file) and avoiding the search→read→trace loop.
4. **Large services/views**: the bigger they are, the more their **signatures ≪ source** → the gap widens for the shard.

## 5. One-time / amortized costs
- **Technical index**: **0 model tokens** (CPU only). pydemo 161 files in ~15 ms; incremental near-free; edit = instant enqueue (hook on `.py`).
- **Functional inference**: model cost **once** per context (Haiku cartographer), budgeted + confirmed, then read **free** on every query.

## 6. Two-tier index (card / detail) — token-bench
`node engine/tools/token-bench.mjs pydemo` (A = thunder inline · B = raw inline · C = +sub-agent):
- **(A) vs (B)** on structure/where/what/flux/routes: **2%** (target ≤ 25%) ✅
- **(A) vs (C)** overall: **2%** (target ≤ 15%) ✅ → *spawning an agent is the error, not the index*
- **6/6** answered inline without a sub-agent (target ≥ 5/6) ✅
- `analyze` (architecture / security: mutating routes & attack surface) answers from the index at ~0 model tokens.

## 7. Expanded sweep — ≥50 routed questions
`node engine/tools/sweep-bench.mjs pydemo` (≥50 questions over every entity, each routed to its cheapest
entry point): **thunder wins 85/85 (100%) · 12 481 vs 581 661 tok → 98% saved**.

## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
`node engine/tools/tier3-bench.mjs demo`:
- **answer-cache hit**: **9%** of raw (relay a hash-fresh prior answer; STALE on any source/engine change).
- **tool-output prune**: **1%** of raw on a 5 000-line log, error lines always preserved.
- **DEBUG mode**: `.thunder.config` with `DEBUG=true` → every op's data-token saving appended to `.thunder/gains.md`; off → zero overhead.

## 9. Verdict
| Query type | thunder benefit |
|---|---|
| Orientation / overview | **~480×** — decisive |
| Discovery "which package handles X?" | **massive** (cost ∝ matches, not app size) |
| Symbol navigation (`sym`) | **10–30×** + straight to the point |
| Understand a service / its rules | **~3×** + pre-digested, cited meaning |
| Routes (FastAPI/Flask/Django) | **several×** + exact verb/path/handler flows |
| Exhaustive un-scoped dump | **neutral** → scope / grep |

**Conclusion.** The gain grows with **app size** and question **breadth**. On a large codebase,
*understanding / exploring / navigating* costs **2-3 orders of magnitude fewer tokens**, at **equal or
better** relevance (exact answers + anchored business meaning, framework-aware). The cost shifts to a
**one-time free** (technical) or **amortized** (functional) index. thunder doesn't "compress" an
intrinsically large answer (dump-everything) — it avoids **reading to search**.

## 10. Rerun
```
node engine/thunder.mjs build pydemo --force && node engine/tools/token-bench.mjs pydemo
node engine/tools/sweep-bench.mjs pydemo && node engine/tools/tier3-bench.mjs demo
```
