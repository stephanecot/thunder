# Thunder — Spec de conception

Plugin Claude Code pour la **compréhension / exploration / manipulation** d'une codebase
Java/Spring Boot par IA, optimisé **tokens-minimum**.

> Principe directeur : *le token le moins cher est celui qu'on ne lit jamais.*
> On remplace « lire des fichiers » par « interroger des index compacts », et on délègue
> toute exploration large à des sous-agents jetables dont seul le résultat remonte.

## Contraintes non-négociables

- **Moteur** : Node.js pur, **zéro dépendance npm** (stdlib only : `fs`, `path`, `crypto`, `worker_threads`, `node:test`).
- **Cross-platform** : Windows / Linux / macOS (chemins via `path`, hooks en `node "<abs>"`).
- **Index consommé par le modèle** : YAML (≈15–30 % de tokens en moins que JSON, lisible).
- **Priorité** : tokens-minimum (la latence et la précision absolue passent après).
- **Échelle cible** : plusieurs milliers de fichiers `.java`, mono ou multi-module Maven, même repo.
- **Langue de l'index** : **tout le contenu écrit dans l'index est en ANGLAIS** (name, purpose,
  capabilities, business_rules, intents, theme, keywords), quelle que soit la langue du code source.
  Index cohérent et neutre. (Les *instructions* des skills peuvent rester en français ; c'est le
  *contenu produit* qui est anglais.)

## Index à deux couches

| Couche | Produite par | Coût | Exactitude |
|---|---|---|---|
| **Technique** | parse Node déterministe | ~0 token, ~ms | exacte |
| **Fonctionnelle (riche)** | agent `cartographer` (Haiku), inféré | tokens, borné | inférée, auditée |

La couche technique inclut les **règles métier déductibles** (`@Min`, `@NotNull`, `unique`, `@Valid`)
et les **flux use-case dérivés** du graphe d'appels/beans (déterministes — le modèle ne fait que les nommer).
La couche fonctionnelle riche ajoute : `purpose`, `capabilities`, `business_rules` (avec citation de source),
`intent` d'endpoint, `glossary`, et le regroupement en bounded-contexts.

Les deux couches vivent dans le **même YAML émis**, fusionnées. Champs inférés marqués `inferred`
(auditables). Péremption : voir *Staleness* plus bas.

## Source de vérité vs vue émise

Pour éviter de hand-roller un parseur YAML fragile (signatures pleines de `: < > , ( )`) :

- **Source de vérité = `cache.ndjson`** (un record JSON par fichier). `JSON.parse/stringify` = stdlib,
  round-trip blindé, streaming ligne-à-ligne, seuls les records changés réécrits. **Cache moteur interne,
  invisible, gitignoré.**
- **Index = `*.yaml` émis** depuis le cache. Le moteur **écrit** du YAML, ne le **relit jamais**.
  Émetteur qui quote systématiquement tout scalaire à caractère spécial → YAML sûr, golden-testable.

> « L'index est en YAML » : ce que le **modèle consomme** est du YAML. Le NDJSON est un détail moteur.

## Index hiérarchique shardé

Jamais un seul fichier monolithique. Hiérarchie **modules Maven → bounded-contexts → fichiers**,
profondeur **adaptative** (auto-détection : plusieurs `pom.xml` → modules ; un seul → packages racine).

```
.claude/cache/thunder-java/
  index.yaml            # SOMMET : modules + contextes + 1 ligne chacun + compteurs (toujours petit)
  capability-map.yaml   # 1 ligne/contexte, plat, GREPABLE sans chargement (aide à la découverte)
  modules/
    <module>/
      <context>.yaml    # 1 fichier par bounded-context : types, endpoints, couche fonctionnelle
  endpoints.yaml        # table globale (souvent requêtée entière)
  cache.ndjson          # SOURCE DE VÉRITÉ interne (per-file facts) — non lu par le modèle
  manifest.yaml         # fichier → {hash, shard, parse_error?}  (incrémental + visibilité erreurs)
  dirty.list            # file d'attente des fichiers à re-parser (alimentée par le hook)
```

**Rollup fonctionnel à chaque palier** : le fonctionnel n'est pas que dans les shards. Chaque niveau
de la hiérarchie porte une dimension métier, pour qu'une question fonctionnelle se route de haut en bas :
- `index.yaml` → chaque **module** a un `theme` (inféré, anglais) + `keywords` (déterministes, grepables) ;
- `modules/<m>/_index.yaml` → chaque **contexte** a son `purpose` ;
- `capability-map.yaml` → `purpose` + `capabilities` par contexte, **plat et grepable** (découverte) ;
- shard → couche fonctionnelle complète.

Le `theme` module se ré-infère (via reindex) quand le `context_hash` du module change ; les `keywords`
ont un repli déterministe (agrégation des termes des contextes) à coût zéro.

