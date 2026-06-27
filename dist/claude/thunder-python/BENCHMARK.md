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
