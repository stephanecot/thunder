---
name: reindex
description: Rebuild or refresh thunder's index of a Java/Spring project. Refreshes the technical layer (free, instant) and re-infers the FUNCTIONAL/business layer for stale contexts via the thunder-java-cartographer agent (costs tokens — budgeted and confirmed). Use when the user asks to (re)index, refresh the codemap, or after a large refactor. Args: empty = incremental, --full = rebuild everything, --tech = technical only.
allowed-tools: Bash, Task, AskUserQuestion
---

# reindex — tenir l'index à jour

Deux couches, deux régimes : la **technique** est gratuite et déterministe ; la **fonctionnelle** coûte
des tokens (inférence) → elle est **budgétée et jamais lancée en silence**.

```bash
ENG="${CLAUDE_PLUGIN_ROOT}/engine/thunder.mjs"
ROOT="${CLAUDE_PROJECT_DIR}"
```

## Modes (lis `$ARGUMENTS`)

- **`--tech`** : technique seul. `node "$ENG" build "$ROOT"`. Gratuit, instantané. **STOP ici.**
- **`--full`** : `node "$ENG" reset-functional "$ROOT"` (tout redevient à inférer), puis suis le flux ci-dessous.
- **(défaut)** : incrémental — suis le flux ci-dessous.

## Flux d'enrichissement fonctionnel

1. **Rafraîchir + lister le périmé** :
   ```bash
   node "$ENG" build "$ROOT" >/dev/null
   node "$ENG" stale --json "$ROOT"
   ```
   → tableau JSON `[{id, reason, hash}, …]`. Si **vide**, dis « couche fonctionnelle déjà à jour » et arrête.

2. **Budget & consentement** : budget par défaut = **10 contextes/run**. Si le nombre de contextes périmés
   dépasse le budget (ou semble coûteux), **demande confirmation** (AskUserQuestion) avant de continuer, en
   indiquant combien seront inférés. N'infère jamais des centaines de contextes sans accord explicite.

3. **Pour chaque contexte retenu** (jusqu'au budget) :
   a. Récupère l'evidence pack : `node "$ENG" evidence <id> "$ROOT"` (JSON sur stdout).
   b. Délègue au sous-agent **cartographer** (Task, `subagent_type: "thunder-java-cartographer"`) en lui passant ce JSON.
      Il renvoie **du JSON strict** (name, purpose, capabilities, business_rules, intents, glossary, confidence).
   c. Réinjecte : passe ce JSON sur stdin de
      `node "$ENG" set-functional <id> "$ROOT"`.
   - Tu peux traiter plusieurs contextes **en parallèle** (plusieurs Task en un seul message), plafonné à ~6.

4. **Rollup module** (rend `index.yaml` navigable fonctionnellement) :
   ```bash
   node "$ENG" stale-modules --json "$ROOT"
   ```
   Pour chaque module retourné : `node "$ENG" module-evidence <module> "$ROOT"` (JSON des purposes/capabilities
   de ses contextes) → délègue au **thunder-java-cartographer** (mode rollup → renvoie `{theme, keywords}` en **anglais**) →
   `node "$ENG" set-module-functional <module> "$ROOT"` (stdin). Ces appels sont petits (texte déjà inféré, pas
   de source) → traite-les en parallèle, plafonné.

5. **Synthèse** : indique combien de contextes et de modules ont été (ré)inférés, et ce qui reste périmé (si budget atteint).

> **Langue : tout le contenu écrit dans l'index (name, purpose, capabilities, business_rules, intents, theme,
> keywords) doit être en ANGLAIS.** Le thunder-java-cartographer s'en charge ; n'écris jamais de français dans l'index.

## Rappels

- Les `business_rules` du thunder-java-cartographer doivent **citer leur source** ; s'il renvoie du vide ou du non-JSON,
  refais l'appel une fois, sinon marque le contexte `confidence: low` et continue.
- Ne lis pas les `.java` toi-même ici : l'evidence pack contient déjà le source nécessaire.
