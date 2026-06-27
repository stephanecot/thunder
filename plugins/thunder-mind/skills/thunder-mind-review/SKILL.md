---
name: thunder-mind-review
description: Check the health of the shared thunder-mind decision index — surface contradictions between active decisions, supersede chains left un-flipped, dangling references, and decisions whose cited code evidence has drifted. Use for "review our decisions", "any conflicting decisions", "is our decision log consistent", "what decisions are stale".
allowed-tools: Bash, Read, AskUserQuestion
---

# review — keep the shared decision index coherent

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Procedure
1. `node "$ENG" conflicts "$ROOT"` (add `--json` to process programmatically). Item types:
   - **conflict** — an active/proposed decision `conflicts_with` another that is still active. Two
     developers diverged. Resolve: align them, or have one **supersede** the other.
   - **supersede-active** — a decision supersedes another, but the old one is still `active`. Flip the old
     one to `status: superseded`.
   - **dangling** — `supersedes`/`conflicts_with` points at an unknown id. Fix the reference.
   - **evidence-stale** — cited source file changed since the decision was recorded. Re-check the decision
     still holds; re-record if not.
   - **evidence-missing** — cited source file no longer exists. Update the evidence.
2. Also run `node "$ENG" validate "$ROOT"` to catch schema errors and **non-English** prose (the index
   must stay English).
3. For each item, propose a concrete resolution. For status flips / supersedes, drive it through
   `/thunder-mind:thunder-mind-record` (or edit the decision YAML under `.thunder/mind/decisions/` and
   re-run `build`).

## Note
Resolutions change committed files under `.thunder/mind/decisions/` — confirm with the user before
rewriting or flipping a decision that another developer authored.
