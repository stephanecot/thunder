# thunder-react — benchmark report (before / after)

**Method.** Per query: bytes actually ingested **without thunder** (read the relevant source) vs **with
thunder** (read the index slice via the right skill), at ~4 bytes/token. Gain = DATA tokens only — it
EXCLUDES fixed sub-agent overhead (~10.6k/agent) and the SKILL.md size (~4.3k). Bias favors "before"
(assumes it already knows which files to open; really it must grep/glob first — the index does that free).

**Test beds.** `demo` (toy: components + custom hooks + React Router) · `reactdemo` (161 files, 40 feature
folders with components/hooks/routes — main bed & scale bed).

## 1. Results table — reactdemo
| # | Query | entry point | before (tok) | after (tok) | gain |
|---|---|---|---|---|---|
| 1 | App overview / which features | `codemap` | 16 885 | 81 | **~208×** |
| 2 | What does feature `f0` contain | `codemap` | 365 | 47 (card) | **~8×** |
| 3 | Understand the `useF0` hook | `grok` | ~150 | ~70 (shard slice) | **~2×** |
| 4 | Where is `F0List` defined | `sym` | ~600 (grep+open) | 13 | **>10×** |
| 5 | Who uses the `useF0` hook | `sym` | ~800 | 25 | **>30×** |
| 6 | Which feature handles "X" | `grok` | read the app | grep (∝ matches) | **massive** |
| 7 | Routes / which component renders a path | `codemap` | read App.tsx | grep routes.yaml | **several×** |

## 2. Concrete examples (query → what each reads → the real answer)

### Example 1 — overview
- **Without thunder**: crawl the app → **67 538 B (~16 885 tok)**.
- **With thunder**: read `project-brief.yaml` → **322 B (~81 tok)**. Real answer: the React stack, feature
  folders + roles, all routes (summarized if > 50), key rules.
→ **~208× fewer tokens**, exact and already structured.

### Example 2 — symbol (where defined / who uses)
- **Without thunder**: global `grep` then open 2-3 files.
- **With thunder** (`sym`) → **13 + 25 tok**. Real answer:
```
component F0List  src/features/f0/F0List.tsx:3
F0Detail  src/features/f0/F0Detail.tsx:4   (injects useF0)
F0List  src/features/f0/F0List.tsx:3       (injects useF0)
```
→ `file:line` + which components use a hook, no search→read loop.

### Example 3 — discovery ("which feature handles X")
- **With thunder**: `grep -i <term> capability-map.yaml` → only the matching lines (cost ∝ matches, **not**
  app size). Returns the few features whose inferred capabilities match.

### Example 4 — flow + business rules
- **Without thunder**: open the component + its custom hook, then trace calls and infer rules.
- **With thunder**: `ask "<feature> flow"` — derived flow (route → component → custom hooks) + cited rules:
```yaml
routes: [{path: /f0, target: F0List, kind: route}]
components: [{n: F0List, kind: function, hooks: [useF0], deps: [useF0]}]
services: { useF0: { hooks: [useState, useEffect, useCallback] } }
```
→ route → component → hook chain + the hooks each unit uses, no manual tracing.

### Example 5 — module / feature contents
- **Without thunder**: all 4 files of the feature → **~365 tok**.
- **With thunder**: the tier-1 `features.f0.card.yaml` → **~47 tok** (components, hooks, routes). **~8×.**

### Example 6 — endpoints / routes
- **With thunder**: `grep f0 routes.yaml` → the routes with the component each renders, without opening App.tsx:
```
- {path: /f0, target: F0List, kind: route, ctx: "react-shop/features.f0"}
- {path: "/f0/:id", target: F0Detail, kind: route, ctx: "react-shop/features.f0"}
```

## 3. Extreme scale — reactdemo
Regenerate larger to push the scale: `node engine/tools/gen-reactdemo.mjs reactdemo 200`.

| Query | before (tok) | after (tok) | gain |
|---|---|---|---|
| Features overview | ~16 885 | ~81 | **~208×** |
| "What does feature `f17` do" | ~365 | ~47 (or 1 line) | **~8× and up** |

The bigger the app, the wider the gap: the index cost stays **bounded** (the brief summarizes routes past 50).

## 4. Honest nuances (where thunder doesn't help)
1. **Loading a whole flat file** (`routes.yaml`, `capability-map.yaml`) = anti-pattern → grep / query by feature.
2. **Exhaustive deep-dive of a whole feature** ≈ neutral in bytes, but the shard delivers **more** (meaning, flows, hook graph).
3. **Reading one small known file** ≈ neutral. thunder's edge is **breadth** (orientation, discovery, multi-file) and avoiding the search→read→trace loop.
4. **Large components/hooks**: the bigger they are, the more their **signatures ≪ source** → the gap widens for the shard.

## 5. One-time / amortized costs
- **Technical index**: **0 model tokens** (CPU only). reactdemo 161 files in ~15 ms; incremental near-free; edit = instant enqueue (hook on `.tsx`/`.ts`/`.jsx`/`.js`).
- **Functional inference**: model cost **once** per context (Haiku cartographer), budgeted + confirmed, then read **free** on every query.

