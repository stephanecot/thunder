# Thunder — IMPROVE prompt: shared Tier‑3 token‑optimization layer (cross‑framework)

> **Status: DESIGN / IMPLEMENTATION PROMPT — nothing here is built yet.** This single prompt
> supersedes and merges the three exploratory notes (answer‑cache, non‑index strategy, context
> compression). Goal: add **new token‑optimization mechanics on top of the existing index** —
> orthogonal axes (output, tool‑results, body‑reads, conversation), **shared across
> `thunder-java` / `thunder-angular` / `thunder-python`** as much as the architecture allows.
>
> Read `BENCHMARK.md` of each plugin and `engine/lib/{cache,emit,build,parser}.mjs` before coding.
> **Keep everything that exists. Add, never replace.**

---

## 0. Architecture decision — how "shared across frameworks" actually works here

Facts (verified against the repo):
- The engine is **duplicated per plugin** (each is a self‑contained Claude Code plugin). But two
  utility modules — `engine/lib/hash.mjs` and `engine/lib/yaml.mjs` — are already **byte‑identical**
  across all three. **That is the precedent we follow.**
- The **emitted index schema is shared** across languages: `project-brief.yaml`, `<ctx>.card.yaml`,
  `<ctx>.yaml` (carries `src_hash`), `routes.yaml`, `manifest.json` (`engineHash` + per‑file `hash`),
  `cache.ndjson`, `dirty.list`. The only language‑varying handle is `cacheDir(root)` =
  `.claude/cache/thunder-<lang>/`, already abstracted in `cache.mjs`.

**Rule for this layer:** every new mechanic that operates on the *emitted index / files / tool output*
(not on language syntax) MUST be a **language‑agnostic module that is byte‑identical across the three
plugins**, exactly like `hash.mjs`/`yaml.mjs`, consuming only `cacheDir`, the shard schema, and
`manifest`. Only the *skeletonizer rules* (`squeeze`) are language‑specific and get a small per‑plugin
rules file behind a shared core.

**Single source of truth + sync.** Author each agnostic module once under
`shared/engine/common/*.mjs` (new top‑level `shared/` dir) and a tiny sync step
`shared/sync.mjs` that copies them verbatim into each `plugins/<p>/engine/lib/common/` and copies the
shared skill bodies into each plugin (stamping only the `thunder-<lang>-` prefix and the cache
subdir, which the skills already template). This keeps the plugins self‑contained (install works
unchanged) while the *source* is genuinely common. Add `shared/sync.mjs` to the version‑bump ritual.

> Optional alternative (call out, do NOT default to it): a 4th `thunder-core` plugin owning the
> agnostic skills/hooks that auto‑detect which `thunder-<lang>` cache exists in the repo. Rejected as
> default because it forces users to install a 4th plugin and creates a cross‑plugin dependency; the
> byte‑identical‑module approach gives "common source" without that coupling.

**Hard guardrails (unchanged from prior rounds):**
- Retro‑compat: `<ctx>.yaml` AND `*.card.yaml` keep their current shape (only *additive* fields).
- Do NOT touch the cartographer inference layer, the evidence‑pack format, or the stale/reindex cycle.
- Reuse the existing hashes for invalidation; do **not** invent a parallel invalidation cycle.
- `node --test engine/test/` green for every plugin before concluding; add the new tests below.
- Bump each touched plugin's version + reinstall; commit trailer ends with the Co‑Authored‑By line.

**Execution order (by impact / dependency):**
**Phase 1 tool‑output pruning → Phase 2 answer cache → Phase 3 slice + squeeze → Phase 4 (optional) digest / delta / ladder.**
Ship phases independently; each must stand alone and degrade safely on miss.

---

## Phase 1 — Tool‑output pruning  (agnostic · highest breadth · lowest effort)

**Why first.** Helps *every* session (tests, builds, logs, big reads), not just Q&A — the one win the
index does nothing for. Research: task‑conditioned tool‑output pruning / "observation masking" ~halves
cost while matching SWE‑bench completion.

**Mechanic.** A deterministic pruner that keeps head + tail + all diagnostic lines
(`/error|fail|exception|warn|✗|panic|traceback/i`) and elides the middle with an explicit marker:
`…elided 4920 lines (run <cmd> to see all)…`. Pure string processing, zero‑dep, language‑agnostic.

**Integration — the honest part (verify against the Claude Code hook API before committing to one):**
- A `PostToolUse` hook *cannot reliably replace* a tool result in all harness versions. So ship the
  **robust path first**: a wrapper command `thunder run -- <cmd>` (and `thunder prune < file`) that the
  skills route known‑verbose commands through; its stdout is pre‑pruned. This always works.
