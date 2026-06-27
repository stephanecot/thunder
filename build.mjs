#!/usr/bin/env node
// Build distributable Thunder ⚡ marketplaces for BOTH hosts from a single source.
//
//   source of truth : plugins/<name>   (Claude Code plugins — the marketplace points here, untouched)
//   output          : dist/claude/<name>   + dist/claude/.claude-plugin/marketplace.json
//                     dist/copilot/<name>  + dist/copilot/.github/plugin/marketplace.json
//
// Each dist/<host> is a self-contained, installable marketplace. Authored content
// (skills, agents, hooks scripts) is assembled/derived — never hand-edited — and the
// engine/ is SYMLINKED into every output, so there is exactly one real copy of the code.
//
// Host differences are mechanical:
//   ${CLAUDE_PLUGIN_ROOT}→${PLUGIN_ROOT}, ${CLAUDE_PROJECT_DIR}→${PWD},
//   /<plugin>:<skill>→/<skill>, Task+subagent_type→@agent,
//   agents/x.md→agents/x.agent.md (no model:), hooks/hooks.json (PascalCase+matcher)
//   →hooks.json root (camelCase+timeoutSec), manifest .claude-plugin/→root.
//
// Usage: node build.mjs [pluginName ...]   (default: every plugins/thunder-*)

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync,
  existsSync, symlinkSync, statSync, cpSync,
} from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(REPO, 'plugins');
const DIST = join(REPO, 'dist');
const SRC_MARKETPLACE = join(REPO, '.claude-plugin', 'marketplace.json');

// dirs that are dev fixtures / build output, never part of a shipped plugin
const EXCLUDE = new Set([
  'engine', 'node_modules', '.git', 'target',
  'demo', 'pydemo', 'ngdemo', 'shop', 'bigdemo', 'realdemo',
]);

const writeFile = (p, content) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};
const writeJson = (p, obj) => writeFile(p, JSON.stringify(obj, null, 2) + '\n');

// engine lives once (in plugins/<name>); symlink it into every output
function linkEngine(outPluginDir, pluginName) {
  symlinkSync(relative(outPluginDir, join(PLUGINS_DIR, pluginName, 'engine')),
    join(outPluginDir, 'engine'), 'dir');
}

// ============================ shared text transforms (Copilot) ============================

function neutralizeBody(text, pluginName) {
  return text
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}')
    .replaceAll('${CLAUDE_PROJECT_DIR}', '${PWD}')
    .replaceAll(`/${pluginName}:`, '/')                              // /plugin:skill -> /skill
    .replace(/\(Task,\s*`subagent_type:\s*"([^"]+)"`\)/g, '(the @$1 agent)')
    .replaceAll('subagent_type:', 'agent:');
}
function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: '', body: text };
}
// Copilot SKILL.md / .agent.md frontmatter: only `name` + `description` are recognized.
// Drop host-specific keys (Claude `allowed-tools`, the agent's Claude-named `tools: Read`,
// `model: haiku` which isn't a Copilot model id) and SINGLE-QUOTE `description` — thunder
// descriptions embed `: ` (e.g. "Args: empty = …") which breaks a standard YAML parser unquoted.
function renderFrontmatter(fm, dropKeys) {
  const drop = new Set(dropKeys);
  const out = [];
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!m) { out.push(line); continue; }                 // pass through (e.g. nested blocks)
    const [, key, raw] = m;
    if (drop.has(key)) continue;
    let v = raw;
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    out.push(key === 'description' ? `description: '${v.replace(/'/g, "''")}'` : `${key}: ${v}`);
  }
  return out.join('\n');
}
function transformSkill(text, pluginName) {
  const { fm, body } = splitFrontmatter(text);
  return `---\n${renderFrontmatter(fm, ['allowed-tools'])}\n---\n${neutralizeBody(body, pluginName)}`;
}
function transformAgent(text, pluginName) {
  const { fm, body } = splitFrontmatter(text);
  return `---\n${renderFrontmatter(fm, ['model', 'tools'])}\n---\n${neutralizeBody(body, pluginName)}`;
}
// widen the edited-file extraction so the (otherwise host-neutral) hook reads Copilot payloads too
function transformHookScript(text) {
  return text.replace(
    'const file = payload?.tool_input?.file_path;',
    'const ti = payload?.tool_input || payload?.toolInput || {};\n' +
    '  const file = ti.file_path || ti.filePath || ti.path || ti.file;',
  );
}
function copilotHooks() {
  return {
    version: 1,
    hooks: {
      sessionStart: [{ type: 'command',
        command: `node "\${PLUGIN_ROOT}/engine/thunder.mjs" ensure "\${PWD}"`, timeoutSec: 60 }],
      postToolUse: [{ type: 'command',
        command: `node "\${PLUGIN_ROOT}/hooks/hook.mjs"`, timeoutSec: 15 }],
    },
  };
}

