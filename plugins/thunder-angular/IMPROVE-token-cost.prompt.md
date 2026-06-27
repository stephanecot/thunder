> ## 🟡 ÉTAT — ROUND 1 À FAIRE (bench initial mesuré, corrections non appliquées)
> Bench initial sur un projet Angular réel (`aura/frontend` : 1 projet `ai-chat`, 63 fichiers
> `.ts`, 5 contextes, 10 routes). Après correction de l'overhead de harnais, thunder gagne
> déjà **−52 % de tokens de données** (15 072 vs 31 590 sur 5 requêtes) — MAIS 4 trous nets :
> 1 requête à parité (chat, +6 %) à cause de la **granularité des contextes**, et 3 trous de
> JUSTESSE (guards/interceptors fonctionnels, gardes de route, endpoints HTTP). Détail + plan
> ci-dessous. Rien n'est encore appliqué.

---

# Objectif : réduire le COÛT EN TOKENS par requête ET combler les trous de justesse de thunder-angular

Contexte : l'index fonctionne. Sur `aura/frontend` (Angular moderne : standalone + `provideRouter`,
guards/interceptors **fonctionnels**, `httpResource`), répondre via l'index coûte déjà ~moitié
moins que lire le `.ts` brut. Le problème n'est PAS le volume total de l'index (cartes ~1,1 KB
chacune) — c'est (a) une requête noyée par une granularité trop grossière, et (b) des faits
que l'index technique ne capte pas du tout, ce qui force des réponses incomplètes ou un retour
au source.

## ⚠️ LIS ÇA D'ABORD — comment mesurer (ne refais pas l'erreur du bench brut)