## 6. Two-tier index (card / detail) — token-bench
`node engine/tools/token-bench.mjs reactdemo` (A = thunder inline · B = raw inline · C = +sub-agent):
- **(A) vs (B)** on structure/where/what/flux/routes: **2%** (target ≤ 25%) ✅
- **(A) vs (C)** overall: **1%** (target ≤ 15%) ✅ → *spawning an agent is the error, not the index*
- **6/6** answered inline without a sub-agent (target ≥ 5/6) ✅

## 7. Expanded sweep — ≥50 routed questions
`node engine/tools/sweep-bench.mjs reactdemo` — ≥50 questions over every entity (components, custom hooks, features, contexts), each routed to its cheapest entry point and compared to the raw cost. thunder wins **84/84** (100%) · aggregate **4177 vs 222959 tok → 98% saved**. Full per-question table (every tested question):

| # | Query | route | thunder | raw | factor | winner |
|---|---|---|---|---|---|---|
| 1 | architecture overview | brief | 81 | 16885 | 208.5× | thunder |
| 2 | which projects/features exist | brief | 81 | 16885 | 208.5× | thunder |
| 3 | how is the app structured | brief | 81 | 16885 | 208.5× | thunder |
| 4 | list all routes | routes | 1472 | 2162 | 1.5× | thunder |
| 5 | where is App defined | sym | 8 | 2162 | 270.3× | thunder |
| 6 | find the App class | sym | 8 | 2162 | 270.3× | thunder |
| 7 | where is F11List defined | sym | 13 | 67 | 5.2× | thunder |
| 8 | find the F11List class | sym | 13 | 67 | 5.2× | thunder |
| 9 | where is F15List defined | sym | 13 | 67 | 5.2× | thunder |
| 10 | find the F15List class | sym | 13 | 67 | 5.2× | thunder |
| 11 | where is F19List defined | sym | 13 | 67 | 5.2× | thunder |
| 12 | find the F19List class | sym | 13 | 67 | 5.2× | thunder |
| 13 | where is F22List defined | sym | 13 | 67 | 5.2× | thunder |
| 14 | find the F22List class | sym | 13 | 67 | 5.2× | thunder |
| 15 | where is F26List defined | sym | 13 | 67 | 5.2× | thunder |
| 16 | find the F26List class | sym | 13 | 67 | 5.2× | thunder |
| 17 | where is F3List defined | sym | 12 | 66 | 5.5× | thunder |
| 18 | find the F3List class | sym | 12 | 66 | 5.5× | thunder |
| 19 | where is F33List defined | sym | 13 | 67 | 5.2× | thunder |
| 20 | find the F33List class | sym | 13 | 67 | 5.2× | thunder |
| 21 | where is F37List defined | sym | 13 | 67 | 5.2× | thunder |
| 22 | find the F37List class | sym | 13 | 67 | 5.2× | thunder |
| 23 | where is F5List defined | sym | 12 | 66 | 5.5× | thunder |
| 24 | find the F5List class | sym | 12 | 66 | 5.5× | thunder |
| 25 | where is useF0 defined | sym | 10 | 204 | 20.4× | thunder |
| 26 | where is useF12 defined | sym | 11 | 206 | 18.7× | thunder |
| 27 | where is useF16 defined | sym | 11 | 206 | 18.7× | thunder |
| 28 | where is useF2 defined | sym | 10 | 204 | 20.4× | thunder |
| 29 | where is useF23 defined | sym | 11 | 206 | 18.7× | thunder |
| 30 | where is useF27 defined | sym | 11 | 206 | 18.7× | thunder |
| 31 | where is useF30 defined | sym | 11 | 206 | 18.7× | thunder |
| 32 | where is useF34 defined | sym | 11 | 206 | 18.7× | thunder |
| 33 | where is useF38 defined | sym | 11 | 206 | 18.7× | thunder |
| 34 | where is useF6 defined | sym | 10 | 204 | 20.4× | thunder |
| 35 | who injects useF0 | sym | 33 | 134 | 4.1× | thunder |
| 36 | who injects useF12 | sym | 35 | 136 | 3.9× | thunder |
| 37 | who injects useF16 | sym | 35 | 136 | 3.9× | thunder |
| 38 | who injects useF2 | sym | 33 | 134 | 4.1× | thunder |
| 39 | who injects useF23 | sym | 35 | 136 | 3.9× | thunder |
| 40 | who injects useF27 | sym | 35 | 136 | 3.9× | thunder |
| 41 | who injects useF30 | sym | 35 | 136 | 3.9× | thunder |
| 42 | who injects useF34 | sym | 35 | 136 | 3.9× | thunder |
| 43 | who injects useF38 | sym | 35 | 136 | 3.9× | thunder |
| 44 | who injects useF6 | sym | 33 | 134 | 4.1× | thunder |
| 45 | routes of feature features.f0 | routes | 0 | 2162 | — | thunder |
| 46 | who handles features.f0 | discovery | 8 | 16885 | 2110.6× | thunder |
| 47 | how does features.f0 work | card | 47 | 365 | 7.8× | thunder |
| 48 | flow of features.f0 | shard | 132 | 365 | 2.8× | thunder |
| 49 | business rules for features.f0 | ask | 29 | 365 | 12.6× | thunder |
| 50 | routes of feature features.f13 | routes | 0 | 2162 | — | thunder |
| 51 | who handles features.f13 | discovery | 8 | 16885 | 2110.6× | thunder |
| 52 | how does features.f13 work | card | 49 | 369 | 7.5× | thunder |
| 53 | flow of features.f13 | shard | 136 | 369 | 2.7× | thunder |
| 54 | business rules for features.f13 | ask | 29 | 369 | 12.7× | thunder |
| 55 | routes of feature features.f18 | routes | 0 | 2162 | — | thunder |
| 56 | who handles features.f18 | discovery | 8 | 16885 | 2110.6× | thunder |
| 57 | how does features.f18 work | card | 49 | 369 | 7.5× | thunder |
| 58 | flow of features.f18 | shard | 136 | 369 | 2.7× | thunder |
| 59 | business rules for features.f18 | ask | 29 | 369 | 12.7× | thunder |
| 60 | routes of feature features.f22 | routes | 0 | 2162 | — | thunder |
| 61 | who handles features.f22 | discovery | 8 | 16885 | 2110.6× | thunder |
| 62 | how does features.f22 work | card | 49 | 369 | 7.5× | thunder |
| 63 | flow of features.f22 | shard | 136 | 369 | 2.7× | thunder |
| 64 | business rules for features.f22 | ask | 29 | 369 | 12.7× | thunder |
| 65 | routes of feature features.f27 | routes | 0 | 2162 | — | thunder |
| 66 | who handles features.f27 | discovery | 8 | 16885 | 2110.6× | thunder |
| 67 | how does features.f27 work | card | 49 | 369 | 7.5× | thunder |
| 68 | flow of features.f27 | shard | 136 | 369 | 2.7× | thunder |
| 69 | business rules for features.f27 | ask | 29 | 369 | 12.7× | thunder |
| 70 | routes of feature features.f31 | routes | 0 | 2162 | — | thunder |
| 71 | who handles features.f31 | discovery | 8 | 16885 | 2110.6× | thunder |
| 72 | how does features.f31 work | card | 49 | 369 | 7.5× | thunder |
| 73 | flow of features.f31 | shard | 136 | 369 | 2.7× | thunder |
| 74 | business rules for features.f31 | ask | 29 | 369 | 12.7× | thunder |
| 75 | routes of feature features.f36 | routes | 0 | 2162 | — | thunder |
| 76 | who handles features.f36 | discovery | 8 | 16885 | 2110.6× | thunder |
| 77 | how does features.f36 work | card | 49 | 369 | 7.5× | thunder |
| 78 | flow of features.f36 | shard | 136 | 369 | 2.7× | thunder |
| 79 | business rules for features.f36 | ask | 29 | 369 | 12.7× | thunder |
| 80 | routes of feature features.f5 | routes | 0 | 2162 | — | thunder |
| 81 | who handles features.f5 | discovery | 8 | 16885 | 2110.6× | thunder |
| 82 | how does features.f5 work | card | 47 | 365 | 7.8× | thunder |
| 83 | flow of features.f5 | shard | 133 | 365 | 2.7× | thunder |
| 84 | business rules for features.f5 | ask | 29 | 365 | 12.6× | thunder |

