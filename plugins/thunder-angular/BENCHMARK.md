# thunder-angular — token benchmark (inline-first)

Same doctrine as thunder-java: the dominant per-query cost is **spawning a sub-agent (~11k fixed
tokens)**, not the index format. So the optimization is to **answer INLINE** (main loop, no sub-agent)
from a minimal-but-sufficient payload.

- **`project-brief.yaml`** (tier-0, free): Angular style (standalone / NgModule / mixed), projects + roles,
  all routes (summarized if > 50), key rules. One read answers archi / overview / routes questions.
- **`ask "<kw>"`** ranked top-3, the #1 hit enriched with `business_rules` + route `flows` → self-sufficient.
  `--top N`, `ask --detail <id>`; routes bounded to the shown contexts.
- **Skills** (`codemap`, `grok`): rule #1 = answer inline, sub-agent budget = 0 for structure / where / what
  / route / flow / rule; one seeded agent only for a real `.ts` body/template.
- Parser fix: multi-line method signatures captured (not dropped).

## token-bench v2 (A/B/C, main-loop context growth) — on `ngdemo` (40 realistic features)

| Question | (A) thunder inline | (B) raw inline | (C) +sub-agent | A/B | A/C |
|---|---|---|---|---|---|
| archi | 87 | 17 960 | 11 145 | 0 % | 1 % |
| flux | 1 525 | 421 | 11 145 | 362 % | 14 % |
| rule | 1 527 | 421 | 11 145 | 363 % | 14 % |
| routes | 87 | 2 763 | 11 145 | 3 % | 1 % |
| structure | 1 524 | 421 | 11 145 | 362 % | 14 % |
| where | 1 191 | 421 | 11 145 | 283 % | 11 % |

- **(A) vs (B)** on structure/where/what/flux/routes: **20 %** (target ≤ 25 %) ✅
- **(A) vs (C)** overall: **9 %** (target ≤ 15 %) ✅ → *spawning an agent is the error, not the index*
- **6/6** answered inline without a sub-agent (target ≥ 5/6) ✅

Honest reading: inline crushes raw on **broad** questions (archi, routes — orders of magnitude). On a
single **tiny feature** (flux/rule/structure/where) `ask` is *more* than reading that feature's 4 small
files — but still **~8× cheaper than the sub-agent reflex** (A/C). The structural win = **not spawning an
agent**.

Rerun: `node engine/tools/gen-ngdemo.mjs ngdemo 40 && node engine/thunder.mjs build ngdemo && node engine/tools/token-bench.mjs ngdemo`

## ROUND 5 — skill routing + 20-query sweep

Routing tables added to `codemap`/`grok` (sym · project-brief · routes.yaml · grep capability-map · ask).
`ask` now falls back to `project-brief.yaml` when a conceptual query matches no card, and module
theme/keywords are part of its matching corpus. `ask --facts` for punctual factual questions.

`tools/sweep-bench.mjs` (20 routed queries on `ngdemo`): **thunder wins 18/20, ~97% aggregate economy**
(targets ≥18/20, ≥70%). The 2 remaining are punctual facts in tiny feature files (left as-is).
Rerun: `node engine/tools/sweep-bench.mjs ngdemo`

## ROUND 6 — correctness + per-feature granularity (IMPROVE-token-cost)

Four fixes from `IMPROVE-token-cost.prompt.md`, measured on a real modern-Angular project
(`aura/frontend`: standalone + `provideRouter`, **functional** guards/interceptors, `httpResource`)
and reproduced on the enriched demo (now carries `features/chat`, `features/documents`, a functional
guard + interceptor, and an `httpResource` service).

| # | Fix | Gap closed |
|---|---|---|
| #1 P0 | `build.locate()` descends one level for container dirs (`features`/`pages`/`modules`/`domains`/`libs`) → one context **per feature** instead of a monolithic `features`. Debrayable; never explodes a dir without sub-dirs. | Q3 «how does chat work» was drowned in ~90 % noise (+6 % vs raw) |
| #2 P0 | New parser pass: `export const x: CanActivateFn\|HttpInterceptorFn\|ResolveFn = …` → first-class symbol with stereotype + its `inject(X)` DI edges (`ctx.guards`, `ctx.di`). | `sym`/DI missed functional guards (3 injectors instead of 4) |
| #3 P1 | `extractRoutes` captures `canActivate`/`canMatch`/`canActivateChild`/`canDeactivate` → `guards:[…]` on the route, emitted in `routes.yaml` + flow. | routes answer never cited the guards |
| #4 P1 | Service method/field bodies scanned for `http.<verb>(`, `httpResource<T>(` + URL literal → `http:[{verb,url}]` facet on the service. | backend contract invisible (Q4 forced back to `.ts`) |