// ============================ per-host plugin assembly ============================

function buildClaude(pluginName) {
  const src = join(PLUGINS_DIR, pluginName);
  const out = join(DIST, 'claude', pluginName);
  rmSync(out, { recursive: true, force: true });
  // copy the authored plugin verbatim (it already IS Claude format), minus engine & fixtures
  cpSync(src, out, { recursive: true,
    filter: (s) => !EXCLUDE.has(basename(s)) });
  linkEngine(out, pluginName);
}

function buildCopilot(pluginName) {
  const src = join(PLUGINS_DIR, pluginName);
  const out = join(DIST, 'copilot', pluginName);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // manifest -> root plugin.json
  const pkg = JSON.parse(readFileSync(join(src, '.claude-plugin', 'plugin.json'), 'utf8'));
  const manifest = { name: pkg.name, description: pkg.description, version: pkg.version };
  for (const k of ['author', 'license', 'keywords']) if (pkg[k]) manifest[k] = pkg[k];
  writeJson(join(out, 'plugin.json'), manifest);

  // skills (format shared, body neutralized)
  const skillsDir = join(src, 'skills');
  for (const s of (existsSync(skillsDir) ? readdirSync(skillsDir) : [])) {
    const f = join(skillsDir, s, 'SKILL.md');
    if (existsSync(f)) writeFile(join(out, 'skills', s, 'SKILL.md'),
      transformSkill(readFileSync(f, 'utf8'), pluginName));
  }

  // agents (x.md -> x.agent.md)
  const agentsDir = join(src, 'agents');
  for (const a of (existsSync(agentsDir) ? readdirSync(agentsDir) : []).filter((f) => f.endsWith('.md'))) {
    writeFile(join(out, 'agents', basename(a, '.md') + '.agent.md'),
      transformAgent(readFileSync(join(agentsDir, a), 'utf8'), pluginName));
  }

  // hooks (root hooks.json + relocated, widened hook.mjs)
  if (existsSync(join(src, 'hooks', 'hooks.json'))) writeJson(join(out, 'hooks.json'), copilotHooks());
  if (existsSync(join(src, 'hooks', 'hook.mjs'))) writeFile(join(out, 'hooks', 'hook.mjs'),
    transformHookScript(readFileSync(join(src, 'hooks', 'hook.mjs'), 'utf8')));

  linkEngine(out, pluginName);
}

// ============================ marketplaces ============================

// reuse the root Claude marketplace metadata, keep only built plugins, rewrite each `source`
function marketplaceWithSources(builtNames, sourceFn) {
  const m = JSON.parse(readFileSync(SRC_MARKETPLACE, 'utf8'));
  return {
    ...m,
    plugins: m.plugins
      .filter((p) => builtNames.has(p.name))
      .map((p) => ({ ...p, source: sourceFn(p.name) })),
  };
}

// ============================ main ============================

