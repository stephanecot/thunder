---
name: sym
description: Precisely locate a Java symbol (class, interface, method) — its definition or its references/usages — from thunder's index, without reading source files. Use when the user asks "where is X defined", "who uses/calls X", "find the X class/method".
allowed-tools: Bash, Read
---

# sym — lookup de symbole précis

Au lieu de `grep` + ouvrir plusieurs fichiers (coûteux), interroge l'index thunder qui renvoie
directement `fichier:ligne` + signature.

## Commandes

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${CLAUDE_PROJECT_DIR}"

# Définition d'un type ou d'une méthode (nom exact)
node "$ENG" sym def <Name> "$ROOT"

# Références : types qui mentionnent <Name> dans leurs signatures, champs ou extends/implements
node "$ENG" sym refs <Name> "$ROOT"
```

## Usage

1. Lance `sym def` pour situer la définition → tu obtiens `class/interface/method  fichier:ligne`.
2. Lance `sym refs` pour les usages → liste de `Type  fichier:ligne`.
3. **N'ouvre le `.java` (Read avec offset sur la ligne) que si l'utilisateur a besoin du corps** —
   sinon la signature de l'index suffit.

Pour une résolution sémantique fine (surcharges, génériques, héritage profond), c'est une limite connue
du lookup statique ; signale-le plutôt que de deviner.
