---
name: codemap
description: Explore and understand a Java/Spring Boot codebase token-minimally via thunder's pre-built YAML index (modules, contexts, endpoints, beans, JPA entities, business meaning). Use whenever the user asks how the app is structured, where something lives, what endpoints/services/entities exist, or what a module does — instead of reading .java files.
allowed-tools: Read, Bash, Grep
---

# codemap — comprendre la codebase sans la lire

thunder maintient un **index hiérarchique YAML** sous `<projet>/.claude/cache/thunder-java/`. Lis l'index,
**jamais les fichiers `.java`** tant que l'index répond. Le coût en tokens reste constant quelle que
soit la taille du repo.

## Règle d'or

> Charge le sommet → descends d'un cran → lis **un seul shard**. N'ouvre un `.java` que si l'index ne
> contient pas le détail précis demandé (un corps de méthode, par ex.).

## Workflow

1. **S'assurer que l'index existe** (le hook SessionStart le fait normalement). Sinon :
   `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" ensure "${CLAUDE_PROJECT_DIR}"`

2. **Sommet** — `Read .claude/cache/thunder-java/index.yaml` : liste des **modules** + compteurs (≈10 lignes).

3. **Drill-down module** — `Read .claude/cache/thunder-java/modules/<module>/_index.yaml` : une ligne par
   **contexte** (id, name, purpose, #endpoints).

4. **Shard contexte** — `Read .claude/cache/thunder-java/modules/<module>/<packages>.yaml` (chemin =
   convention `meta.shard_path`). Tu y trouves : types + signatures, endpoints (+intent), graphe de
   beans, entités JPA (+relations, +repository), use-cases, et la couche fonctionnelle (purpose,
   capabilities, business_rules).

## Vues directes (quand c'est plus rapide qu'un Read)

- Tous les endpoints : `Read .claude/cache/thunder-java/endpoints.yaml` (ou `thunder endpoints <root>`)
- Découverte « qui gère X ? » : `Grep` dans `capability-map.yaml` (fichier plat, grepable) — ne le
  charge pas en entier.
- Aperçu compteurs : `node "${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs" overview "${CLAUDE_PROJECT_DIR}"`

## Notes

- Un champ `functional_stale: true` dans un shard signale que le métier inféré peut être périmé →
  propose `/thunder-java:reindex`.
- Si `purpose` est `null`, la couche fonctionnelle n'a pas encore été inférée → `/thunder-java:reindex`.
- Pour un symbole précis (définition/références), utilise plutôt `/thunder-java:sym`.