const all = readdirSync(PLUGINS_DIR).filter((d) =>
  statSync(join(PLUGINS_DIR, d)).isDirectory()
  && existsSync(join(PLUGINS_DIR, d, '.claude-plugin', 'plugin.json')));
const requested = process.argv.slice(2);
const targets = (requested.length ? requested : all).filter((n) => all.includes(n));

rmSync(DIST, { recursive: true, force: true });
console.log('build → dist/{claude,copilot}/');
for (const name of targets) {
  buildClaude(name);
  buildCopilot(name);
  console.log(`  ✓ ${name}`);
}

// Copilot marketplace at the PROJECT ROOT (GitHub-canonical .github/plugin/, the exact
// counterpart of the root .claude-plugin/marketplace.json), pointing into dist/copilot.
const built = new Set(targets);
writeJson(join(REPO, '.github', 'plugin', 'marketplace.json'),
  marketplaceWithSources(built, (n) => `./dist/copilot/${n}`));
console.log(`  ✓ .github/plugin/marketplace.json (copilot, repo root) → ./dist/copilot/<name>`);
// Note: the Claude marketplace stays the existing root .claude-plugin/marketplace.json (→ ./plugins).

// dist/README — regenerated each build (dist is wiped on every run)
writeFile(join(DIST, 'README.md'), `# Thunder ⚡ — \`dist/\` (généré, ne pas éditer)

Sortie de \`../build.mjs\`. **Source unique = \`../plugins/<name>\`** (plugins Claude authored).
Régénère : \`node build.mjs\` (les 2 hôtes) ou \`node build.mjs thunder-python\` (un plugin).
L'\`engine/\` est **symlinké** vers \`../plugins/<name>/engine\` → une seule copie réelle.

## Marketplaces (à la racine du repo, pas dans dist/)

\`\`\`
<repo>/.claude-plugin/marketplace.json   → ./plugins/<name>        (Claude, source)
<repo>/.github/plugin/marketplace.json   → ./dist/copilot/<name>   (Copilot, généré)
dist/
  claude/<name>/    (format Claude inchangé — mirror construit)
  copilot/<name>/   (format Copilot dérivé — servi par le marketplace racine)
\`\`\`

## Installer

\`\`\`bash
# GitHub Copilot CLI (depuis la racine du repo)
node build.mjs
copilot plugin marketplace add .          # lit .github/plugin/marketplace.json
copilot plugin install thunder-python     # idem thunder-java / thunder-angular

# Claude Code
/plugin marketplace add stephanecot/thunder
/plugin install thunder-python@thunder
\`\`\`

## Ce que le build dérive pour Copilot (tout le reste est identique)

| | Claude | Copilot |
|---|---|---|
| Token plugin | \`\${CLAUDE_PLUGIN_ROOT}\` | \`\${PLUGIN_ROOT}\` |
| Token projet | \`\${CLAUDE_PROJECT_DIR}\` | \`\${PWD}\` |
| Hooks | \`hooks/hooks.json\` PascalCase + \`matcher\` + \`timeout\` | \`hooks.json\` racine, \`version:1\`, camelCase, \`timeoutSec\`, sans matcher |
| Agent | \`agents/x.md\` (\`model:\`, \`tools:\`) | \`agents/x.agent.md\` (sans \`model\`/\`tools\`) |
| Skill frontmatter | \`name\`, \`description\`, \`allowed-tools\` | \`name\`, \`description\` (single-quotée), sans \`allowed-tools\` |
| Manifest | \`.claude-plugin/plugin.json\` | \`plugin.json\` racine |
| Délégation | \`Task\` + \`subagent_type:\` | \`@agent\` |
| Cross-ref skill | \`/plugin:skill\` | \`/skill\` |

> ⚠️ Si un install **déplace** les fichiers hors du repo, le symlink \`engine\` (relatif) casse.
`);
console.log(`  ✓ dist/README.md`);