**Conséquence tokens** : le modèle charge `index.yaml` (minuscule) → repère le module par son thème →
le contexte par son purpose → ne charge que son shard. Coût en tokens **~constant pour une requête ciblée**.
Pour la **découverte** (« qui gère X ? »), le coût scale avec la largeur — mitigé par
`capability-map.yaml` grepable (un grep sur petit fichier, pas un scan modèle) et le plafonnement du fan-out.

### Exemple de shard de contexte

```yaml
context:
  id: user-service/com.demo.user        # ID DÉTERMINISTE (module + packages triés) — stable
  name: "Gestion des utilisateurs"      # label (overlay, éditable, n'invalide pas le cache)
  module: user-service
  packages: [com.demo.user]
  purpose: "Cycle de vie des comptes utilisateurs"        # fonctionnel (inferred)
  evidence_hash: e9f1                                      # hash des régions lues par le cartographer
  capabilities: ["Inscription", "Mise à jour profil"]     # fonctionnel riche (inferred)
  business_rules:                                          # règle + citation vérifiable
    - {rule: "Email unique", src: "User.java:31 @Column(unique=true)"}
    - {rule: "Âge ≥ 18", src: "UserService.java:42 @Min(18)"}
  use_cases:                                               # FLUX DÉRIVÉ (technique), nommé par le modèle
    - {name: "Inscrire un utilisateur",
       flow: "POST /users → UserController.create → UserService.register → UserRepository.save"}
  types:                                                   # technique exact
    - {k: class, n: UserService, ann: ["@Service"], l: 18,
       methods: [{n: register, sig: "(UserDto):User", l: 34}]}
  endpoints:
    - {verb: POST, path: /users, fn: UserController.create,
       intent: "Inscrire un nouvel utilisateur"}           # intent inferred
  beans: {UserService: {deps: [UserRepository], type: "@Service"}}
  entities: {User: {table: users, rel: [{OneToMany: Order}], repo: UserRepository}}
```

## Pipeline de build (étages à responsabilité unique)

```
WALK (sûr) → LEX (neutralise) → PARSE (local, incrémental) → cache.ndjson  [vérité]
                                                                   │
                              DERIVE (global, en mémoire) ─────────┤  flux / beans / entités / contextes
                                                                   │
                              EMIT (shards YAML changés) ──────────┘  ← ce que lit le modèle
                                                                   │
         FUNCTIONAL (explicite, budgété, evidence-pack) ──────────┘  ← cartographer Haiku, evidence-hash
```

1. **WALK** (sûr) : respect `.gitignore` + exclusions (`target/`, `build/`, généré) ; skip fichiers
   > taille cap (défaut 2 Mo) et binaires (sniff NUL) ; pas de symlink hors racine (realpath).
2. **LEX** : machine à états caractère neutralisant commentaires / strings / char / **text blocks `"""`**
   (numéros de ligne préservés). Le scan structurel tourne sur le flux nettoyé → comptage d'accolades fiable.
3. **PARSE** (incrémental) : ne lexe/parse **que les fichiers changés** (hash) → facts **locaux** dans
   `cache.ndjson`. `try/catch` par fichier → erreur ⇒ `parse_error` dans le manifeste (visible, pas de crash).
4. **DERIVE** (global, en mémoire, depuis tout le cache) : recalcule le **cross-fichiers** (graphe beans,
   entité↔repo, endpoints, **flux use-case**, appartenance contexte). Bon marché (jointures sur JSON parsé).
5. **EMIT** : ré-émet **uniquement** les shards dont les octets changent (hash par shard dans le manifeste).
6. **FUNCTIONAL** (étage séparé, explicite) : voir plus bas.

**Performance gros repo** : `worker_threads` (pool calé CPU) pour le PARSE du build initial ;
incrémental ensuite (un build quotidien touche ~3 fichiers). DERIVE = quelques secondes max sur des milliers
de fichiers ; scopable aux modules affectés si jamais nécessaire.

## Couche fonctionnelle

- **Paresseuse** : un contexte n'est inféré qu'au premier accès, ou via `/reindex`.
- **Budgétée** : `/reindex` infère les N contextes les plus périmés par run (loop-until-budget), pas tout ;
  affiche **estimation + demande confirmation** sous le seuil configuré. **Jamais déclenchée par un hook.**
- **Parallèle plafonnée** : un `cartographer` par contexte, cap concurrent (`max_parallel_cartographers`).
- **Ancrée (anti-hallucination)** : evidence pack obligatoire (signatures + corps ciblés : validations,
  contrôleurs, config). Flux **dérivés techniquement**, jamais inventés. Chaque règle **cite sa source** ;
  le moteur vérifie que la ligne citée existe → sinon `confidence: low`.

## Staleness (péremption)

| Couche | Clé de péremption |
|---|---|
| Technique | hash de contenu du fichier (`manifest.yaml`) |
| Fonctionnelle | **`evidence_hash`** = hash du contenu **exact** des régions fournies au cartographer |

Ainsi un changement de corps (ex. seuil `18→21`) lu comme evidence ⇒ ré-inférence ;
un commentaire ailleurs ⇒ pas de ré-inférence.

