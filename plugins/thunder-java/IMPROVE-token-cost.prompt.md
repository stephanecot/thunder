> ## ⏩ ÉTAT — COMMENCE ICI
> Rounds 1→4 **faits et validés**. Bench 20 requêtes : thunder économise **73–92 %** des
> tokens vs raw (4–12× moins cher), correctness OK. **Travail ACTIF = `# ROUND 5` en bas**
> (routage de skill : 2 types de requêtes prennent un chemin sous-optimal). Le reste = historique.
>
> ⚠️ Rappels d'exploitation : purger `cache.ndjson` avant de re-mesurer (sinon vieux parse
> réutilisé). Après tout reparse, re-inférer les contextes `changed` via
> `/thunder-java:thunder-java-reindex` (incrémental, coût minime).

---

# Objectif : réduire le COÛT EN TOKENS par requête de l'index thunder-java

Contexte : l'index fonctionne mais sur un projet test réel (25 contextes, 5 modules)
répondre à une question via l'index coûte presque autant que lire le `.java` brut
(–6 % seulement). L'index entier ne pèse que ~37k tokens — le problème n'est PAS le
volume total mais le coût PAR REQUÊTE. Baseline mesurée à battre :
- shards `modules/<m>/<ctx>.yaml` : 2.5–5.6 KB chacun (~600–1400 tokens)
- une réponse type lit root + `_index` + 2 à 5 shards = 300–520 lignes
- `endpoints.yaml` : 2 endpoints seulement (couverture probablement incomplète)

Ne change PAS la couche d'inférence métier (cartographer) ni le format des evidence
packs. Concentre-toi sur la FORME ÉMISE (`engine/lib/emit.mjs`, `derive.mjs`) et le
CHEMIN DE RÉCUPÉRATION (`skills/*/SKILL.md`).

## Changements demandés, par ordre d'impact

### 1. Shards à deux tiers (levier principal)
Aujourd'hui `emit.mjs` (~ligne 95-110) émet un shard monolithique qui mélange faits
structurels et prose fonctionnelle. Sépare :
- **`<ctx>.card.yaml`** (cible : ≤ 20 lignes) : name, purpose (1 ligne), capabilities
  (liste courte), noms des types publics, signatures d'endpoints (verbe+path), #beans/#entities.
  C'est ce que 80 % des questions doivent suffire à lire.
- **`<ctx>.yaml`** (détail, inchangé ou allégé) : signatures complètes, annotations de
  champs, `business_rules` avec citations, `intents`, `glossary`, use-cases.
Le `_index.yaml` du module liste les cartes, pas les shards lourds.

### 2. Régime sur le schéma YAML
- Retire le préfixe de package commun répété dans chaque type/symbole (il est implicite
  via `meta.shard_path`).
- Sors `glossary` du tier carte (garde-le en détail, ou fichier séparé).
- Garde la discipline de clés courtes déjà en place (`n/t/l/sig/ann`) et étends-la aux
  champs fonctionnels.
Objectif : –30 à –50 % sur les 60 KB de shards.

### 3. Récupération déterministe (supprime le fan-out à la louche)
Ajoute une commande moteur `node thunder.mjs ask "<mots-clés>" <root>` qui renvoie en
UN SEUL payload la tranche minimale : cartes des contextes qui matchent + endpoints
pertinents (depuis `capability-map.yaml` + `endpoints.yaml`). Le but : l'agent fait 1 Read
au lieu de grep+index+N shards.
Mets à jour `skills/thunder-java-grok/SKILL.md` et `codemap/SKILL.md` pour :
- 1re étape = `ask`/grep `capability-map.yaml` (jamais charger un module entier) ;
- ne lire le `<ctx>.yaml` DÉTAIL que si la carte ne suffit pas (règle explicite + exemple).

### 4. Enrichir endpoints.yaml SANS coûter de tokens ailleurs
Vérifie pourquoi seulement 2 endpoints sont captés (`derive.mjs:106-113`) : couvre
`@RequestMapping(method=…)`, les `record` controllers, méthodes héritées. Émets
verbe+path+controller+type req/resp pour que les questions « endpoint » se répondent
SANS ouvrir de shard.

