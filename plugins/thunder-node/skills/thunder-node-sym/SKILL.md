---
name: thunder-node-sym
description: Precisely locate a Node.js backend symbol (controller, service, class, method) — its definition or its references/usages — from thunder-node's index, without reading source files. Use for "where is X defined", "who injects/uses X", "find the X controller/service".
allowed-tools: Bash, Read
---

# thunder-node sym — precise symbol lookup

Instead of `grep` + opening files, query the index → it returns `file:line` + signature directly.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${CLAUDE_PROJECT_DIR}"

node "$ENG" sym def <Name> "$ROOT"    # definition of a class/controller/service/method
node "$ENG" sym refs <Name> "$ROOT"   # types referencing <Name> (deps, extends/implements, signatures, prop types)
```

`refs` catches dependency-injection usages (a controller/service whose constructor or `inject()` depends on
`<Name>`), `extends`/`implements`, method signatures and property types. Open a `.ts` file only when the
user needs the actual body — otherwise the index answer suffices.
