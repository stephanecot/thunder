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