- THEN, if the installed hook API supports output substitution (`hookSpecificOutput`), add an
  *additive* `PostToolUse` block matching `Bash` that prunes — **a new matcher block, leaving the
  existing `Edit|Write|MultiEdit` block untouched.** If substitution isn't supported, keep the
  wrapper‑command path and document it; do not ship a hook that silently fails.

**Files (agnostic, identical across plugins):** `engine/lib/common/prune.mjs` (the pruner),
`thunder.mjs` new cases `run`/`prune`. Skill routing tables gain: "for verbose commands (test/build/log)
prefer `thunder run -- <cmd>`."

**Acceptance:** a 5 000‑line fixture log → ≤ ~60 lines out, every error line preserved, marker present.
Env knob `THUNDER_PRUNE=off` disables. Unit test in each plugin (or once in `shared/` if a shared test
runner is added).

---

## Phase 2 — Answer cache (Tier‑3)  (agnostic · highest leverage on the Q&A path)

Caches past *answers*, gated for freshness by the `src_hash` we already emit — the correct‑by‑construction
invalidation that generic semantic caches lack.

**Data model — `qa-ledger.ndjson`** (in `cacheDir`; optional committable mirror at `.thunder/qa-ledger.ndjson`):
```jsonc
{ "q":"how does chat work", "qn":"chat work", "terms":["chat","work"],
  "a":"<answer text>", "deps":[{"ctx":"shop/features.chat","h":"0a8945cf"}],
  "scope":"feature", "engine":"a0c47fcb", "hits":0, "ts":"2026-06-27T..." }
```
- `deps[].h` = the shard's existing `src_hash`. `engine` = `manifest.engineHash` at write time.

**Read path** — extend `cmdAsk` (top of function, before retrieval):
1. normalize(q) → `qn`,`terms` (lowercase, strip punctuation/stopwords, light stem, sort).
2. rank ledger by **BM25 reusing the existing lexical ranker** in `ask` (no new dep, no embeddings).
3. for the top candidate: if `entry.engine !== engineHash` → evict; else compare each
   `dep.h` to the current shard `src_hash` — all equal = **FRESH → return `entry.a`** (`++hits`);
   any differ = **STALE → evict, fall through** to normal retrieval.
4. gate by `scope` and two thresholds: `τ_strong` auto‑returns; below it, emit the candidate as a
   *hint* the model may adopt or ignore. Never block.

**Write path** — new `cmdCacheAnswer(root, {q, ctxIds, scope}, answer)`: resolves each ctx's current
`src_hash`, stamps `engineHash`, normalizes, appends one line. Only called by the skill **for answers
derived purely from the index** (no `.ts` body read, no speculation) — the skill sets the flag.

**GC** — `cmdCacheGc`: drop entries whose `engine` is stale or `hits==0` after K builds; `cmdCacheStats`
prints hit rate. Optionally run `cache-gc` at the end of `build`.