## Acceptance criteria (à prouver, pas à affirmer)
Ajoute un eval reproductible dans `engine/test/` ou un script `tools/token-bench.mjs` qui,
sur le projet demo (ou `demo/`), pour un jeu fixe de ~6 questions (1 archi, 1 flux, 1 règle
métier, 1 sécurité, 1 persistance, 1 endpoint), mesure les **octets/tokens lus** pour
répondre, dans 3 modes : `card-only`, `full-shard`, `raw-java`. Reporte un tableau.
Cible : **mode carte ≤ 40 % des tokens du mode full-shard actuel**, sans perte de justesse
sur les questions structure/where/what. Documente le résultat dans `BENCHMARK.md`.

## Garde-fous
- Garde la rétro-compat : `<ctx>.yaml` doit continuer d'exister (les skills/sym en dépendent).
- N'altère pas les hashes d'evidence ni le cycle stale/reindex.
- Lance `node --test engine/test/` avant de conclure ; ajoute des tests pour le tiering
  et le nouveau `ask`.

Quand c'est fait, donne-moi : le tableau token-bench avant/après, la liste des fichiers
touchés, et la commande exacte pour relancer l'eval.

---

# ROUND 2 (révisé) — la vraie cible : maximiser les réponses INLINE

## Ce que la mesure du round 1 a prouvé (lis-le, c'est le cœur du sujet)
Le tiering (cards) a réduit les OCTETS d'index (−21 % shards, −14 % lignes lues) MAIS le
coût total en tokens par requête n'a PAS bougé. Raison, mesurée :

> **Chaque sous-agent (Explore/Task) coûte ~11k tokens FIXES, quoi qu'il lise.**
> Preuve : la requête la plus légère a lu 137 lignes (~1,5k tokens de contenu) et a coûté
> 13,1k tokens au total. Les octets d'index sont du bruit face à cet overhead.

Conséquence : **le coût d'une requête est dominé par le fait de spawner ou non un agent,
PAS par le format de l'index.** Le seul vrai gain de thunder existe quand la **boucle
principale répond inline** depuis un petit index, sans dragger ni source ni sous-agent.

