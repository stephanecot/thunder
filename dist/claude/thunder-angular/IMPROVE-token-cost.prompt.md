> ## 🟢 ÉTAT — ROUND 1 FAIT ET VALIDÉ · 🟡 ROUND 2 À FAIRE
> Round 1 appliqué et re-mesuré sur `aura/frontend` (12 contextes après granularité, reindex
> fonctionnel des 10 contextes touchés). Résultats :
> - **#1 granularité** ✅ : `features` éclaté en 10 contextes ; **Q3 chat passe de +6 % à −41 %
>   vs raw** (data tokens 6 826 → 3 808, −44 %), confidence `high`.
> - **#2 guards/interceptors fonctionnels** ✅ : `sym def authGuard` / `sym refs AuthService`
>   listent désormais `authGuard (injects AuthService)` et `authInterceptor` est un symbole.
> - **#3 gardes de route** ✅ partiel : `routes.yaml` porte `guards: [authGuard]` MAIS rate les
>   gardes en **appel-fabrique** `scopeGuard('aura:admin')` (route `administration/users` ressort
>   sans garde). → R2.1.
> - **#4 facette HTTP** ⚠️ partiel : le bloc `http:` existe et compte les appels, MAIS **verbes
>   tous émis `GET`** (faux : upload=POST, delete=DELETE) et **`url: null`** (non résolue). → R2.2.
> Agrégat : −49 % vs raw, désormais à JUSTESSE complète (avant, le coût plus bas venait en partie
> de réponses incomplètes). Reste le Round 2 ci-dessous. Tout le Round 1 = historique.

---

# ROUND 2 — corriger les 2 fixes partiels du Round 1 (mesurés sur `aura/frontend`)

## R2.1 — [P1, JUSTESSE] Gardes en appel-fabrique (`scopeGuard('aura:admin')`)
Le fix #3 capte les gardes-identifiants nus mais la regex
`can(?:Activate|Match|…)\s*:\s*\[([^\]]*)\]` puis le split par identifiant rate les éléments
qui sont des **appels de fonction-fabrique** : `canActivate: [scopeGuard('aura:admin')]`. Preuve
mesurée : route `administration/users` ressort SANS garde alors qu'elle a `scopeGuard('aura:admin')`.
Fix : en parsant le contenu du tableau de gardes, garder l'expression entière par élément (split
profondeur-conscient sur la virgule de premier niveau, pour ne pas couper dans les args), et pour
chaque élément émettre le nom de base + ses args éventuels, p.ex. `scopeGuard('aura:admin')` →
`{ guard: 'scopeGuard', args: ["aura:admin"] }` (ou au minimum la chaîne brute `scopeGuard('aura:admin')`).
Test : route avec `canActivate: [authGuard, scopeGuard('aura:admin')]` → 2 gardes émises, la 2e
avec son argument.

## R2.2 — [P1, JUSTESSE] Verbe + URL des appels HTTP
Le fix #4 émet le bloc `http:` mais (a) **classe tout en `GET`** et (b) laisse **`url: null`**.
Mesuré : `KnowledgeService` (3 appels : list GET, upload POST, delete DELETE) sort
`[{verb: GET, url: null} × ?]`. Deux corrections dans l'extraction (parser/derive) :
- **Verbe** : lire le verbe réel de chaque appel — `http.post(...)` → POST, `http.delete(...)`
  → DELETE, `httpResource(...)` → typiquement GET sauf option `method`. Aujourd'hui le verbe semble
  codé en dur / pris sur le 1er match. Mappe par méthode appelée.
- **URL** : résoudre les littéraux de gabarit. Cas dominant Angular :
  `` `${environment.apiUrl}/documents` `` et `` `${this.base}/${id}` ``. Émettre la forme
  normalisée (`{apiUrl}/documents`, `{apiUrl}/documents/{id}`) plutôt que `null` ; pour un
  `httpResource(() => \`...\`)`, aller chercher le littéral dans le corps de la lambda. Si vraiment
  non résoluble, garder `null` mais ne PAS prétendre `GET`.
Test : un service fixture avec `http.get(\`${env.apiUrl}/x\`)`, `http.post(\`${env.apiUrl}/x\`, body)`,
`http.delete(\`${env.apiUrl}/x/${id}\`)` → `http:` = `[{GET,{apiUrl}/x},{POST,{apiUrl}/x},{DELETE,{apiUrl}/x/{id}}]`.

## Acceptance criteria R2 (re-mesurer)
- Q routes : `administration/users` liste `scopeGuard('aura:admin')` SANS lire de `.ts`.
- Q documents/HTTP : les 3 appels de `KnowledgeService` sortent avec le bon verbe (GET/POST/DELETE)
  et une URL normalisée (`{apiUrl}/documents[/...]`) ; la requête repasse en confidence `high`
  (était `medium` faute d'endpoints).
- Pas de régression sur le bench data-tokens du Round 1 (Q3 reste ≤ 4 000 ; agrégat ≤ 50 % du raw).

Garde-fous inchangés (rétro-compat cards/détail, evidence hashes/reindex intacts, `node --test` vert,
+ les 2 tests fixtures ci-dessus).

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