Le coût « par sous-agent » est trompeur. Mesuré sur ce projet :
> **Tout sous-agent coûte ~10,6k tokens FIXES** (system prompt + schémas d'outils), quoi qu'il
> lise (preuve : un agent no-op qui répond « ok » = 10 623 tok).
> **Un agent qui invoque un skill thunder paie ~4,3k EN PLUS** (le `SKILL.md` injecté dans son
> contexte ; codemap 4 213, grok 4 358) — coût que le bras « raw » (Grep/Read) ne paie jamais.

Donc le bon indicateur = **tokens de DONNÉES** = `mesuré − 10 623 − (4 300 × skills chargés)`,
ou mieux, la **croissance du contexte de la boucle principale** (mode inline, 0 sous-agent).
Le brut par sous-agent fait croire à tort que thunder coûte plus cher (constaté : +12 % brut →
**−52 % en data tokens** une fois corrigé). Tout le bench ci-dessous raisonne en data tokens
ET vise le régime inline.

## Baseline mesurée à battre (5 requêtes, data tokens, après reindex fonctionnel)

| Requête | Raw (data) | Thunder (data) | Δ | Trou |
|---|---:|---:|---:|---|
| Q2 « où est AuthService, qui l'injecte » | 5 999 | 666 | −89 % | rate `auth.guard.ts`/`auth.interceptor.ts` (3 injecteurs au lieu de 4) |
| Q1 « quelles routes / quel composant » | 3 526 | 831 | −76 % | rate les gardes (`authGuard`, `scopeGuard`) |
| Q5 « feature contexts + rôle » | 8 806 | 2 559 | −71 % | OK depuis reindex |
| Q4 « trace /documents » | 6 824 | 4 190 | −39 % | rate endpoints HTTP (`httpResource`, GET/POST/DELETE, `apiUrl`) |
| Q3 « comment marche le chat » | 6 435 | 6 826 | **+6 %** | noyé dans le contexte monolithique `features` |
| **TOTAL** | **31 590** | **15 072** | **−52 %** | |

Ne touche PAS la couche d'inférence métier (cartographer) ni le format des evidence packs ni le
cycle stale/reindex. Concentre-toi sur le PARSEUR (`engine/lib/parser.mjs`), la DÉRIVATION
(`derive.mjs`), l'AFFECTATION DE CONTEXTE (`build.mjs`) et le CHEMIN DE RÉCUPÉRATION
(`skills/*/SKILL.md`).

## Changements demandés, par ordre d'impact

### 1. [P0] Granularité par feature (corrige Q3 — le seul cas à parité)
Cause racine mesurée : `engine/lib/build.mjs:32-39` (`locate()`) ne prend que le **1er segment**
sous `src/app/` → `feature = seg[0]`. Tout `src/app/features/**` s'écrase dans UN contexte
`ai-chat/features` qui regroupe 8 sous-features (chat, documents, agent-settings, tag-admin,
user-admin, admin, dashboard, callback). Une question « comment marche le chat » charge donc la
carte + le détail de TOUT `features` (composants, services, business_rules de tag-admin/user-admin
inclus) → ~90 % de bruit. C'est le +6 %.

Fix dans `locate()` : descendre d'un niveau pour les dossiers conteneurs conventionnels.
```js
const CONTAINER_DIRS = new Set(['features', 'pages', 'modules', 'domains']);
if (rel.startsWith(appPrefix)) {
  const seg = rel.slice(appPrefix.length).split('/');
  if (seg.length > 2 && CONTAINER_DIRS.has(seg[0])) feature = seg[1];   // 'chat', 'documents', …
  else feature = seg.length > 1 ? seg[0] : 'app';
}
```
Attendu : contexte `ai-chat/chat` (3 composants, 0 service) → Q3 passe de +6 % à fortement
négatif, et le cartographer infère par feature (cartes plus pertinentes). Coût : ~5 → ~12
contextes (reindex un peu plus cher mais chaque carte plus petite).
**Garde-fou granularité** : rendre `CONTAINER_DIRS` débrayable et ne JAMAIS exploser un dossier
qui n'a pas de sous-dossiers (un `features/foo.component.ts` plat reste en `features`).

### 2. [P0, JUSTESSE] Guards / interceptors FONCTIONNELS comme symboles + leurs `inject()`
Angular moderne (ce projet à 100 %) écrit `export const authGuard: CanActivateFn = () => { const
a = inject(AuthService); … }` et `export const xInterceptor: HttpInterceptorFn = (req, next) => …`.
Ce sont des `const` fléchées, PAS des classes → le parseur ne modélise que les classes
(`TYPE_RE`, `parser.mjs` ~ligne 183), donc :
- ces guards/interceptors ne sont PAS des symboles → `sym` ne les trouve pas ;
- leur `inject(AuthService)` n'est pas capté → le graphe DI rate l'arête (Q2 : 3 injecteurs au
  lieu de 4, et l'interceptor manquant).

Fix : nouvelle passe d'extraction pour
`export const <name>: (CanActivateFn|CanActivateChildFn|CanMatchFn|CanDeactivateFn|HttpInterceptorFn|ResolveFn) = …`.
Capturer le corps (réutiliser `captureParensSpan`/span de l'init), y grepper `inject\(([A-Z]\w+)\)`,
enregistrer `<name>` comme symbole avec un stéréotype `guard`/`interceptor`/`resolver`, et pousser
ses deps dans `ctx.di` (`derive.mjs`). C'est le fix de justesse le plus important : sans lui,
toute la sécurité de routage et la chaîne HTTP transverse sont invisibles à la couche technique.

### 3. [P1, JUSTESSE] Capter `canActivate` / `canMatch` sur les routes (corrige Q1)
`extractRoutes` (`parser.mjs:118-143`) capte path/redirectTo/component/loadComponent/loadChildren
/children mais PAS les gardes. Dans la fenêtre `win`, ajouter :
```js
const guards = win.match(/can(?:Activate|ActivateChild|Match|Deactivate)\s*:\s*\[([^\]]*)\]/);
```
→ champ `guards: [...]` sur la route, émis dans `routes.yaml` et injecté dans le `flow`
(`derive.mjs:80-90`). Attendu : Q1 cite `authGuard`/`scopeGuard('aura:admin')` sans lire le source.

### 4. [P1, JUSTESSE] Facette HTTP des services (corrige Q4)
Aujourd'hui `derive.mjs:59` n'émet que `services[name] = { providedIn, deps }`. Pour un front, le
contrat backend est central. Scanner les corps de méthodes de service (le parseur capte déjà les
méthodes) pour `http\.(get|post|put|delete|patch)\(`, `httpResource\(`, et les littéraux d'URL /
`\$\{[\w.]*apiUrl\}…` → émettre `http: [{ verb, url }]` sur le service (carte + détail). Attendu :
Q4 répond GET/POST/DELETE `/api/v1/documents` sans ouvrir `knowledge.service.ts`.

## Acceptance criteria (à PROUVER, pas à affirmer)
Étends `engine/tools/token-bench.mjs` (déjà présent) pour mesurer, sur la démo OU un fixture
représentatif (guards fonctionnels + service `httpResource` + dossier `features/<x>/`), les
**tokens de DONNÉES** (octets→tokens lus pour répondre, overheads fixes EXCLUS) sur un jeu figé
de 5 questions : 1 routes, 1 « où/qui injecte » (avec un guard fonctionnel), 1 flux feature,
1 endpoint HTTP, 1 contexte/feature. Trois modes : `card-only`, `full-shard`, `raw-ts`.
Cibles, à justesse égale ou meilleure :
- **Q3-type (flux feature) : ≤ 50 % du data-token actuel** (la granularité doit casser le +6 %).
- **Justesse** : la question « qui injecte AuthService » liste le guard fonctionnel ; la question
  routes cite les gardes ; la question endpoint renvoie verbe+path — toutes SANS lire de `.ts`.
- Agrégat thunder ≤ 50 % du raw (déjà atteint en data tokens : ne pas régresser).
Documente le tableau avant/après dans `BENCHMARK.md`.

## Garde-fous
- Rétro-compat : `<ctx>.yaml` ET `*.card.yaml` continuent d'exister (sym/skills en dépendent).
- Ne touche ni aux evidence hashes, ni au cycle stale/reindex, ni à l'inférence cartographer.
  (La granularité #1 va créer de nouveaux contextes → ils sortiront `stale: missing`, c'est
  normal ; ne force PAS de reset des contextes existants non touchés.)
- `node --test engine/test/` vert AVANT de conclure + nouveaux tests : un cas guard fonctionnel
  (`export const x: CanActivateFn` avec `inject(Y)` → symbole + arête DI), un cas route avec
  `canActivate: [g]`, un cas service `httpResource`/`http.post` → facette http, un cas
  granularité (`features/a/*` et `features/b/*` → 2 contextes).
- Comme le moteur change (parser/derive/build), vérifier que le cache.ndjson s'invalide bien
  (l'`ENGINE_HASH` de `build.mjs:14` ne couvre que lexer+parser → l'étendre à `derive.mjs` et
  `build.mjs` si #1/#4 modifient la dérivation, sinon `build --force`).

Quand c'est fait, donne-moi : le tableau token-bench avant/après (data tokens), la liste des
fichiers touchés, les preuves de justesse (les 3 trous comblés), et la commande exacte de relance.

## Ordre d'exécution conseillé
**#1 (Q3/granularité) → #3 (gardes route) → #2 (guards/interceptors fonctionnels) → #4 (HTTP)**,
en re-mesurant la requête concernée après chaque étape.