**Skill integration (common pattern, per‑plugin prefix only):** `codemap`/`grok` routing tables get a
*step 0* ("ledger fresh hit? relay it, done") and a *final step* ("if the answer came only from the
index, persist via `thunder cache-answer --q … --ctx … --scope … -- <answer>`").

**Files (agnostic):** `engine/lib/common/ledger.mjs` (read/validate/write/gc + normalize + BM25 glue),
`thunder.mjs` cases `cache-answer`/`cache-gc`/`cache-stats` + `cmdAsk` hook. `.gitignore` keeps
`qa-ledger.ndjson` ignored; un‑ignore `.thunder/qa-ledger.ndjson` if the committable mirror is chosen.

**Acceptance (prove, don't assert):** ask a frozen question twice → 2nd is a FRESH hit (~0 retrieval);
modify one feature's source → its dependent entry goes STALE (evicted); paraphrase → same entry; a
`routes` question must NOT be answered from a `flow` entry (scope gate); bump `src_hash` and
`engineHash` independently → both evict. Add these as tests.

**Open decisions:** committable ledger (team compounding) vs cache‑only; auto‑return scopes
(`archi/routes/where/endpoint`) vs hint‑only scopes (`flow/rule`).

---

## Phase 3 — Slice + Squeeze  (the residual real‑body read)

These two compose: **slice picks the line span, squeeze compresses its content.** They attack the only
cost the index can't (the `✗` rows in the Angular data‑bench: facts that live in a method body).

### 3a. `thunder slice <Symbol|file:line-range>`  (mostly agnostic)
Emit only the symbol's line span instead of the whole file. Literature: LSP‑grade slicing saves 5–34×
vs whole‑file/grep.
- **Prerequisite (parser, per‑lang but additive):** emit a `span:[startLine,endLine]` on each
  type/method/functional. The parsers already track brace depth (Java/Angular) / indentation (Python),
  so the span is known — just record it. Retro‑compat: additive field, bump `engineHash` (auto cache‑bust).
- **Slice core (agnostic):** given an index symbol → read `file` lines `span[0]..span[1]`. Falls back
  to `sym def` + whole‑file only if no span.

### 3b. `thunder squeeze <file|Symbol>`  (shared core + per‑lang rules)
Deterministic **structure‑aware skeletonizer** — the missing **tier‑2.5** between shard detail and raw
source. Validated by SlimCode (model‑agnostic, 133× faster, no LM) and LongCodeZip's function‑boundary
chunking (we replace its perplexity ranking with our index's known relevance — **no model needed**).
- **Drop:** import blocks → 1 summary line; comments; blank/whitespace; logging/telemetry calls;
  trivial accessors; long literal payloads → `…elided…`.
- **Keep:** signatures; control flow (`if/for/while/switch/try`); calls; `return`/`throw`; guard
  clauses; conditions; plus the HTTP/route‑guard facets the index already extracts.
- **Shared core** `engine/lib/common/squeeze-core.mjs` (the walk + drop/keep engine) driven by a small
  **per‑plugin** `engine/lib/squeeze-rules.mjs` (the language's accessor pattern, log idioms,
  control‑flow keywords, comment syntax). This is the only place language rules live.
- **Budget (optional):** a 0/1‑knapsack to fit the most relevant skeletons under N tokens; if it drops
  a relevant one, `log()` it — no silent truncation.

**Honesty on gains:** we will NOT reach the 20–26× of model‑based compression (gist/LLMLingua) — those
need model weights/a small LM and are out of scope by our zero‑dep, black‑box constraint. The
deterministic lane realistically gets ~2–3× on a body, but it is free, exact, offline, and composes
with index + slice + answer cache.

**Skill integration:** the escalation ladder (Phase 4c) routes body needs to `slice` → `squeeze` →
full source, in that order; `squeeze` is *never* used when exact logic matters (debugging a specific
computation) — route to `slice`/full source there.

**Acceptance:** `slice` returns only the span (token count ≪ whole file); `squeeze` of a service method
keeps every control‑flow/return/throw line and drops comments/imports/logs; `--full` escape hatch;
elided regions marked. Tests per language (the keep‑set is the invariant to assert).

---

## Phase 4 — Optional refinements (cheap, fold into skills/agents)

- **4a. Session digest** (`thunder digest --ctx a,b,c`, agnostic): assemble a tight YAML "facts so far"
  block from shards (deterministic, verifiable) so a `/distill` skill can replace a fat transcript
  region. Pairs with the answer cache (cite ledger entries). Decide: auto (pressure‑triggered) vs
  explicit command.
- **4b. Delta re‑reads** (`thunder read <file>`, agnostic — **command, not a hook**, for reliability):
  keep a `seen-ledger` (file → last‑served `hash` from `manifest`); on re‑read, return "unchanged since
  you last read it" or the `git diff` since that hash instead of the whole file. `--full` escape hatch.
  (Implemented as a command the skill prefers over raw `Read`, because hooks can't reliably substitute a
  Read result.)
- **4c. Confidence‑gated escalation ladder** (skill discipline, no engine code): formalize the vertical
  ladder `ledger → tier‑0 → tier‑1 → tier‑2 → slice → squeeze → full source`; "don't climb a rung
  unless the current one is insufficient."
- **4d. Model‑cascade signal** (advisory only): `ask` already knows match strength — emit an optional
  `difficulty: easy|hard` hint (dominant single match = easy). We cannot pick the user's main‑loop
  model; we only keep using Haiku for thunder's own agents (cartographer already does) and surface the
  signal. Do not over‑claim.
- **4e. Prompt‑cache discipline** (no feature): emit artifacts in stable order, no volatile timestamps
  inside otherwise‑stable blocks, dynamic part last — so Claude Code's automatic prompt caching keeps
  its prefix. A review checklist, not code.

---

## How the whole stack composes (after this prompt)

```
question
  → answer cache (tier‑3)   fresh hit? relay, done.                 [Phase 2]
  → index (tier‑0..2)       structural answer.                      [exists]
  → need a real body?
        slice <sym>         pick the span.                          [Phase 3a]
        squeeze <sym>       compress the span's content.            [Phase 3b]
        full source         only if squeeze insufficient.
session‑wide:
  tool‑output pruning       on every verbose command.               [Phase 1]
  session digest / delta    cap long‑session growth.                [Phase 4a/4b]
```
Every step: deterministic, zero‑dep, hash‑invalidated, falls through safely on miss. Each touches a
different axis (output / tool‑results / body / conversation), so they are additive, not competing.

## Final deliverable (when built)
Per phase shipped: the touched files (agnostic `common/` vs per‑lang), the new tests green
(`node --test` for each plugin), a before/after bench appended to each `BENCHMARK.md` (data tokens),
version bumps + reinstall, and the exact rerun commands. Phase 1 and Phase 2 are the must‑haves; 3 and
4 are high‑value follow‑ups.
```