Modèle de coût cible (croissance du contexte principal pour « tracer la création d'un tag ») :
| Chemin | tokens tirés dans le contexte |
|---|---|
| Thunder inline (1 `ask`, top-3) | ~600 |
| Raw inline (grep + 4-5 `.java`) | ~4 000–6 000 |
| Thunder AVEC sous-agent (anti-pattern) | ~13 000 |

=> Optimiser = **maximiser la fraction de questions répondues en régime inline**, et rendre
le payload inline minimal-mais-suffisant. Tout le reste est secondaire.

## R2.1 — [P0] Skill : répondre INLINE par défaut, budget sous-agent = 0
Dans `skills/thunder-java-grok/SKILL.md` ET `codemap/SKILL.md` :
- Règle n°1, en tête : **« Réponds depuis l'index dans la boucle principale. Ne spawne
  AUCUN sous-agent pour une question de structure / where / what / quel endpoint / quel flux /
  quelle règle métier. »**
- Fan-out (Task/Explore) autorisé UNIQUEMENT pour lire un *corps de méthode* réel `.java`,
  et alors : 1 agent max, ensemencé avec les `file:line` exacts tirés de l'index.
- Donne un exemple résolu de bout en bout SANS Task (1 `ask` → réponse citée).
- Rappelle le tradeoff explicitement : un sous-agent garde le contexte propre mais coûte
  ~11k ; inline coûte ~1k. Pour le coût tokens, inline gagne ~8×. Défaut = inline.

## R2.2 — [P0] Artefact « project-brief » : 1 lecture répond à ~70 % des questions
Génère à l'indexation (gratuit, depuis cartes + rollups, AUCUNE inférence LLM) un fichier
`project-brief.yaml` (cible ≤ 800 tokens) à la racine du cache, contenant :
- modules + rôle d'une ligne + style d'archi (hexagonal détecté),
- règles transverses clés (ex. unicité des codes, profils sécurité) si présentes dans les
  business_rules déjà inférées,
- la liste complète des endpoints (verbe + path + controller),
- pointeurs vers cartes/détail pour aller plus loin.
But : pour une question d'archi/onboarding/overview, la boucle principale lit CE SEUL fichier
et répond. Les deux SKILLs doivent en faire le 1er réflexe avant tout `ask`/card.

## R2.3 — [P1] `ask` = réponse suffisante en UN coup (point d'entrée unique)
Constat : `ask "tag creation validation"` a matché 13 contextes / 25 et dumpé ~150 lignes.
- Ranking par score, **top-3 par défaut** (`--top N` pour élargir), score affiché.
- Payload assez riche pour répondre **sans lecture de suivi** (carte + business_rules /
  signatures pertinentes du hit n°1). Vise un `ask` ≈ 300–800 tokens, auto-suffisant.
- Mets à jour les SKILLs pour **interdire le combo** `index.yaml` + `ask` + cartes
  individuelles (mesuré : les agents lisaient les trois → gaspillage).
- Ajoute `ask --detail <id>` qui renvoie directement le shard détail (évite un 2e tool-call
  de localisation quand le détail est vraiment nécessaire).

## R2.4 — [P1] Pour l'inline, consolider > sharder
Le sharding fin sert le fan-out (ensemencer 1 shard). La boucle principale, elle, préfère
**peu de gros fichiers curatés** (moins de Read, moins de décisions) : `project-brief.yaml`,
`capability-map.yaml` (grepable), `endpoints.yaml`. Garde les deux familles d'artefacts mais
documente leur usage : brief/map/endpoints = inline ; cards/shards = fan-out ciblé.

## R2.5 — [P2] Corriger endpoints (bug non résolu au round 1)
`endpoints.yaml` ne liste toujours que 2 endpoints ; `TagController` (POST /api/v1/tags,
DELETE, GET paginé) est ABSENT. Diagnostique `derive.mjs:106-113` (captation des
`@PostMapping`/`@DeleteMapping`/`@GetMapping` au niveau méthode). Corrige + test asserant que
les endpoints de TagController apparaissent. (Sans ça, R2.2/R2.3 répondent faux aux questions
endpoints.)

## Acceptance criteria (RE-mesurer correctement)
Le bench du round 1 mesurait les octets lus — trompeur. Le nouveau `tools/token-bench.mjs`
doit mesurer la **croissance du contexte de la boucle principale** (tokens) pour atteindre une
réponse juste, sur les 6 questions (1 archi, 1 flux, 1 règle, 1 sécurité, 1 persistance,
1 endpoint), dans 3 chemins :
  (A) **thunder inline** (brief/`ask`, 0 sous-agent) ← le mode cible
  (B) **raw inline** (grep + lecture `.java` dans la boucle principale)
  (C) thunder avec fan-out (pour chiffrer l'anti-pattern)
Cibles, à justesse égale :
- (A) ≤ **25 %** de (B) sur les questions structure/where/what/flux/endpoint,
- (A) ≤ **15 %** de (C) (montre que spawner un agent est l'erreur, pas l'index),
- ≥ **5 des 6** questions répondues en mode (A) **sans aucun sous-agent**.
Documente A/B/C dans `BENCHMARK.md`. C'est CE tableau qui valide l'optimisation, pas la
taille du YAML.

## Garde-fous (inchangés)
- Rétro-compat : `<ctx>.yaml` et `*.card.yaml` continuent d'exister.
- Ne touche ni aux hashes d'evidence, ni au cycle stale/reindex, ni à l'inférence cartographer.
- `node --test engine/test/` vert + nouveaux tests (project-brief, `ask` top-k, endpoints).

Quand c'est fait, donne-moi le tableau A/B/C, les fichiers touchés, et la commande de relance.

---

# ROUND 3 — après mesure du round 2 (l'inline marche : 25 % du coût raw)

Le round 2 a fonctionné : benchmark déterministe (octets→tokens) = **thunder inline ≈ 25 %
du coût raw inline** (3 350 vs 13 568 tok sur 6 questions), et **~27× moins cher que le
fan-out**. `project-brief.yaml` (463 tok), `ask` top-3 (557 tok) et `endpoints.yaml` (82 tok)
font le job. Restent 2 trous, dont un de JUSTESSE.

## R3.1 — [P0, BUG DE JUSTESSE] Parseur : annotations perdues → endpoints faux
CORRECTION de mon diagnostic R2.5 : le bug n'est PAS dans `derive.mjs:106-113` (ce code est
correct, il ne s'exécute jamais). La cause réelle est dans `engine/lib/parser.mjs`,
`scanAnnotations` (lignes 11-36). Preuve : `TagController` est parsé avec `ann: []` et seules
2 de ses 5 méthodes sont captées (`createTag`, `deleteTag`) ; `getTags`, `getTagById`,
`updateTag` manquent. Résultat : `stereo` indéfini → `endpoints: []` pour tout le contexte
tags. Deux défauts précis :

a) **Annotations pleinement qualifiées.** La regex `@(\w+)` (ligne 14) sur
   `@io.swagger.v3.oas.annotations.tags.Tag(...)` matche `@io`, tombe dans la branche `else`
   (ligne 30), ne consomme PAS les `(...)`, et laisse `.swagger…tags.Tag(name = "Tags", …)`
   sur la ligne. Ce résidu est ensuite pris pour un membre `Tag(...)` qui avale les `pending`
   annotations → `TagController.ann` devient `[]`.
   Fix : matcher `@([\w.]+)` (nom qualifié), exposer `annName` = dernier segment après le `.`,
   et consommer le span d'arguments complet.

b) **Spans multi-lignes.** `scanAnnotations` ne scanne qu'UNE ligne ; le matching de parens
   (21-27) ne traverse pas les lignes. Les signatures multi-lignes à params annotés
   (`@RequestParam`, `@PageableDefault(size=20, sort="code", direction=Sort.Direction.ASC)`)
   désynchronisent le comptage → méthodes sautées. Fix : scanner les annotations à travers les
   lignes (réutilise `captureParensSpan`, déjà présent lignes 58-69) ou pré-joindre les lignes
   logiques avant `scanAnnotations`.

