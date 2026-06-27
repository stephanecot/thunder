# thunder-python — token benchmark

Same engine and doctrine as thunder-java/thunder-angular: the dominant per-query cost is **spawning a
sub-agent (~11k fixed tokens)**, not the index format. The optimization is to **answer INLINE** (main loop,
no sub-agent) from a minimal-but-sufficient payload, and to **route each question** to its cheapest entry
point (`sym` / `project-brief` / `routes.yaml` / grep `capability-map` / `ask`).

Engine parity: `project-brief.yaml`, two-tier cards, `ask` (ranked top-k, `--facts`, `--detail`, brief
fallback on 0 match), `engineHash` cache-bust + `build --force`, `dirty.list` drain, inline-first skills
with routing tables. Multi-framework: FastAPI / Flask / Django / plain Python, auto-detected per package.

## token-bench v2 (A/B/C — main-loop context growth) — on `pydemo` (40 realistic FastAPI packages)

| Question | (A) thunder inline | (B) raw inline | (C) +sub-agent | A/B | A/C |
|---|---|---|---|---|---|
| archi | 164 | 37 228 | 11 766 | 0 % | 1 % |
| flux | 410 | 919 | 11 766 | 45 % | 3 % |
| rule | 410 | 919 | 11 766 | 45 % | 3 % |
| routes | 164 | 13 485 | 11 766 | 1 % | 1 % |
| structure | 407 | 919 | 11 766 | 44 % | 3 % |
| where | 409 | 919 | 11 766 | 45 % | 3 % |

- **(A) vs (B)** on structure/where/what/flux/routes: **3 %** (target ≤ 25 %) ✅
- **(A) vs (C)** overall: **3 %** (target ≤ 15 %) ✅ → *spawning an agent is the error, not the index*
- **6/6** answered inline without a sub-agent ✅

## sweep-bench (20 routed queries) — on `pydemo`

| route | examples | thunder vs raw |
|---|---|---|
| sym | where is X / who uses X | 8–69 tok vs 0,15–0,4k → **5–43×** |
| brief | architecture / frameworks / overview | 164 tok vs ~37k → **~227×** |
| routes | list all / routes of package | grep ciblé → **plusieurs ×** |
| discovery | who handles X | grep capability-map → **massif** |
| analyze | mutating routes / missing-DI surface | déterministe, ~0 token modèle |
| ask/--facts | rule / flow / what-does / capabilities | 2–3× |

**Result: thunder wins 20/20, aggregate ~7 113 vs ~256 510 tok → 97 % saved** (targets ≥ 18/20, ≥ 70 %).

Honest reading: inline crushes raw on **broad** questions (archi, routes, discovery — orders of magnitude);
on a single small package the `ask` payload is comparable to reading it, but still **far below the
sub-agent reflex** (A/C). The structural win = **not spawning an agent**, and **routing to `sym`/`brief`**
instead of defaulting to `ask`.

## Rerun
```bash
node engine/tools/gen-pydemo.mjs pydemo 40
node engine/thunder.mjs build pydemo
node engine/tools/populate-pydemo.mjs pydemo
node engine/tools/token-bench.mjs pydemo   # A/B/C
node engine/tools/sweep-bench.mjs pydemo   # 20 routed queries
```

## SHARED Tier-3 layer — answer cache · tool-output pruning · DEBUG trace

Language-agnostic mechanics added on top of the index (byte-identical across all thunder-* plugins,
single source under `shared/`, synced by `shared/sync.mjs` — same precedent as `hash.mjs`/`yaml.mjs`).
Orthogonal axes (output / tool-results), so they compound with the index. `node engine/tools/tier3-bench.mjs demo`:

| Mechanic | thunder/baseline | correctness |
|---|---:|---|
| answer-cache hit (relay a prior, hash-fresh answer) | **9%** of raw | fresh hit on paraphrase; STALE on any `src_hash`/engine change |
| tool-output prune (verbose log) | **1%** of raw | error/diagnostic lines always preserved |

- **Answer cache (Tier-3):** `ask` consults `qa-ledger.ndjson` first; a fresh prior answer is relayed at
  ~0 retrieval/reasoning. Freshness gated by the index's existing `src_hash` + `engineHash` → never stale.
  Commands: `cache-answer` (write), `cache-gc`, `cache-stats`. Falls through safely on any miss.
- **Tool-output pruning:** `thunder prune` (stdin/file) keeps head+tail+diagnostics, elides the middle.
- **DEBUG mode:** a `.thunder.config` with `DEBUG=true` appends every operation's token saving to
  `.thunder/gains.md`. `DEBUG=false`/absent → zero overhead (one memoized config read; all gain math gated).
- Tests: `engine/test/common.test.mjs` (12 cases: prune, ledger freshness/staleness/scope/gc, debug on/off).
- No regression: existing tests + token/sweep benches unchanged.

## Expanded sweep (≥50 questions) + honest gain methodology

`sweep-bench` now generates **≥50 diverse questions** by iterating over every entity (classes,
services, models/controllers, features, contexts), each routed to its cheapest entry point and capped
(evenly sampled) so it stays fast on huge codebases. Zero-reference entities are excluded from
"who uses X" (a non-question whose raw cost is 0). On `pydemo`: **thunder wins 85/85 (100%) · 98% saved**.

**Gain = data tokens only.** Every comparison is *thunder output* (card / answer / index command) vs
*raw source you'd read without the plugin*. It EXCLUDES the fixed sub-agent overhead (~10.6k/agent)
and the SKILL.md size (~4.3k) — those are not part of a per-answer data cost. The DEBUG trace
(`.thunder/gains.md`) uses the same methodology.
Rerun: `node engine/tools/sweep-bench.mjs pydemo`