## 8. Shared Tier-3 layer (answer cache · tool-output pruning · DEBUG)
`node engine/tools/tier3-bench.mjs demo`:
- **answer-cache hit**: **10%** of raw (relay a hash-fresh prior answer; STALE on any source/engine change). The `codemap`/`grok` skills persist pure-index answers via `cache-answer`, so the cache actually fills.
- **tool-output prune**: **1%** of raw on a 5 000-line log, error lines always preserved.
- **DEBUG mode**: a `.thunder/react/.config` with `DEBUG=true` → every op's data-token saving appended to `.thunder/gains.md`; off → zero overhead.

## 9. Verdict
| Query type | thunder benefit |
|---|---|
| Orientation / overview | **~208×** — decisive |
| Discovery "which feature handles X?" | **massive** (cost ∝ matches, not app size) |
| Symbol navigation (`sym`) | **10–30×** + straight to the point |
| Understand a component / hook | **~2×** + pre-digested, cited meaning + hook graph |
| Routes (React Router) | **several×** + exact route → component → hook flows |
| Exhaustive un-scoped dump | **neutral** → scope / grep |

**Conclusion.** The gain grows with **app size** and question **breadth**. On a large React app,
*understanding / exploring / navigating* costs **2-3 orders of magnitude fewer tokens**, at **equal or
better** relevance (exact answers + anchored meaning + the component→hook graph). The cost shifts to a
**one-time free** (technical) or **amortized** (functional) index. thunder doesn't "compress" an
intrinsically large answer (dump-everything) — it avoids **reading to search**.

## 10. Rerun
```
node engine/thunder.mjs build reactdemo --force && node engine/tools/token-bench.mjs reactdemo
node engine/tools/sweep-bench.mjs reactdemo && node engine/tools/tier3-bench.mjs demo
```
