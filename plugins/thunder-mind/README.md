# Thunder Mind ⚡

A **framework-agnostic, shared decision index** for a project. Where the other Thunder plugins index
*code*, thunder-mind indexes *decisions* — the architectural, technical, functional and convention
choices a team makes — so that when **two developers work on the same project, their AIs reuse the same
decisions instead of diverging** into contradictory ones.

The index is **committed to the repo** (reviewed in PRs) and queried token-minimally, the same way the
framework plugins query code.

## Why

Without a shared memory, each developer's AI re-derives architecture from scratch and may contradict a
choice the other developer already made. thunder-mind gives both AIs one source of truth:

- **recall before deciding** — check what was already decided for a given concern;
- **record** — capture a new decision (normalized, English, deduped, conflict-checked);
- **review** — surface contradictions and drift before they cause rework.

## How it maps to Thunder

| Framework plugins | thunder-mind |
|---|---|
| Technical layer = parse code (free) | Build the search index from decision YAML (free, in the hook) |
| Functional layer = cartographer infers meaning (costs tokens, regenerable) | Scribe normalizes a raw decision + checks conflicts (costs tokens, **committed & shared** → paid once) |
| Cache `.claude/cache/` gitignored | **Decisions committed** in `.thunder/mind/decisions/`; derived index gitignored in `.claude/cache/thunder-mind/` |

## Layout

Same directory convention as the framework plugins (committed source vs gitignored derived cache):

```
<project>/.thunder/mind/
├── decisions/            # ✅ committed source of truth — one YAML per decision, sharded by domain
│   └── <domain>/<YYYY-MM-DD>-<slug>.yaml
└── .config               # 🚫 local DEBUG toggle (.thunder/<fw>/.config, like every Thunder plugin)

<project>/.claude/cache/thunder-mind/   # 🚫 gitignored derived index — rebuilt by the hook
                          #    (index.yaml, brief.yaml, domain-map.yaml, postings.ndjson, qa-ledger.ndjson)
```

A decision id is `<domain>/<date>-<slug>` (= its file path), so two developers adding different decisions
never collide on merge — no sequential counter.

## Skills

| Skill | Use |
|---|---|
| `thunder-mind-recall` | Recall existing decisions **before** choosing an approach (the core skill) |
| `thunder-mind-record` | Capture a decision (scribe → validated YAML, deduped, conflict-checked) |
| `thunder-mind-harvest` | Extract decisions from the session / a PR and record the confirmed ones |
| `thunder-mind-review`  | Surface conflicts, supersede chains, dangling refs, evidence drift |
| `thunder-mind-reindex` | Rebuild the derived index from the decision files (free); `--validate` for CI |

The **thunder-mind-scribe** agent turns a raw decision into the strict English schema. A SessionStart hook
keeps the index fresh and injects a **bounded alignment brief** so both AIs start aligned.

## Engine CLI

```bash
ENG=engine/thunder.mjs
node $ENG build <root>                       # (re)build the derived index (incremental)
node $ENG ensure <root>                       # hook entry: refresh + print status + inject brief
node $ENG recall "<keywords>" <root>          # ranked decision cards; #1 fully enriched
node $ENG recall "<kw>" --domain <d> --top 6 --all <root>
node $ENG recall --detail <id> <root>         # full decision
node $ENG brief <root>                         # bounded alignment digest
echo '<json>' | node $ENG add <root> --author <name>   # record a decision (scribe output)
node $ENG conflicts <root> [--json]            # contradictions / drift
node $ENG validate <root> [--json]             # schema + English check (CI)
node $ENG prune [file] <root>                  # Tier-3 tool-output pruning
```

### Performance at scale

The recall path uses an **inverted index** + an idf-weighted **funnel** (candidates → score → enrich only
the top 1–3), so cost stays flat as the corpus grows. On a synthetic **2 000-decision** corpus
(`node engine/tools/gen-minddemo.mjs <dir> 2000`): build ≈ 90 ms, recall ≈ flat ~1.2 KB payload in well
under a second. Superseded/deprecated decisions are excluded from the default hot set.

### Debug mode

Per-framework, like the other plugins. Drop a `.thunder/mind/.config` with `DEBUG=true` and every `recall`
/ `prune` appends a token-gain row to `.thunder/gains.md`. Zero overhead when off.

## Tests

```bash
npm test                 # node --test (round-trip, recall ranking, conflicts, shared Tier-3)
npm run selftest         # integration test on the minddemo corpus
```

## Status

Experimental (0.1.0). Pure Node, zero dependencies, Node ≥ 18. English-only index.
