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
