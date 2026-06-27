---
name: thunder-mind-record
description: 'Capture a project decision (architectural, technical, functional, or convention) into the shared, committed thunder-mind index so the other developer''s AI reuses it instead of diverging. Trigger NOT ONLY on an explicit "record this decision" but whenever the user states a standing convention, preference, or behavioral directive in passing — even conversationally and in any language. English cues: "always do X", "from now on", "we should always", "let''s standardize on X", "the rule is", "going forward", "note that we decided Z". French cues: "tu devrais toujours", "à partir de maintenant", "on standardise", "la règle c''est", "désormais", "on décide de". If the user expresses a lasting project rule, capture it (don''t just keep it in your own memory). Stores English-only, normalized YAML and detects conflicts/duplicates.'
---

# record — capture a decision into the shared index

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${PWD}"
```

## Procedure
1. **Recall first** (avoid divergence/duplication):
   `node "$ENG" recall "<keywords of the decision>" "$ROOT"`.
   - If an active decision already covers it → don't duplicate; confirm alignment with the user.
   - If the new decision **replaces** an existing one → note that `id` as `supersedes`.
2. **Normalize via the scribe sub-agent.** Delegate to the **thunder-mind-scribe** agent (the @thunder-mind-scribe agent), passing a JSON payload:
   ```json
   {
     "raw": "<the decision in the user's words + why>",
     "related_decisions": [ <the recall cards from step 1> ],
     "today": "<YYYY-MM-DD>"
   }
   ```
   It returns **strict English JSON**: `{title, type, status, domain, context, decision, rationale,
   consequences, alternatives, tags, supersedes, conflicts_with, confidence}`.
3. **Write it** (the engine validates, dedups, captures evidence hashes, rebuilds the index):
   ```bash
   echo '<scribe JSON>' | node "$ENG" add "$ROOT" --author "<name>" --date "<YYYY-MM-DD>"
   ```
   - If `add` **refuses** (near-duplicate of an existing active decision), either align with that
     decision, or set `"supersedes": "<that id>"` in the JSON and re-run.
   - `--force` overwrites; use only when intentionally correcting a just-written file.
4. **Confirm** to the user: the new `id`, and whether it superseded or conflicts with anything.

## Rules
- **English only.** The scribe writes English regardless of the conversation language — the index must
  stay monolingual so recall/BM25 are consistent across developers.
- **One decision per record.** Split unrelated decisions into separate records.
- **Ground it.** Put real `evidence` (e.g. `src/db/policy.sql:12`, `PR #245`) when it exists — the engine
  hashes referenced files so `/thunder-mind-review` can flag when the code drifts.
- Pick a stable `domain` (a short kebab cluster: `auth`, `api`, `data`, `billing`, …). Reuse existing
  domains from `node "$ENG" brief "$ROOT"` rather than inventing near-duplicates.