## Découpage en contextes (hybride stable)

- **Frontières déterministes** : package/module (profondeur configurable) → `id` = hash de l'ensemble de
  packages trié. **Stable**, reproductible, noms de shards jamais issus du modèle.
- **Overlay persisté** : fusions/splits du modèle dans **`thunder.contexts.yaml`** (commité, éditable),
  appliqués comme overlay déterministe, **proposés une seule fois** (`/reindex --full` ou étape dédiée),
  jamais recalculés à chaque run → pas de churn de cache.

## Maintenance de l'index

Règle d'or : **un hook ne dépense jamais de tokens en silence.**

- **`PostToolUse`** (`Edit|Write|MultiEdit` sur `.java`/`.yml`/`.properties`) → `node thunder.mjs touch <file>`
  : **append d'une ligne** dans `dirty.list` puis sort (quasi-gratuit, supporte les refactors massifs).
  Re-parse réel **paresseux** (drainé au prochain `ensure`/requête).
- **`SessionStart`** → `node thunder.mjs ensure --quiet` : draine `dirty.list`, rafraîchit le **technique**
  (0 token modèle), **n'injecte PAS l'aperçu** — émet une seule ligne pointeur
  (`thunder: index frais (N modules). /codemap pour explorer.`). Mode `session_hint: pointer|none|overview`.
- Chemin absolu de `thunder.mjs` + quoting Win/POSIX **résolus à l'installation** par le plugin.

## Configuration — `thunder.config.yaml` (racine repo, commité)

```yaml
exclude: ["**/target/**", "**/build/**", "**/generated/**"]
modules: auto                 # auto | [liste explicite]
context_depth: 1              # profondeur de package pour les frontières par défaut
session_hint: pointer         # pointer | none | overview
functional:
  model: haiku
  budget_contexts_per_run: 10 # cap par /reindex
  token_ceiling: 200000
  confirm_above: 50000        # demande confirmation au-delà
max_parallel_cartographers: 6
file_size_cap_mb: 2
```

## Composants

| Composant | Type | Rôle |
|---|---|---|
| `thunder.mjs` | moteur Node | walk/lex/parse/derive/emit, touch, ensure, vues, lookup, `--selftest` |
| `cartographer` | agent (Haiku) | inférence fonctionnelle ancrée (evidence pack), renvoie YAML/JSON structuré |
| `codemap` | skill | vues : overview, endpoints, beans, entity, config |
| `sym` | skill | lookup précis : def / refs / impl / callers (s'appuie sur le lexer ; jdtls = futur/expérimental) |
| `reindex` | skill | `/reindex` incrémental · `--full` table rase + re-propose overlay · `--tech` technique seul |
| `grok` | skill | Q&A métier : décompose → fan-out `Explore` ensemencés par l'index (plafonné) → synthèse |
| hooks | settings | PostToolUse `touch` + SessionStart `ensure` |

## Économie de tokens (compte honnête)

| Tâche | Naïf | Thunder — contexte principal | Thunder — total (avec fan-out) |
|---|---|---|---|
| « Liste les endpoints » | ~60k | `endpoints.yaml` ~2k | ~2k |
| « Où est défini X » | ~8k | `sym def` ~150 | ~150 |
| « Que fait le module facturation » | ~200k | shard contexte ~1k | ~1k |
| « Comment marche l'auth » | ~40k | synthèse ~2k | fan-out sous-agents inclus, ≪ 40k, plafonné |

*Le fan-out dépense des tokens dans les sous-agents : le gain est sur le **total** + le contexte principal
reste propre. Pas « 2k absolus » pour les requêtes de découverte.*

## Sûreté & tests

- **Sûreté moteur** : exclusions + `.gitignore`, skip binaires/gros fichiers, pas de symlink hors racine,
  `try/catch` par fichier (`parse_error` visible), n'exécute jamais de code, n'écrit que sous `.claude/cache/thunder-java/`.
- **Golden tests** : le projet démo multi-module **est** la fixture. `tests/expected/*.yaml` + `--selftest`
  (`node:test`/`node:assert`) diffe parse+derive+emit. Sélection d'evidence pack golden-testée (déterministe) ;
  sortie fonctionnelle exclue du golden (non-déterministe).

## Plan de construction

| Phase | Livrable |
|---|---|
| **1** | Démo Spring multi-module (= fixture) + moteur Node : WALK→LEX→PARSE→DERIVE→EMIT, `cache.ndjson`, shards YAML, `manifest`, `touch`/`ensure`, `--selftest` + golden |
| **1.5** | Agent `cartographer` + evidence pack + evidence_hash + fusion fonctionnelle |
| **2** | Skills `codemap` + `sym` + `reindex` + `capability-map` |
| **3** | Skill `grok` (fan-out plafonné, ensemencé) |
| **4** | Hooks (PostToolUse `touch` + SessionStart `ensure`) + `thunder.config.yaml` + `thunder.contexts.yaml` + packaging plugin (`plugin.json`, résolution chemins à l'install) |
```
