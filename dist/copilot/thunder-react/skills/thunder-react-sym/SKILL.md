---
name: thunder-react-sym
description: 'Precisely locate a React symbol (component, custom hook, class) — its definition or its references/usages — from thunder-react''s index, without reading source files. Use for "where is X defined", "who injects/uses X", "find the X component/hook".'
---

# thunder-react sym — precise symbol lookup

Instead of `grep` + opening files, query the index → it returns `file:line` + signature directly.

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${PWD}"

node "$ENG" sym def <Name> "$ROOT"    # definition of a class/component/hook/method
node "$ENG" sym refs <Name> "$ROOT"   # types referencing <Name> (deps, extends/implements, signatures, prop types)
```

`refs` catches dependency-injection usages (a component/hook whose constructor or `inject()` depends on
`<Name>`), `extends`/`implements`, method signatures and property types. Open a `.ts` file only when the
user needs the actual body — otherwise the index answer suffices.
