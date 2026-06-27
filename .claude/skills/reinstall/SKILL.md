---
name: reinstall
description: Internal maintainer skill for the Thunder repo. Explain and perform (re)installation of this project's plugins (thunder-java / -angular / -python / -node / -react / -mind) into the local Claude Code config so working-tree edits take effect AND the plugins are actually visible. Use when asked to (re)install a plugin, refresh after editing, or when a plugin "doesn't show up" after reloading.
allowed-tools: Read, Bash, Edit
---

# reinstall — (re)install Thunder plugins from the working tree

Thunder is a **local-directory marketplace** named `thunder` pointing at this repo. For a plugin to be
**visible and usable** in a session, THREE things must agree — miss any one and it silently won't appear:

1. **Cached copy** — `~/.claude/plugins/cache/thunder/<name>/<version>/` holds the active files.
2. **Installed record** — `~/.claude/plugins/installed_plugins.json` → `"<name>@thunder"` points at that path/version.
3. **Enabled flag** — `~/.claude/settings.json` → `enabledPlugins["<name>@thunder"] = true`. ← **this is the
   one most often missing** (a plugin can be installed but disabled → never loads).

Then **reload the session**: Claude Code reads `settings.json` + `installed_plugins.json` **at startup**, so
newly installed/enabled plugins only register after a reload (new window or restart).

> Symptom "I reinstalled but don't see it" = almost always step 3 (not in `enabledPlugins`) or no reload.

## A. Via the Claude Code UI (user-driven)
Have the user run in the Claude prompt, then reload:
```
/plugin marketplace update thunder        # re-read the local marketplace.json
/plugin install thunder-<name>@thunder    # installs + enables + caches
```

## B. Scriptable refresh (what this skill does) — all three steps + verify
```bash
REPO="<repo root>"                                  # e.g. /Users/.../dev/proto/thunder
CACHE="$HOME/.claude/plugins/cache/thunder"
SETTINGS="$HOME/.claude/settings.json"
INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
export CACHE SHA="$(git -C "$REPO" rev-parse HEAD)" NOW="$(node -e 'console.log(new Date().toISOString())')"

for P in thunder-java thunder-angular thunder-python thunder-node thunder-react thunder-mind; do
  V="$(node -e "console.log(require('$REPO/plugins/$P/.claude-plugin/plugin.json').version)")"
  DST="$CACHE/$P/$V"; rm -rf "$DST"; mkdir -p "$DST"
  # 1. cache copy (exclude generated dirs: caches + hand demos' caches + synthetic *demo/ beds)
  rsync -a --exclude '.claude/cache' --exclude 'demo/.claude' \
        --exclude 'ngdemo' --exclude 'bigdemo' --exclude 'realdemo' --exclude 'pydemo' \
        --exclude 'nodedemo' --exclude 'reactdemo' --exclude 'minddemo' --exclude 'minddemo-big' \
        "$REPO/plugins/$P/" "$DST/"
  # 2. installed record  +  3. enabled flag
  node -e '
    const fs=require("fs"); const [P,V]=process.argv.slice(1); const k=P+"@thunder";
    const inst=JSON.parse(fs.readFileSync(process.env.INSTALLED,"utf8"));
    inst.plugins[k]=inst.plugins[k]||[{scope:"user"}]; const e=inst.plugins[k][0];
    e.installPath=process.env.CACHE+"/"+P+"/"+V; e.version=V;
    e.lastUpdated=process.env.NOW; e.gitCommitSha=process.env.SHA;
    fs.writeFileSync(process.env.INSTALLED, JSON.stringify(inst,null,2));
    const set=JSON.parse(fs.readFileSync(process.env.SETTINGS,"utf8"));
    set.enabledPlugins=set.enabledPlugins||{}; set.enabledPlugins[k]=true;       // ← the key step
    fs.writeFileSync(process.env.SETTINGS, JSON.stringify(set,null,2));
  ' "$P" "$V"
  echo "installed + enabled $P $V"
done
# keep the marketplace catalog fresh so the /plugin UI lists the new versions
node -e 'const fs=require("fs"),p=process.env.HOME+"/.claude/plugins/known_marketplaces.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));if(j.thunder){j.thunder.lastUpdated=process.env.NOW;fs.writeFileSync(p,JSON.stringify(j,null,2));}'
```
(Use the `Edit` tool on `settings.json` if you prefer a reviewable diff over the in-place node write.)

## Verify (all three must line up for every plugin)
```bash
node -e '
const s=require(process.env.HOME+"/.claude/settings.json").enabledPlugins||{};
const i=require(process.env.HOME+"/.claude/plugins/installed_plugins.json").plugins;
for(const p of ["java","angular","python","node","react","mind"]){const k="thunder-"+p+"@thunder";
  console.log("thunder-"+p.padEnd(8),"enabled="+(!!s[k]),"installed="+(!!i[k]),(s[k]&&i[k])?"OK":"MISSING")}'
```
Then **tell the user to reload the session** — that is when the skills actually register.

## Notes
- **Bump the version** in `plugins/<name>/.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`
  before reinstalling — the cache is keyed by version; a same-version reinstall may be ignored.
- "Installed but not visible" → check `enabledPlugins[<name>@thunder]` is `true`, then reload.
- This refreshes the **Claude** install. `dist/` (Copilot variant) is separate: `node build.mjs` regenerates it.