Test de non-régression OBLIGATOIRE : sur `TagController`, asserter
`stereo === 'controller'`, **5 méthodes** captées, et **5 endpoints** émis :
`GET /api/v1/tags`, `GET /api/v1/tags/{id}`, `POST /api/v1/tags`, `PUT /api/v1/tags/{id}`,
`DELETE /api/v1/tags/{id}`. Ajoute aussi un cas unitaire « annotation pleinement qualifiée »
et un cas « param annoté multi-ligne ».
(Ce bug touche TOUT controller Spring réaliste — Swagger + Pageable sont la norme. Priorité 1.)

## R3.2 — [P1] `ask` sur-répond sur les questions PONCTUELLES (mesuré sur Q5)
Cas « unicité des codes » : `ask` renvoie 3 cartes (719 tok) alors que la réponse
(`@Indexed(unique=true)`) tient dans 2 fichiers de 60 lignes → thunder coûte **1,9× le raw**
ici, seul cas où l'inline perd. Fix : ranking adaptatif —
- si le score du hit n°1 domine nettement (ex. ≥ 2× le hit n°2, ou écart > seuil), renvoyer
  **top-1** seulement ;
- sinon top-3 comme aujourd'hui.
Garde `--top N` pour forcer. But : ne jamais payer 3 cartes quand 1 répond. Re-mesure Q5 :
cible ≤ 100 % du raw (idéalement < 50 %).

## R3.3 — Re-valider le bench complet après R3.1/R3.2
Relance `tools/token-bench.mjs` (chemins A/B/C). Confirme : (A) reste ≤ 25 % de (B),
Q5 repasse sous le raw, et ajoute une 7e question « liste tous les endpoints des tags » qui
DOIT maintenant répondre juste (5 endpoints) en mode inline depuis `endpoints.yaml`.

