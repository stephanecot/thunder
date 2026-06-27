---
name: reinstall
description: Internal maintainer skill for the Thunder repo. Explain and perform reinstallation of this project's plugins (thunder-java / -angular / -python / -node / -react) into the local Claude Code plugin cache so edits in the working tree take effect. Use when asked to (re)install a plugin, refresh after editing a plugin, or make a new version active in the session.
allowed-tools: Read, Bash
---

# reinstall — (re)install Thunder plugins from the working tree

Thunder is a **local-directory marketplace** named `thunder` pointing at this repo
(`~/.claude/plugins/known_marketplaces.json` → `{ source: directory, path: <repo> }`). Claude Code
installs each plugin from `./plugins/<name>` (source), but the **active copy lives in a version-keyed
cache** under `~/.claude/plugins/cache/thunder/<name>/<version>/`. Editing a plugin in the working tree
does NOT change the cached copy — you must reinstall.

## Two ways to reinstall

### A. Via the Claude Code UI (simplest, user-driven)
Tell the user to run, in the Claude prompt:
```
/plugin marketplace update thunder      # re-read the local marketplace.json
/plugin install thunder-<name>@thunder  # pick up the new version
```
(or `/plugin` → manage → update). They may need to reload the session for new skills to register.

### B. Manual cache refresh (what this skill does — scriptable, no prompt)
For each plugin to refresh: copy the source into the version-keyed cache and point
`installed_plugins.json` at it. Bump the plugin version first (so the cache path is new).

```bash
REPO="<repo root>"                       # /Users/.../dev/proto/thunder
CACHE="$HOME/.claude/plugins/cache/thunder"
SHA="$(git -C "$REPO" rev-parse HEAD)"
NOW="$(node -e 'console.log(new Date().toISOString())')"

for P in thunder-java thunder-angular thunder-python thunder-node thunder-react; do
  V="$(node -e "console.log(require('$REPO/plugins/$P/.claude-plugin/plugin.json').version)")"
  DST="$CACHE/$P/$V"
  rm -rf "$DST"; mkdir -p "$DST"
  rsync -a --exclude '.claude/cache' --exclude 'demo/.claude' \
        --exclude 'ngdemo' --exclude 'bigdemo' --exclude 'realdemo' --exclude 'pydemo' \
        --exclude 'nodedemo' --exclude 'reactdemo' \
        "$REPO/plugins/$P/" "$DST/"
  node -e '
    const fs=require("fs"), p=process.env.HOME+"/.claude/plugins/installed_plugins.json";
    const j=JSON.parse(fs.readFileSync(p,"utf8")); const k=process.argv[1]+"@thunder";
    j.plugins[k] = j.plugins[k] || [{scope:"user"}];
    const e=j.plugins[k][0];
    e.installPath=process.env.CACHE+"/"+process.argv[1]+"/"+process.argv[2];
    e.version=process.argv[2]; e.lastUpdated=process.env.NOW; e.gitCommitSha=process.env.SHA;
    fs.writeFileSync(p, JSON.stringify(j,null,2));
  ' "$P" "$V"
  echo "installed $P $V"
done
```

## Verify
```bash
node -e 'const j=require(process.env.HOME+"/.claude/plugins/installed_plugins.json");
for(const k of Object.keys(j.plugins)) if(/thunder-/.test(k)) console.log(k, j.plugins[k][0].version)'
```
The printed versions must match `marketplace.json`. New skills only become invocable after the session
picks them up (the manual method updates the cache immediately; a UI install + reload is the safe path
for skill registration).

## Notes
- Always **bump the version** in `plugins/<name>/.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`
  before reinstalling — the cache is keyed by version, so same-version reinstalls can be ignored.
- Exclude generated dirs (caches, demo `.claude`, synthetic `*demo/`) from the copy — they are large and
  regenerated on first use.
- This refreshes the **Claude** install. `dist/` (Copilot variant) is separate: `node build.mjs` regenerates it.
