# Prompt correctif — thunder-angular : verbe/URL HTTP (R3) + refs de composant (R4)

> **Où vit ce fichier / pourquoi ici :** à la RACINE du repo `thunder/`, **pas** sous
> `plugins/thunder-angular/`. Raison : un update/resync régénère `plugins/…` et écrase tout fichier
> ajouté dedans (c'est arrivé à la version précédente de ce prompt). Le garder à la racine le préserve.

> ## 🟢 ÉTAT — FAIT ET VALIDÉ (2026-07-01)
> R3 intégré : le facet http capture le span complet de l'appel (multi-lignes) — verbe lu dans
> `method:` du config-object (défaut GET), URL résolue à travers les champs de classe
> (`this.apiUrl` → `{apiUrl}/categories`), y compris dans les gabarits (`${this.apiUrl}/${id}` →
> `{apiUrl}/categories/{id}`) ; champ non résoluble → `null`, jamais inventé.
> R4 intégré : le parseur extrait `imports: [...]` de `@Component`/`@Directive` en `type.uses` ;
> `sym refs <Composant>` liste les importeurs avec l'annotation `(imports X)`.
> Tests : +7 (fixtures d'acceptance R3.1/R3.2/KnowledgeService/non-régression + R4 parseur + R4
> bout-en-bout `sym refs`) — suite angular 55/55, selftest OK, ENGINE_HASH auto-invalidé (dérivé du
> contenu de parser.mjs). Fichiers : `engine/lib/parser.mjs`, `engine/thunder.mjs`,
> `engine/test/feature.test.mjs`. Relance : `node engine/thunder.mjs build <root> --force` puis
> `ask` / `sym refs`. Historique ci-dessous.

---

# R3 — [P1, JUSTESSE] Verbe + URL des appels `httpResource`

## Reproduction (mesurée le 2026-07-01)
Tous les services à mutation du projet sortent `{verb: GET, url: null}` dans leur facette `http:` —
alors qu'ils font POST/PUT/DELETE via `httpResource`. Extrait de
`.claude/cache/thunder-angular/projects/ai-chat/core.yaml` :

| Service | Attendu | Index actuel |
|---|---|---|
| `CategoryCreateService` | `{POST, {apiUrl}/categories}` | `{verb: GET, url: null}` |
| `CategoryUpdateService` | `{PUT, {apiUrl}/categories/{id}}` | `{verb: GET, url: null}` |
| `CategoryDeleteService` | `{DELETE, {apiUrl}/categories/{id}}` | `{verb: GET, url: null}` |
| `KnowledgeService` | GET + POST + DELETE | `{verb: GET, url: null}` |

Pattern source réel (Angular moderne — ce que le fix doit décoder) :
```ts
private readonly apiUrl = `${environment.apiUrl}/categories`;
private resource = httpResource<Category>(() => {
  const data = this.body();
  if (!data) return undefined;
  return { url: this.apiUrl, method: 'POST', body: data };   // verbe dans method:, url = champ de classe
});
// delete: return { url: `${this.apiUrl}/${id}`, method: 'DELETE' };
// list  : httpResource<...>(() => ({ url: this.apiUrl, params }));  // GET implicite
```

## Cause & fix (dans le parseur/dérivation du moteur)
Le moteur mappe `httpResource(...)` → `GET` en dur et ne résout pas l'URL. Deux corrections :

### R3.1 — Verbe : lire la propriété `method:` du config-object
Quand l'argument de `httpResource(...)` est (ou retourne) un objet littéral, extraire
`method:\s*['"](\w+)['"]` dedans ; absent → `GET`. Couvrir aussi `httpResource(url, { method })`.
Attendu : create→POST, update→PUT, delete→DELETE, list→GET.

### R3.2 — URL : suivre l'indirection de champ `this.apiUrl`
L'URL n'est pas un littéral inline mais un **champ de classe** valant lui-même un gabarit
(`apiUrl = \`${environment.apiUrl}/categories\``). Construire une petite table des champs-string de la
classe (`name → littéral résolu`, en normalisant `${environment.apiUrl}` → `{apiUrl}`), puis substituer
`this.<field>` et `${this.<field>}` à la résolution d'URL. Si non résoluble, garder `null` — mais ne
jamais prétendre `GET` par défaut si un `method:` existe.

## Acceptance R3
- `KnowledgeService.http` = `[{GET,{apiUrl}/documents},{POST,{apiUrl}/documents},{DELETE,{apiUrl}/documents/{id}}]`.
- Les 4 `Category*Service` sortent le bon verbe + URL normalisée.
- Fixture : `httpResource(() => ({ url: this.base, method:'POST' }))` avec
  `base = \`${environment.apiUrl}/x\`` → `{POST,{apiUrl}/x}`. Ne pas régresser un `http.post(\`${env.apiUrl}/y\`)` direct, ni un GET à URL littérale (`/assets/i18n/{lang}.json`).
- Re-run (DEBUG on, `.thunder/angular/.config` = `DEBUG=true`) : `ask "documents knowledge service http endpoints"`
  cite POST upload + DELETE, plus 3 GET.

---

# R4 — [P2] Références composant→composant (via `imports:` + sélecteur)

## Reproduction
`sym refs LoadingSpinnerComponent` → « aucun résultat », alors que le composant est utilisé dans
`tag-admin` et `category-admin` (dans leur tableau `imports:` standalone + balise `<app-loading-spinner>`
au template). Idem pour tout composant de présentation (page-header, sidebar, footer…).

## Cause & fix
`sym refs` ne piste que les références par **injection DI** (constructeur / `inject()`). L'usage d'un
composant standalone via le tableau **`imports:`** de `@Component({...})` et via son **sélecteur** dans le
template HTML n'est pas capté. Fix : lors de la dérivation, ajouter au graphe de références les composants
listés dans `imports:` (résolus par nom de classe) — et, si abordable, les sélecteurs employés dans les
templates `.html` du composant. Objectif : `sym refs <PresentationComponent>` renvoie ses vrais points
d'usage.

## Acceptance R4
- `sym refs LoadingSpinnerComponent` liste au moins `TagAdmin` et `CategoryAdmin`.
- Pas de faux positifs (un composant listé dans `imports:` mais jamais rendu reste acceptable à signaler
  comme usage « déclaré »).

---

# Garde-fous (R3 & R4)
- Rétro-compat : `<ctx>.yaml` + `*.card.yaml` continuent d'exister ; ne pas toucher evidence hashes,
  cycle stale/reindex, ni l'inférence cartographer.
- Étendre l'`ENGINE_HASH` si la dérivation change (pour invalider `cache.ndjson`), sinon `build --force`.
- `node --test engine/test/` vert + nouveaux tests : verbe depuis `method:`, URL via `this.<field>`,
  refs via `imports:`.

Quand c'est fait : tableau http avant/après sur `Category*Service` + `KnowledgeService`, sortie de
`sym refs LoadingSpinnerComponent`, fichiers touchés, commande de relance.