Garde-fous inchangés (rétro-compat, pas de reset des hashes/inférence, tests verts).

---

# ROUND 4 — polish (après validation de R3.1)

R3.1 a marché (endpoints corrigés, 7 dont les 5 de TagController, Q7 juste en 302 tok).
Bench actuel : thunder inline = **32 % du raw** (3× moins cher). Reste du polish, pas de
blocage. R3.2 (ask top-1 adaptatif) est ABANDONNÉ : Q5 « unicité » n'a pas de hit dominant
(la règle vit dans 2 contextes), donc un top-1 ne se déclencherait pas, et Q5 est la question
la moins chère en raw (377 tok) — thunder n'a pas à la gagner. Remplacé par :

## R4.1 — [P1, BUG] champ `req` des endpoints pollué (même racine que R3.1)
Sur les endpoints à params multi-lignes, `endpoints.yaml` émet `req: "@Parameter(description"`
au lieu du vrai type. Cause : `derive.mjs:113-114` fait `params.split(',')[0]` — la 1re virgule
tombe DANS l'annotation `@Parameter(description = "...")`. Fix : réutiliser le split
profondeur-conscient et le strip d'annotations déjà présents dans `parser.mjs`
(`splitParams` lignes 38-49 + `paramType` lignes 51-56) au lieu d'un split naïf. Attendu :
`getTags.req` = `String` (ou null), `updateTag.req` = `UpdateTagRequest`. Ajoute l'assert au
test endpoints de R3.1.

## R4.2 — [P2, optionnel] cartes plus maigres pour les faits ponctuels
Q5 : `ask` renvoie 3 cartes complètes (921 tok) là où la réponse (`@Indexed(unique=true)`)
tient en 2 fichiers de 60 lignes (raw 377 tok). Plutôt qu'un top-1 (inopérant ici), offre un
mode fait-ponctuel : `ask --facts "<kw>"` qui ne renvoie QUE les `business_rules` + signatures
matchantes (pas purpose/capabilities/glossary), ~1 ligne par hit. But : répondre à une
question factuelle sous le coût du raw. Faible priorité — n'impacte que la question la moins
chère ; à ne faire que si trivial.

