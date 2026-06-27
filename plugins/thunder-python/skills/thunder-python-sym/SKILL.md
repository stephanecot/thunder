---
name: thunder-python-sym
description: Precisely locate a Python symbol (class, function, method) — its definition or its references/usages — from thunder-python's index, without reading source files. Use when the user asks "where is X defined", "who uses/calls X", "find the X class/function".
allowed-tools: Bash, Read
---

# sym — precise symbol lookup

Instead of `grep` + opening several files (expensive), query the index → it returns `file:line` + signature.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"

node "$ENG" sym def <Name> "$ROOT"    # definition of a class / function / method (exact name)
node "$ENG" sym refs <Name> "$ROOT"   # types/functions referencing <Name> (bases, signatures, Depends)
```

`refs` catches base classes, method/function signatures and dependency-injection usages (`Depends(<Name>)`).
Open the `.py` (Read at the line) only if the user needs the actual body — otherwise the index answer
suffices. Dynamic dispatch (monkey-patching, `getattr`) is a known limit of static lookup; flag it rather
than guess.
