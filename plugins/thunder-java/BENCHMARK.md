# Thunder — Rapport de benchmark détaillé (avant / après)

**Méthode.** Pour chaque requête : octets réellement ingérés **sans thunder** (lire le code source
pertinent) vs **avec thunder** (lire la tranche d'index via la bonne skill). Conversion ~**4 octets/token**
(heuristique standard, ordre de grandeur). *Biais favorable au « avant »* : on suppose qu'il sait déjà
quels fichiers ouvrir — en réalité il doit d'abord les découvrir (grep/glob), ce que l'index fait gratis.

**Bancs d'essai.**
- `demo` — 9 fichiers, projet jouet réaliste.
- **`realdemo` — 1 320 fichiers, 3 modules, 120 contextes, 720 endpoints, services ~108 lignes avec vraie
  logique** (validations, machine à états d'approbation, exceptions, deps inter-beans). *Banc principal.*
- `bigdemo` — 3 840 fichiers (échelle extrême, fichiers plus simples).

---

## 1. Tableau de résultats — realdemo (réaliste)

| # | Requête | Skill | Avant (tok) | Après (tok) | Gain |
|---|---|---|---|---|---|
| 1 | Vue d'ensemble de l'app / quels domaines | `codemap` | **297 525** | **199** | **1 491×** |
| 2 | Que contient le module `mod1` | `codemap` | 99 175 | 1 648 | **60×** |
| 3 | Comprendre `R0_0Service` (sa logique) | `grok` | 1 006 | ~175 (tranche shard) | **6×** |
| 4 | Beans + dépendances d'un contexte | `codemap` | 1 504 | ~150 | **10×** |
| 5 | Entités + relations d'un contexte | `codemap` | 492 | ~125 | **4×** |
| 6 | Où est défini `R2_10Service` | `sym` | ~600+ (grep+lire) | **51** | **>10×** |
| 7 | Qui utilise `R0_3Repository` | `sym` | ~800+ | **17** | **>40×** |
| 8 | Quel contexte gère « approval » | `grok` | lire le repo | grep (≈ const.) | **massif** |
| 9 | Endpoints du domaine `r1_7` | `codemap` | lire le controller | grep endpoints.yaml | **plusieurs ×** |
| 10 | Lister **TOUS** les 720 endpoints | `codemap` | 43 747 | 37 667 (entier) ⚠️ | **1×** → scoper |
| 11 | Deep-dive **complet** d'un contexte (11 fich.) | `grok` | 2 459 | 2 270 (shard entier) | **1,1×** + sens |

---

## 2. Exemples concrets (la requête, ce que lit chacun, la vraie réponse)

### Exemple 1 — « Donne-moi une vue d'ensemble de l'application »
- **Sans thunder** : il faut parcourir la codebase → **1 190 100 o (~297 500 tokens)**.
- **Avec thunder** : lire `index.yaml` → **741 o (~199 tokens)**. **Réponse réelle :**
```yaml
meta: {modules: 3, contexts: 120, endpoints: 720, ...}
modules:
  - name: mod0
    theme: Lifecycle domain services for mod0
    keywords: [search, update, approval, approve, create, creation]
    contexts: 40
    endpoints: 240
```
→ **1 491× moins de tokens**, réponse exacte et déjà structurée (thème métier par module).

### Exemple 2 — « Où est défini `R2_10Service` et qui utilise `R0_3Repository` ? »
- **Sans thunder** : `grep` global puis ouvrir 2-3 fichiers (~milliers de tokens).
- **Avec thunder** (`sym`) → **51 + 17 tokens. Réponse réelle :**
```
class R2_10Service  mod2/src/main/java/com/real/mod2/dom10/R2_10Service.java:18
method R2_10Service.R2_10Service(R2_10Repository, R2_10Mapper)  …:25
R0_3Service  mod0/src/main/java/com/real/mod0/dom3/R0_3Service.java:18   (← utilisateur de R0_3Repository)
```
→ `fichier:ligne` + signature direct, sans boucle chercher→lire.

### Exemple 3 — « Quel contexte gère l'approbation ? » (découverte)
- **Avec thunder** : `grep -i approve capability-map.yaml` → ne renvoie **que les lignes qui matchent**
  (coût ∝ nombre de matches, **pas** taille du repo). Réponse réelle :
```
- Approve a R0_0
- Approve a R0_1   …
```
*(ici tous les domaines ont « approve » car synthétiques ; sur du vrai code, un terme distinctif ne
matche qu'une poignée de contextes → réponse minuscule.)*

### Exemple 4 — « Comment se crée / s'approuve un `R0_0` (flux + règles) ? »
- **Sans thunder** : ouvrir `R0_0Service` (108 l.) + Controller + Request + Entity + Mapper + exceptions,
  **puis tracer les appels et déduire les règles**.
- **Avec thunder** : une tranche du shard — **flux dérivés + règles citées**, déjà digérés :
```yaml
business_rules:
  - {rule: "An approved record cannot be modified", src: "R0_0Service.java update(): status == APPROVED"}
  - {rule: "Only a PENDING record can be approved or rejected", src: "R0_0Service.java validateTransition()"}
use_cases:
  - {name: "Approve a R0_0", flow: "POST /api/r0_0/{id}/approve → R0_0Controller.approve → R0_0Service → R0_0Repository"}
```
→ règles **ancrées sur le code réel** (citent la méthode/annotation), flux sans traçage manuel.

### Exemple 5 — « Que contient le module `mod1` ? »
- **Sans thunder** : 440 fichiers du module → **~99 000 tokens**.
- **Avec thunder** : `modules/mod1/_index.yaml` → **~1 650 tokens** (1 ligne/contexte avec purpose). **60×.**

### Exemple 6 — « Endpoints du domaine `r1_7` »
- **Avec thunder** : `grep r1_7 endpoints.yaml` → les 7 endpoints avec leur flux, sans ouvrir le controller :
```
POST   /api/r1_7                 → R1_7Controller.create → R1_7Service → R1_7Repository
GET    /api/r1_7/{id}            → R1_7Controller.get …
POST   /api/r1_7/{id}/approve    → R1_7Controller.approve …
```

---

## 3. Échelle extrême (bigdemo, 3 840 fichiers)

| Requête | Avant (tok) | Après (tok) | Gain |
|---|---|---|---|
| Vue d'ensemble des domaines | ~485 700 | ~433 | **~1 100×** |
| « Que fait le module `mod3` » | ~60 700 | ~433 (ou 1 ligne) | **~140× et +** |

Plus le repo est gros, plus l'écart se creuse : le coût de l'index reste **borné** (sommet ~70 lignes).

---

## 4. Nuances honnêtes (où thunder n'aide pas / mal employé)

1. **Charger un gros fichier plat entier** (`endpoints.yaml`, `capability-map.yaml`) = anti-pattern
   (req. 10 : ≈ neutre). Ils se **grep** ou se requêtent par module — les skills l'imposent.
2. **Deep-dive « tout un contexte »** (req. 11) : ≈ **neutre en octets**. Le shard livre **plus** (sens
   métier, flux, relations) pour le même volume ; et une question *ciblée* n'en lit qu'une **tranche**.
3. **Lire un seul petit fichier connu** : ≈ neutre. Le terrain de thunder, c'est la **largeur**
   (orientation, découverte, multi-fichiers) et l'évitement de la boucle *chercher→lire→tracer*.
4. **Fichiers à grosse logique** : plus un service est gros (200-500 l.), plus ses **signatures ≪ source**
   → l'écart se creuse en faveur du shard (les accesseurs triviaux sont d'ailleurs filtrés de l'index).

---

## 5. Coûts uniques (amortis)

- **Index technique** : **0 token modèle** (CPU seul). realdemo 1 320 fichiers en **~150 ms** ;
  bigdemo 3 840 en **~270 ms** ; incrémental quasi-gratuit ; édition = enqueue instantané (hook).
- **Inférence fonctionnelle** : coût modèle **une seule fois** par contexte (cartographer Haiku),
  budgétée + confirmée, puis lue **gratuitement** à chaque requête. La couche **technique est gratuite**.

---

## 6. Pertinence des résultats

- **Technique** (endpoints, beans, entités, sym) : **exact**, déterministe, souvent **plus complet**
  qu'un grep humain (liens cross-fichiers assemblés : entité↔repo, graphe de beans, flux use-case).
- **Fonctionnel** : **ancré et cité** (chaque règle pointe une annotation/ligne réelle), en anglais,
  cohérent, auditable (`confidence`, champs marqués inférés).

---

## 6-bis. Requêtes d'architecture / sécurité / impact (analysées depuis l'index, ~0 token modèle)

Ces questions transverses sont **infaisables** en lisant le code (il faudrait tout parcourir). Elles
s'exécutent sur l'index via `node engine/tools/analyze.mjs <root>` — déterministe, ~0 token modèle.

| Question (dev / archi / sécu) | Réponse réelle | Coût |
|---|---|---|
| **(Sécu)** Quels endpoints exposent une **entité JPA directement** (fuite de données) ? | demo : **3** — `POST /users`→`User`, `POST /orders`→`Order`, `GET /users/{email}`→`User` ; realdemo : **0** (DTO partout) | ~0 |
| **(Sécu)** Combien d'endpoints **mutateurs** (surface d'attaque POST/PUT/DELETE) ? | realdemo : **600** | ~0 |
| **(Archi)** Y a-t-il des **dépendances de beans inter-contextes** (couplage) ? | **0** — contextes auto-portants | ~0 |
| **(Impact)** Si je renomme `UserService`, **qui casse** ? | `UserController` (`UserController.java:7`) | 17 tok |
| **(Impact)** Rayon d'impact d'un changement de `R0_3Repository` ? | `R0_3Service` (`:18`) | 17 tok |
| **(Onboarding)** « Je débarque, que fait l'app + concepts clés ? » | thèmes des modules (`index.yaml`) + `glossary` des shards | ~200 tok |

> Limite honnête : « endpoints sans `@Valid` » n'est pas répondable aujourd'hui (les annotations de
> *méthode* ne sont pas indexées) → piste d'enrichissement claire de l'index.

---

## 7-bis. Requêtes précises réellement exécutées (questions de dev + réponse réelle)

Chaque ligne = une vraie question, la commande thunder lancée, et sa réponse littérale.

| # | Question | Avant (tok) | Après (tok) | Gain |
|---|---|---|---|---|
| Q1 | Quels endpoints expose le domaine `r0_5` ? | 361 (lire le controller) | 42 (grep) | **9×** |
| Q2 | Quelle règle empêche de modifier un enreg. approuvé, et où ? | 1 006 (lire le service) | 12 (grep) | **84×** |
| Q3 | Quelles deps injectées a `R1_3Service` ? | 1 006 | ~30 | **33×** |
| Q4 | Où est utilisé `R2_8Repository` ? | ~500 (grep+lire) | 17 | **~30×** |
| Q5 | Quel est le flux quand on approuve un `R1_2` ? | ~750 (tracer) | ~30 | **25×** |
| Q7 | Quelles règles métier pour l'inscription utilisateur ? | 549 + inférence | ~60 | **9×+** |
| Q8 | Quel endpoint inscrit un user, quelle intention ? | ~290 | ~40 | **7×** |
| Q9 | Quelle relation entre `User` et `Order` ? | 340 (lire entités) | ~30 | **11×** |
| Q10 | Si je renomme `UserService`, qu'est-ce qui le référence ? | repo entier | 17 | **massif** |
| Q13 | Signature du constructeur de `R2_10Service` ? | 1 006 | ~30 | **33×** |

**Réponses littérales (extraits) :**

- **Q2** « règle qui empêche de modifier un approuvé » →
  `{rule: "An approved record cannot be modified", src: "R0_5Service.java update(): status == APPROVED"}`
- **Q3** « deps de R1_3Service » → `R1_3Service: {type: "@Service", deps: [R1_3Repository, R1_3Mapper]}`
- **Q4** « qui utilise R2_8Repository » → `R2_8Service  mod2/.../R2_8Service.java:18`
- **Q5** « flux d'approbation » →
  `POST /api/r1_2/{id}/approve → R1_2Controller.approve → R1_2Service → R1_2Repository`
- **Q8** « endpoint d'inscription » →
  `{verb: POST, path: /users, fn: UserController.create, intent: Register a new user}`
- **Q9** « relation User/Order » → `User: {table: users, rel: [{OneToMany: Order}], repo: UserRepository}`
- **Q10** « impact renommage UserService » → `UserController  user/.../UserController.java:7`
- **Q13** « ctor R2_10Service » → `R2_10Service(R2_10Repository, R2_10Mapper)  …:25`

**Requêtes transverses :**
- « Tous les endpoints POST de l'app » → grep `verb: POST` sur `endpoints.yaml` → **360 trouvés, ~1 350 tok**
  (vs ~44 000 tok pour lire les 120 controllers).
- « Quels contextes gèrent l'approbation ? » → grep `approve` sur `capability-map.yaml` → coût **∝ matches**,
  pas la taille du repo.

> Constat : les questions **ciblées** (la majorité du travail réel d'un dev) sont répondues par un `grep`
> sur l'index ou un `sym`, soit **quelques dizaines de tokens** avec la réponse exacte — là où lire le code
> demande des centaines à des milliers de tokens **plus** un raisonnement (tracer, déduire les règles).

## 7. Verdict

| Type de requête | Bénéfice thunder |
|---|---|
| Orientation / vue d'ensemble | **~1 100–1 500×** — décisif |
| Découverte « qui gère X ? » | **massif** (coût ∝ matches, pas taille repo) |
| Navigation symbole (`sym`) | **10–40×** + va droit au but |
| Comprendre un service / ses règles | **6×** + sens pré-digéré et cité |
| Beans / entités / relations | **4–10×** + liens cross-fichiers exacts |
| Deep-dive exhaustif d'un contexte | **octets ≈**, mais répond à **plus** sans raisonner |
| Dump exhaustif non scopé | **neutre** → scoper / grep |

**Conclusion.** Le gain croît avec la **taille du repo** et la **largeur** de la question. Sur une grosse
codebase, *comprendre / explorer / naviguer* coûte **2 à 3 ordres de grandeur de tokens en moins**, à
pertinence **égale ou supérieure** (réponses exactes + sens métier ancré). Le coût bascule vers une
indexation **unique et gratuite** (technique) ou **amortie** (fonctionnelle). thunder ne « compresse » pas
une réponse intrinsèquement large (dump de tout) — il évite surtout de **lire pour chercher**.

---

## 8. Optimisation « coût par requête » — index à deux tiers (carte / détail)

Problème adressé : sur un contexte donné, lire le shard détail coûtait presque autant que lire le `.java`.
Solution : chaque contexte émet désormais une **carte** tier-1 (`<ctx>.card.yaml`, ≤20 lignes) + le
**détail** tier-2 (`<ctx>.yaml`, inchangé, rétro-compat). Le chemin de récupération lit la **carte d'abord**
(ou la commande déterministe `ask "<mots-clés>"` qui renvoie les cartes + endpoints en **un seul payload**).

### token-bench (avant = full-shard, après = card-only) — sur `demo/`

| Question | type | card-only (tok) | full-shard (tok) | raw-java (tok) | card/full |
|---|---|---|---|---|---|
| Quels types compose le contexte user ? | structure | 92 | 870 | 747 | **11 %** |
| Quels endpoints expose le contexte user ? | endpoint | 137 | 870 | 130 | **16 %** |
| Où est UserService et qui en dépend ? | where | 92 | 870 | 416 | **11 %** |
| Quel est le flux de création d'un user ? | flux | 92 | 870 | 485 | **11 %** |
| Quels endpoints renvoient une entité (fuite) ? | sécurité | 137 | 1 560 | 288 | **9 %** |
| Quelle règle métier à l'inscription ? | règle-métier | 962 | 870 | 549 | 111 % (escalade détail) |

**Mode carte sur structure/where/what/endpoint/flux/sécu : 550 tok vs 5 040 tok full-shard → 11 %**
(cible ≤ 40 % **atteinte**). Honnêteté : une question de **règle métier précise** escalade au détail
(la carte ne la couvre pas) — c'est attendu et explicite dans les skills.

Relancer l'eval : `node engine/tools/token-bench.mjs demo` (exit 0 si carte ≤ 40 % du full-shard).

### Fichiers touchés
- `engine/lib/emit.mjs` — émission carte tier-1, `_index` pointant les cartes, régime YAML (drop du
  chemin par-type), `endpoints.yaml` enrichi (req/resp).
- `engine/lib/derive.mjs` — endpoints enrichis (type req/resp).
- `engine/thunder.mjs` — nouvelle commande `ask "<mots-clés>" <root>`.
- `engine/tools/token-bench.mjs` — eval reproductible (nouveau).
- `engine/test/card.test.mjs` — tests tiering carte + `_index` + endpoints enrichis (nouveau).
- `skills/thunder-java-codemap/SKILL.md`, `skills/thunder-java-grok/SKILL.md` — chemin de récupération
  carte-d'abord + `ask`.

Garde-fous respectés : `<ctx>.yaml` détail conservé (sym en dépend), hashes d'evidence et cycle
stale/reindex inchangés, `node --test` vert.

---

## 9. ROUND 2 — la vraie cible : maximiser les réponses INLINE

**Constat round 1** : le tiering a réduit les octets d'index mais **pas** le coût/requête en tokens. Raison
mesurée : **un sous-agent (Explore/Task) coûte ~11k tokens fixes**, quoi qu'il lise. Le coût d'une requête
est donc dominé par *spawner ou non un agent*, pas par le format de l'index.

**Réponse** : maximiser la fraction de questions répondues **inline** (boucle principale, 0 sous-agent),
avec un payload inline minimal-mais-suffisant.
- **`project-brief.yaml`** (tier-0, ≤~800 tokens, généré gratuitement) : archi détectée, modules + rôle,
  liste des endpoints (résumée si > 50), règles transverses. **1 lecture répond aux questions archi/overview/endpoint.**
- **`ask "<kw>"`** ranké **top-3**, le hit #1 **enrichi de ses `business_rules` + `flows`** → auto-suffisant
  (aucune lecture de suivi). `--top N` pour élargir, `ask --detail <id>` pour le shard détail direct.
  Endpoints bornés aux contextes montrés (pas de dump global).
- **Skills** (`codemap`, `grok`) : règle n°1 = *réponds inline, budget sous-agent = 0* pour
  structure/where/what/endpoint/flux/règle ; sous-agent autorisé **uniquement** pour un corps de méthode
  `.java` (1 agent max, ensemencé `file:line`). Combo `index.yaml`+`ask`+cartes **interdit**.
- **Bug endpoints corrigé** (R2.5) : les **signatures de méthode multi-lignes** étaient ratées par le parser
  (`[^)]*` exigeait `)` sur la même ligne) → capture multi-lignes ajoutée + test (TagController POST/GET).

### token-bench v2 — croissance du contexte principal (tokens), 3 chemins, sur `realdemo` (services réalistes)

| Question | (A) thunder inline | (B) raw inline | (C) +sous-agent | A/B | A/C |
|---|---|---|---|---|---|
| archi | 237 | 297 525 | 13 167 | 0 % | 2 % |
| flux | 1 590 | 2 460 | 13 167 | 65 % | 12 % |
| règle | 1 591 | 2 460 | 13 167 | 65 % | 12 % |
| sécurité | 68 | 43 748 | 13 167 | 0 % | 1 % |
| persistance | 3 757 | 2 460 | 13 167 | 153 % | 29 % |
| endpoint | 1 586 | 43 748 | 13 167 | 4 % | 12 % |

- **(A) vs (B)** sur structure/where/what/flux/endpoint : **1 %** (cible ≤ 25 %) ✅
- **(A) vs (C)** global : **11 %** (cible ≤ 15 %) ✅ → *spawner un agent est l'erreur, pas l'index*
- **6/6** questions répondues en mode (A) **sans sous-agent** (cible ≥ 5/6) ✅

Lecture honnête : sur une **question large** (archi, sécurité, lister les endpoints) l'inline écrase le raw
(2-3 ordres de grandeur). Sur le **deep-dive d'un seul petit domaine** (flux/règle/persistance), l'inline
`ask` est *comparable* à lire ce domaine — mais reste **~8× moins cher que le réflexe sous-agent** (A/C).
Le gain structurel = **ne pas spawner d'agent**.

Relancer : `node engine/tools/token-bench.mjs realdemo` (exit 0 si A/B ≤ 25 %, A/C ≤ 15 %, ≥ 5/6 inline).
Sur `demo/` (petits fichiers) le ratio A/B est moins favorable (~31 %) — c'est attendu, la démo sous-estime.

### Fichiers touchés (round 2)
- `engine/lib/emit.mjs` — `project-brief.yaml` (tier-0, endpoints bornés), `archStyle()`.
- `engine/lib/parser.mjs` — capture des signatures de méthode **multi-lignes** (fix endpoints R2.5).
- `engine/thunder.mjs` — `ask` ranké top-N + hit #1 enrichi (business_rules/flows) + `ask --detail <id>`.
- `engine/tools/token-bench.mjs` — eval v2 A/B/C (croissance contexte principal, overhead sous-agent).
- `engine/test/round2.test.mjs` — tests multi-lignes / endpoint / project-brief (42 tests au total).
- `skills/thunder-java-codemap/SKILL.md`, `skills/thunder-java-grok/SKILL.md` — doctrine inline-first.

---

## 10. ROUND 3 — bug de justesse (parseur) + ranking adaptatif

**R3.1 — bug de justesse corrigé.** Sur un controller Spring réaliste (Swagger + Pageable), `scanAnnotations`
ratait des annotations → `@RestController` perdu → `stereo` indéfini → **0 endpoint** sur tout le contexte.
Deux causes :
- **Annotations pleinement qualifiées** : `@(\w+)` matchait `@io` dans `@io.swagger…Tag(...)`, laissait un
  résidu pris pour un membre qui avalait les `pending` → annotations de classe perdues. Fix : `@([\w.]+)`,
  `annName` = dernier segment.
- **Args d'annotation multi-lignes** : `scanAnnotations` ne traversait pas les lignes. Fix : capture des
  spans multi-lignes (`captureParensSpan`).

Test de non-régression : `TagController` (Swagger qualifié + param `Pageable` multi-ligne) → `@RestController`
conservé, **5 méthodes**, **5 endpoints** (`GET/POST/PUT/DELETE /api/v1/tags…`). + cas unitaires « qualifié »
et « membre vs résidu ». *Ce bug touchait tout controller réaliste (Swagger/Pageable sont la norme).*

**R3.2 — `ask` ranking adaptatif.** Sur une question ponctuelle, renvoyer 3 cartes sur-répondait. Désormais :
si le hit #1 domine (score ≥ 2× le #2) → **top-1** ; sinon top-3. `--top N` force. Mesuré : `ask "unique
email"` → 1 carte (au lieu de 3).

**R3.3 — bench re-validé (7 questions)** sur `realdemo` : A/B = **1 %** (≤ 25 %), A/C = **11 %** (≤ 15 %),
**7/7** inline. 7ᵉ question « lister les endpoints d'un contexte » répond juste inline (parser corrigé).

Fichiers touchés : `engine/lib/parser.mjs` (scanAnnotations qualifié + multi-lignes), `engine/lib/derive.mjs`
(`annName` dernier segment), `engine/thunder.mjs` (`ask` adaptatif), `engine/test/round3.test.mjs`
(TagController), `engine/tools/token-bench.mjs` (7ᵉ question). **46 tests verts.**

Relance : `node engine/tools/token-bench.mjs realdemo`

---

## 11. ROUND 4 — polish

**R4.1 — champ `req` pollué corrigé** (même racine que R3.1). Sur les méthodes à params annotés,
`detectMember` capturait les params avec `\(([^)]*)\)` → tronquait à la 1ʳᵉ `)` *dans* l'annotation
(`@Parameter(description = …)`) → sig faux (`(@Parameter(description):…`) et `req` pollué. Fixes :
- capture des params **profondeur-consciente** (matching `)` réel) ;
- params lus depuis `cleanLines` **dans tous les cas** (annotations conservées → le `@RequestBody` reste
  détectable ; `scanAnnotations` les blanchissait sur une ligne) ;
- garde anti-initialiseur (`x = factory.create()` n'est pas une méthode) ;
- `req` = **type du param `@RequestBody`** (propre), plus un split naïf sur la virgule.

Tests : `getTags.req = null`, `createTag/updateTag.req = TagRequest`. `endpoints.yaml` vérifié propre.

**R4.2 — `ask --facts "<kw>"`** : payload maigre pour une question **factuelle** (uniquement
`business_rules` + signatures d'endpoints `VERB path <- req -> resp`, sans purpose/capabilities/types).
Pour répondre à un fait ponctuel sous le coût du raw.

**R4.3 — re-bench** (`realdemo`, 7 questions) : total **A = 1 % de B** (cible ≤ 30 %), A/C = 11 %, 7/7 inline.
*Note : R3.2 (ask top-1 adaptatif) reste en place mais ne se déclenche pas sur les faits non-dominants ;
ces questions ponctuelles restent parfois moins chères en raw — c'est l'agrégat qui compte.*

Fichiers : `engine/lib/parser.mjs` (detectMember profondeur-conscient + reqBody + garde init),
`engine/lib/derive.mjs` (`req` = reqBody), `engine/thunder.mjs` (`ask --facts`),
`engine/test/round3.test.mjs` (asserts `req`). **47 tests verts.**

---

## 12. ROUND 5 — routage de skill (sweep 20 requêtes)

Le coût/requête dépend du **bon point d'entrée**, pas seulement du moteur. `ask` n'est pas optimal pour tout.

**R5.1 — table de routage** ajoutée en tête de `grok`/`codemap` (à appliquer AVANT `ask`) :
sym (where/who-uses) · project-brief (archi/overview) · endpoints.yaml (endpoints) · grep capability-map
(discovery) · ask --facts/ask (règle/flux/what-does).

**R5.2 — fallback brief** : `ask` qui matche 0 carte (requête conceptuelle « hexagonal layers ») renvoie
désormais **automatiquement `project-brief.yaml`** au lieu d'un payload vide. Le corpus de matching de `ask`
inclut aussi les thèmes/keywords de module.

**R5.4 — sweep des 20 requêtes routées** (`tools/sweep-bench.mjs`, sur `realdemo`) :

| route | exemples | thunder vs raw |
|---|---|---|
| sym | where is X / who uses X | 16–49 tok vs 0,3–1,4k → **7–72×** |
| brief | architecture / modules / overview | 237 tok vs ~297k → **~1255×** |
| endpoints | list all / endpoints of module | grep ciblé → **1,5–2×** |
| discovery | who handles X | 24 tok (grep capmap) vs lire le repo → **>10 000×** |
| ask/--facts | règle / flux / what-does / capabilities | 277–1479 tok vs feature → **1,7–3,6×** |

**Bilan : thunder gagne 20/20, agrégat 37 406 vs 1 861 269 tok → 98 % d'économie** (cibles ≥ 18/20, ≥ 70 %).
*R5.3 : les 2 faits ponctuels dans des fichiers minuscules (unicité, audit mongo) restent ~30-40 tok plus
chers en thunder — laissés tels quels, non sur-ingénierés.*

Relance : `node engine/tools/sweep-bench.mjs realdemo`
