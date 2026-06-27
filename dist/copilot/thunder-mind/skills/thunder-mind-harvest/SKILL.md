---
name: thunder-mind-harvest
description: 'Review the current conversation or a diff/PR and extract the project decisions worth recording into the shared thunder-mind index, then capture the confirmed ones. Use at the end of a working session or after a PR — "harvest decisions from this session", "what did we decide that we should record", "capture decisions from this PR".'
---

# harvest — capture decisions made during a session / PR

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${PWD}"
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
5. **Record each retained one** via the `/thunder-mind-record` flow (scribe → `add`),
   one decision per file.
6. **Summarize**: which decisions were recorded (with ids), which superseded, which were skipped.

## Rules
- English-only index (the scribe handles translation).
- Prefer fewer, higher-signal decisions over noise. A decision is worth recording if a second developer
  starting fresh would otherwise re-litigate or contradict it.
