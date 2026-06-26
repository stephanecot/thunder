---
name: grok
description: Answer a question about what a Java/Spring codebase does or how it works (business or technical), token-minimally, using thunder's index and bounded fan-out. Use for "how does the auth work", "where is X handled", "what does the billing module do", "trace the flow of Y". Seeds sub-agents with index slices so they don't re-explore from scratch.
allowed-tools: Read, Grep, Bash, Task
---

# grok — répondre à une question sur la codebase

Objectif : répondre **juste** avec le **minimum de tokens**. On part de l'index (compact, déjà construit),
on ne lit du source que si nécessaire, et on délègue toute exploration large à des sous-agents **ensemencés**
avec la tranche d'index pertinente (ils ne ré-explorent pas à zéro).

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"; ROOT="${CLAUDE_PROJECT_DIR}"
```

## Procédure

1. **Cibler les contextes pertinents** (cheap discovery, sans tout charger) :
   - `Grep` les mots-clés métier de la question dans `.claude/cache/thunder-java/capability-map.yaml`
     et/ou `endpoints.yaml`.
   - `Read .claude/cache/thunder-java/index.yaml` pour situer le bon module.

2. **Charger les shards ciblés** : `Read` 1 à 3 shards de contexte (`modules/<m>/<pkg>.yaml`). Ils donnent
   types, endpoints (+intent), beans, entités, use-cases (flux dérivés) et la couche fonctionnelle. **Souvent
   suffisant pour répondre — n'ouvre rien d'autre.**

3. **Si (et seulement si) il faut le code réel** (un corps de méthode, une logique précise) :
   - Délègue à des sous-agents **`Explore`** (Task), **plafonnés à ~3-4 en parallèle**, en **donnant à chacun
     le shard pertinent + les `fichier:ligne` exacts** à inspecter. Ils renvoient une conclusion courte, pas
     des dumps. Leur contexte est jeté → le contexte principal reste propre.
   - Pour situer un symbole avant de déléguer : `node "$ENG" sym def <Name> "$ROOT"`.

4. **Synthétiser** : réponds avec des citations `fichier:ligne`. Distingue ce qui est **exact** (technique,
   issu de l'index) de ce qui est **inféré** (couche fonctionnelle, marquée `inferred`).

## Garde-fous (tokens)

- Ne lis jamais un module entier de `.java`. Préfère toujours shard → puis fan-out ciblé.
- Le coût du fan-out est réel (les sous-agents consomment des tokens) : plafonne, et n'en lance que si l'index
  ne suffit pas. Pour une question de pure structure, l'index seul répond.
- Si la couche fonctionnelle est absente (`purpose: null`) ou `functional_stale`, propose `/thunder-java:reindex`
  avant de répondre à une question franchement métier.
