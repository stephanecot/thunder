# Thunder ⚡ — `dist/` (généré, ne pas éditer)

Sortie de `../build.mjs`. **Source unique = `../plugins/<name>`** (plugins Claude authored).
Régénère : `node build.mjs` (les 2 hôtes) ou `node build.mjs thunder-python` (un plugin).
L'`engine/` est **symlinké** vers `../plugins/<name>/engine` → une seule copie réelle.

## Marketplaces (à la racine du repo, pas dans dist/)

```
<repo>/.claude-plugin/marketplace.json   → ./plugins/<name>        (Claude, source)
<repo>/.github/plugin/marketplace.json   → ./dist/copilot/<name>   (Copilot, généré)
dist/
  claude/<name>/    (format Claude inchangé — mirror construit)
  copilot/<name>/   (format Copilot dérivé — servi par le marketplace racine)
```

## Installer

```bash
# GitHub Copilot CLI (depuis la racine du repo)
node build.mjs
copilot plugin marketplace add .          # lit .github/plugin/marketplace.json
copilot plugin install thunder-python     # idem thunder-java / thunder-angular

# Claude Code
/plugin marketplace add stephanecot/thunder
/plugin install thunder-python@thunder
```

## Ce que le build dérive pour Copilot (tout le reste est identique)

| | Claude | Copilot |
|---|---|---|
| Token plugin | `${CLAUDE_PLUGIN_ROOT}` | `${PLUGIN_ROOT}` |
| Token projet | `${CLAUDE_PROJECT_DIR}` | `${PWD}` |
| Hooks | `hooks/hooks.json` PascalCase + `matcher` + `timeout` | `hooks.json` racine, `version:1`, camelCase, `timeoutSec`, sans matcher |
| Agent | `agents/x.md` (`model:`, `tools:`) | `agents/x.agent.md` (sans `model`/`tools`) |
| Skill frontmatter | `name`, `description`, `allowed-tools` | `name`, `description` (single-quotée), sans `allowed-tools` |
| Manifest | `.claude-plugin/plugin.json` | `plugin.json` racine |
| Délégation | `Task` + `subagent_type:` | `@agent` |
| Cross-ref skill | `/plugin:skill` | `/skill` |

> ⚠️ Si un install **déplace** les fichiers hors du repo, le symlink `engine` (relatif) casse.
