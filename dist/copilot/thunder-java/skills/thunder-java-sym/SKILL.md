---
name: thunder-java-sym
description: 'Precisely locate a Java symbol (class, interface, method) — its definition or its references/usages — from thunder''s index, without reading source files. Use when the user asks "where is X defined", "who uses/calls X", "find the X class/method".'
---

# sym — precise symbol lookup

Instead of `grep` + opening several files (expensive), query the thunder index, which returns
`file:line` + signature directly.

## Commands

```bash
ENG="${PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${PWD}"

# Definition of a type or method (exact name)
node "$ENG" sym def <Name> "$ROOT"

# References: types that mention <Name> in their signatures, fields, or extends/implements
node "$ENG" sym refs <Name> "$ROOT"
```

## Usage

1. Run `sym def` to locate the definition → you get `class/interface/method  file:line`.
2. Run `sym refs` for usages → a list of `Type  file:line`.
3. **Open the `.java` (Read with an offset on the line) only if the user needs the body** — otherwise the
   index signature is enough.

For fine semantic resolution (overloads, generics, deep inheritance), this is a known limit of static
lookup; flag it rather than guessing.
