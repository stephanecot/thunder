---
name: thunder-mind-harvest
description: Review the current conversation or a diff/PR and extract the project decisions worth recording into the shared thunder-mind index, then capture the confirmed ones. Use at the end of a working session or after a PR — "harvest decisions from this session", "what did we decide that we should record", "capture decisions from this PR".
allowed-tools: Bash, Task, AskUserQuestion
---

# harvest — capture decisions made during a session / PR

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Procedure
1. **Scan the source of decisions**:
   - the current conversation (architectural/technical/functional choices that were actually made), or
   - a diff: `git diff <base>...HEAD` / a PR description.
2. **Extract candidates.** For each genuine decision, draft a one-line summary + why. Ignore transient
   chatter, questions, and things that didn't get decided.
3. **Dedup against the index.** For each candidate: `node "$ENG" recall "<keywords>" "$ROOT"`. Drop
   candidates already covered by an active decision; mark ones that **supersede** an existing decision.
4. **Confirm with the user** (AskUserQuestion or a short list): present the candidate decisions and let
   the user pick which to record. **Never write without confirmation.**
5. **Normalize ALL retained candidates in ONE scribe call** (batch mode — do NOT spawn one scribe per
   decision; one sub-agent boot is ~10k tokens). Delegate once to **thunder-mind-scribe** (Task,
   `subagent_type: "thunder-mind-scribe"`) with:
   ```json
   { "candidates": [ {"key": "c1", "raw": "<decision + why>"}, … ],
     "related_decisions": [ <the recall cards from step 3> ], "today": "<YYYY-MM-DD>" }
   ```
   It returns a JSON array (one element per candidate, `key` echoed, `skip: true` for non-decisions).
6. **Write each one**: `echo '<element JSON>' | node "$ENG" add "$ROOT" --date "<YYYY-MM-DD>"`
   (the author defaults to `git config user.name`). Handle `add` refusals as in record (supersede or align).
7. **Summarize**: which decisions were recorded (with ids), which superseded, which were skipped.

## Rules
- English-only index (the scribe handles translation).
- Prefer fewer, higher-signal decisions over noise. A decision is worth recording if a second developer
  starting fresh would otherwise re-litigate or contradict it.