## R4.3 — re-bench + garder l'œil sur l'agrégat, pas chaque question
Relance `tools/token-bench.mjs`. Cible : total A ≤ 30 % de B. Ne te bats PAS pour faire gagner
thunder sur chaque question isolée (certains faits ponctuels resteront moins chers en raw, et
c'est OK) — c'est l'agrégat sur questions réalistes qui compte. Documente dans `BENCHMARK.md`.

Garde-fous inchangés.

---

# ROUND 5 — routage de skill (après sweep 20 requêtes)

Le sweep sur 20 types de requêtes a confirmé l'éco (73–92 % / 4–12×) MAIS a révélé 2 types
où l'agent prend un chemin sous-optimal — c'est dans les SKILLs, pas le moteur. À corriger :

## R5.1 — [P1] Router les requêtes par type vers le bon point d'entrée
Mesuré : `ask` n'est pas le bon outil pour tout. Ajoute une TABLE DE ROUTAGE explicite en tête
de `skills/thunder-java-grok/SKILL.md` ET `codemap/SKILL.md`, à appliquer AVANT tout `ask` :

| Forme de la question | Point d'entrée (le moins cher mesuré) |
|---|---|
| « où est X défini », « qui utilise/appelle X », « trouve la classe/méthode X » | `node thunder.mjs sym def\|refs <Name>` → **~30 tok**, exact |
| « architecture », « comment c'est structuré », « quels modules », « overview » | `project-brief.yaml` (lecture directe) — **PAS `ask`** (voir R5.2) |
| « quels endpoints », « liste les routes » | `endpoints.yaml` |
| « qui gère / où est traité X » (discovery) | grep `capability-map.yaml` |
| règle métier, flux, valeur de config, « que fait X » | `ask --facts` puis `ask` |

Preuve : « où est TagService » via `sym` = 31 tok vs ~3250 en raw (105×) ; via `ask` ce serait
plusieurs centaines. La skill doit reconnaître ces formes et NE PAS défaut sur `ask`.

## R5.2 — [P1] `ask` whiffe sur les requêtes conceptuelles → fallback brief
Mesuré : `ask "modules architecture hexagonal layers"` → **matched: 0** (ces termes ne sont pas
dans le texte des cartes). Aujourd'hui l'agent se retrouve sans réponse → il sur-lit. Fix au
choix :
- (a) simple & robuste : quand `ask` score 0 carte, **renvoyer automatiquement `project-brief.yaml`**
  (au lieu d'un payload vide) ;
- (b) mieux : indexer dans le corpus de matching de `ask` la ligne `arch:` + les rôles de modules
  du brief, pour que les requêtes conceptuelles touchent.
Fais (a) au minimum.

## R5.3 — NE PAS toucher les 2 cas « perdants »
Sur le sweep, thunder coûte un peu plus que le raw sur 2 requêtes seulement (unicité = 2 fichiers
de 60 lignes ; auditing mongo = 1 fichier). Écart ~30–40 tok. Ce sont des faits ponctuels dans
des fichiers minuscules — laisser tel quel, ne pas sur-ingénierer.

## R5.4 — figer le bench réaliste
Mets `tools/token-bench.mjs` à jour pour router par type (R5.1) au lieu de tout passer par `ask`,
et fige le jeu des 20 requêtes. Documente le tableau (économie + facteur) dans `BENCHMARK.md`.
Cible : ≥ 18/20 requêtes en faveur de thunder, économie agrégée ≥ 70 % (jeux de fichiers
minimaux) — déjà atteint, ne pas régresser.

Garde-fous inchangés (rétro-compat, hashes/inférence intacts, `node --test` vert).

## R5.5 — [BUGS trouvés en test end-to-end : ajout d'un gros feature « Category », 18 fichiers]
Test réel : un sous-agent a écrit 18 fichiers `.java` (vertical complet) → hook → build → reindex
→ économie 72 % sur le nouveau code. Ça marche, MAIS 3 problèmes :

a) **`dirty.list` n'est jamais vidé.** Après écriture des 18 fichiers, `dirty.list` = 18 entrées ;
   après `build`, **toujours 18**. Il grossit indéfiniment session après session. Or `build`
   rehashe tout (« 18 parsés, 52 réutilisés ») — il n'a même pas l'air de CONSOMMER `dirty.list`.
   → Soit `build` consomme `dirty.list` pour ne reparser QUE le dirty (et le tronque ensuite),
   soit `dirty.list` est mort et il faut le supprimer. Aujourd'hui : fuite + travail redondant.

b) **Pas de cache-bust quand le MOTEUR change.** `cache.ndjson` est clé par hash de fichier ;
   après une modif du PARSEUR (pas du source), `build` ressert les vieux parses bugués. `build --full`
   n'a PAS forcé le reparse — j'ai dû `rm cache.ndjson` manuellement (2× pendant les tests).
   → Ajouter un `build --force` (ou invalider `cache.ndjson` si la version du moteur a changé,
   p.ex. stocker un `engineVersion` dans le cache et le comparer). Critique pour itérer sur le moteur.

c) **Budget reindex pile à la limite.** Un vertical complet = ~10 contextes = exactement le budget
   de 10/run. La skill ne demande confirmation que si on « dépasse » → 10 passe sans confirmation,
   mais un feature un peu plus gros se fait silencieusement tronquer à 10. → Soit monter le défaut
   à ~15, soit confirmer dès qu'on ATTEINT le budget (≥, pas >).

BONNE NOUVELLE (à ne PAS casser) : les Write d'un SOUS-AGENT déclenchent bien le hook PostToolUse
du parent (les 18 fichiers ont tous atterri dans `dirty.list`). Et le fix endpoints (R3.1) tient sur
le code neuf : les 5 endpoints `/api/v1/categories` sont captés. Le `project-brief` et `endpoints.yaml`
se régénèrent correctement après reindex.