`ENGINE_HASH` extended to `derive.mjs` + `build.mjs` (was lexer+parser only) so the granularity/HTTP
derivation changes auto-invalidate `cache.ndjson`.

### data-token bench (overheads excluded) — `node engine/tools/data-bench.mjs demo`

| Question | fix | card-only | full-shard | raw-ts | thunder/raw |
|---|---|---:|---:|---:|---:|
| Q1 routes+guards | #3 | 153 | 300 | 194 | 79 % |
| Q2 who-injects AuthService | #2 | 38 | 172 | 318 | 12 % |
| Q3 chat feature flow | #1 | 51 | 177 | 334 | **15 %** |
| Q4 documents HTTP endpoints | #4 | 52 ✗ | 169 | 176 | 96 % |
| Q5 chat context/role | #1 | 51 | 177 | 334 | 15 % |

- **Q3 (feature flow): 15 %** of raw data tokens (target ≤ 50 %) — granularity broke the old +6 %. ✅
- **Aggregate: 34 %** of raw (target ≤ 50 %). ✅
- `✗` = card tier doesn't fully answer (HTTP verbs live in tier-2); the cheapest **correct** tier is scored.

### Correctness proven WITHOUT reading any `.ts`
- `sym refs AuthService` → **4** injectors incl. `guard authGuard` + `interceptor authInterceptor (injects AuthService)`.
- `routes.yaml` → `users`/`chat`/`documents` carry `guards: [authGuard]` (`canActivate`/`canMatch`).
- `features.documents.yaml` → `KnowledgeService.http: [GET, POST, DELETE /api/v1/documents]`;
  `features.chat.yaml` → `ChatService.http: [GET …/chat/history (httpResource), POST, DELETE]`.

No regression: `node --test` 34/34, `sweep-bench ngdemo` 18/20 ~97 %.
Rerun: `node engine/thunder.mjs build demo --force && node engine/tools/data-bench.mjs demo`

## SHARED Tier-3 layer — answer cache · tool-output pruning · DEBUG trace

Language-agnostic mechanics added on top of the index (byte-identical across all thunder-* plugins,
single source under `shared/`, synced by `shared/sync.mjs` — same precedent as `hash.mjs`/`yaml.mjs`).
Orthogonal axes (output / tool-results), so they compound with the index. `node engine/tools/tier3-bench.mjs demo`:

| Mechanic | thunder/baseline | correctness |
|---|---:|---|
| answer-cache hit (relay a prior, hash-fresh answer) | **5%** of raw | fresh hit on paraphrase; STALE on any `src_hash`/engine change |
| tool-output prune (verbose log) | **1%** of raw | error/diagnostic lines always preserved |

- **Answer cache (Tier-3):** `ask` consults `qa-ledger.ndjson` first; a fresh prior answer is relayed at
  ~0 retrieval/reasoning. Freshness gated by the index's existing `src_hash` + `engineHash` → never stale.
  Commands: `cache-answer` (write), `cache-gc`, `cache-stats`. Falls through safely on any miss.
- **Tool-output pruning:** `thunder prune` (stdin/file) keeps head+tail+diagnostics, elides the middle.
- **DEBUG mode:** a `.thunder.config` with `DEBUG=true` appends every operation's token saving to
  `.thunder/gains.md`. `DEBUG=false`/absent → zero overhead (one memoized config read; all gain math gated).
- Tests: `engine/test/common.test.mjs` (12 cases: prune, ledger freshness/staleness/scope/gc, debug on/off).
- No regression: existing tests + token/sweep benches unchanged.

## ROUND 2 — completed the 2 partial Round-1 fixes + expanded sweep

- **R2.1 factory-call guards**: `canActivate: [authGuard, scopeGuard('aura:admin')]` now parsed with a
  depth-aware split → `guards: [authGuard, "scopeGuard('aura:admin')"]` (args preserved, multi-arg safe).
- **R2.2 HTTP verb + URL**: track the HttpClient field name (so `private api = inject(HttpClient); api.post(...)`
  is detected, not just `http.*`); map the real verb per call; normalize template URLs
  (`${environment.apiUrl}/documents/${id}` → `{apiUrl}/documents/{id}`) instead of `null`/all-`GET`.
- **Expanded sweep (≥50 questions)**: iterate every component/service/feature; feature overview→tier-1 card,
  flow→tier-2 shard (exact & tiny); exclude zero-ref services from "who injects". On `ngdemo`:
  **thunder wins 84/84 (100%) · 98% saved**.

**Gain = data tokens only** (thunder output vs raw source), excluding sub-agent overhead and SKILL.md size.
New tests: factory-guard + non-http-field/verb/URL cases. Rerun: `node engine/tools/sweep-bench.mjs ngdemo`
