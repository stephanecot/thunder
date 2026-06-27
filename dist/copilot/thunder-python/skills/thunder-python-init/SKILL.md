---
name: thunder-python-init
description: 'Opt this project IN to thunder-python and build its first index. This is the MANDATORY one-time setup — until it is run, thunder-python stays completely idle on the project (no directories, no tokens). Creates the committed marker `.thunder/python/config.yaml`, builds the technical index, and points you at reindex for the functional layer. Use when the user first wants to index a Python (FastAPI / Flask / Django / plain) project, or asks to "set up / enable / init thunder here".'
---

# init — enable thunder-python for this project (one-time, opt-in)

thunder-python does **nothing** on a project until it is explicitly initialized here. This is by design:
a developer with the plugin installed can open any repo and thunder-python stays idle — no `.thunder/`
directory, no token spend — unless they opt that project in. `init` is that opt-in.

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${PWD}"
node "$ENG" init "$ROOT"
```

What it does:
1. Writes the **committed** marker `.thunder/python/config.yaml` (`enabled: true`). Its presence is what
   turns the SessionStart/edit hooks on — so once you **commit** it, every teammate's thunder-python
   keeps the shared index fresh automatically (and it stays off on repos that never ran `init`).
2. Builds the **technical** index under `.thunder/python/` (exact, free, instant).

If there are no Python (FastAPI / Flask / Django / plain) sources yet, it still initializes and reports that the index will fill in as you
add code.

## After init

The technical layer is ready. To also infer the **functional / business** layer (costs tokens, via the
cartographer agent), run:

```
/thunder-python-reindex
```

Then **commit `.thunder/python/`** so the whole team shares one index and never re-spends tokens
re-inferring it. (Per-developer volatile files — `cache.ndjson`, `manifest.json`, `dirty.list`,
`qa-ledger.ndjson`, `.config` — are gitignored automatically.)

> To make thunder-python idle again on this project, delete `.thunder/python/` (including
> `config.yaml`). With the marker gone, the hooks no-op here.
