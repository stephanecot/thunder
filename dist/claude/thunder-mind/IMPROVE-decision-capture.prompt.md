> ## 🟢 ÉTAT — FAIT ET VALIDÉ
> Capture fiabilisée : déclencheur `record` élargi (conventions/préférences, FR+EN) ; hook `UserPromptSubmit` (capture-hint, EN/FR, silencieux sinon) ; `add` tolère les fences ```json ; scribe déjà "JSON only". Modèle à paliers ajouté (constitution tier-0 bornée + cartes par domaine + recall) : démarrage plat (~5.8KB à 200 comme à 2000 décisions), zéro perte (domain-map+recall couvrent 100%). Tests 29/29 + cas fences/paliers/no-loss. Historique ci-dessous.
> Problème observé : enregistrer une décision **n'a pas marché du premier coup**. Quand l'utilisateur
> a énoncé une convention en langage naturel (« pour ce projet tu devrais toujours faire de la qualité »),
> l'IA n'a **pas déclenché** `thunder-mind-record` — elle a rangé la consigne dans sa mémoire privée, donc
> aucun fichier de décision créé et `recall` ne trouvait rien. L'écriture elle-même (`add`) fonctionne une
> fois invoquée ; le défaut est dans l'**amorçage** (déclenchement) et la **fragilité du flux multi-étapes**.

---

# Objectif : rendre la CAPTURE d'une décision fiable au premier essai

Une décision n'est utile que si elle est **enregistrée** quand elle est énoncée. Aujourd'hui ça dépend
entièrement du jugement du modèle (va-t-il invoquer `record` ?) et d'un flux manuel à plusieurs étapes
(recall → agent scribe → JSON sur stdin → `add`) où chaque étape peut rater. On veut : (a) le bon
déclencheur, (b) un filet de sécurité indépendant du modèle, (c) un flux qui ne casse pas au 1er coup.

## Reproduction (mesurée sur `aura/frontend`)
- L'utilisateur énonce une convention conversationnelle (FR, non-impérative) → `thunder-mind-record`
  ne se déclenche pas (la `description` du skill ne couvre que « record this decision », « from now on
  we do Y »…). → aucune capture.
- Une fois invoqué manuellement, l'agent **scribe renvoie son JSON entouré de ```json fences** → il a fallu
  retirer les fences à la main avant `add` (point de casse potentiel si l'IA pipe la sortie verbatim).
- `add` lui-même a écrit correctement du premier coup une fois le JSON propre fourni.

## Changements demandés, par ordre d'impact

### 1. [P0 — corrige « il n'a pas enregistré »] Élargir le déclenchement de `thunder-mind-record`
Fichier : `skills/thunder-mind-record/SKILL.md` (frontmatter `description:`).
La `description` actuelle ne matche que des formulations impératives explicites. Ajoute les cues de
**convention / préférence / directive de comportement** et **multilingue**, par ex. :
« when the user states a standing convention or preference, not just an explicit 'record this' — e.g.
'always do X for this project', 'from now on', 'we should always', 'tu devrais toujours', 'on standardise',
'à partir de maintenant', 'la règle c'est…' ». But : qu'une convention énoncée en passant déclenche le
skill. (Idéalement, ajouter aussi à `thunder-mind-recall` un cue « before adopting a convention/preference,
recall first ».)

### 2. [P1 — filet de sécurité, indépendant du modèle] Hook de capture
Fichier : `hooks/hooks.json` (n'a aujourd'hui que `SessionStart`→`ensure` et `PostToolUse`→dirty).
Ajoute un **`UserPromptSubmit`** qui scanne le message utilisateur pour un langage de décision
(`always|from now on|we should|standardi[sz]e|toujours|à partir de maintenant|on décide|la règle`) et,
en cas de match, émet **une ligne de rappel** dans le contexte : « ↳ this looks like a project decision —
capture it with /thunder-mind:thunder-mind-record ». Léger, déterministe, ne force rien mais rend la capture
quasi-systématique. (Variante complémentaire : un hook **`Stop`** qui lance `harvest` en fin de tour pour
balayer les décisions non enregistrées — réutilise le skill `thunder-mind-harvest` déjà présent.)

### 3. [P1 — corrige « l'enregistrement a foiré au 1er essai »] Durcir le flux record
a) **`add` doit tolérer le JSON encadré de fences.** Dans le handler `add` (engine `thunder.mjs`, parsing
   du stdin avant `JSON.parse`), strip un éventuel wrapper ```json … ``` (et espaces) avant de parser.
   Aujourd'hui un pipe direct de la sortie scribe (`echo '<scribe>' | … add`) risque d'échouer sur les fences.
b) **OU** faire que l'agent scribe (`agents/thunder-mind-scribe.md`) renvoie du **JSON brut sans fences**
   (instruction explicite « no markdown fences, raw JSON only »). Faire les deux est plus robuste.
c) Optionnel : exposer une commande **`record` one-shot** qui enchaîne scribe→validate→write, pour que le
   skill n'ait qu'un seul appel à orchestrer (moins d'étapes manuelles = moins de ratés au 1er coup).

## Acceptance criteria (à prouver)
- Énoncer une convention en langage naturel (FR et EN, non-impérative) déclenche `thunder-mind-record`
  sans que l'utilisateur ait à dire « record ». (Tester via la `description` mise à jour + le hook.)
- `echo '```json\n{…}\n```' | node thunder.mjs add <root>` réussit (fences tolérées) — ajouter un test.
- Le scribe renvoie un JSON parsable tel quel (pas de fences) — vérifier sur un cas.
- Round-trip complet en un essai : énoncé → record → `recall "<kw>"` retrouve la décision (matched ≥ 1).

## Garde-fous
- **Index en anglais uniquement** (le scribe normalise ; ne pas laisser passer du non-anglais dans les YAML).
- Ne pas casser le `add` existant (le chemin JSON-propre doit continuer de marcher) ni le schéma de décision.
- Le hook `UserPromptSubmit` doit rester **léger et silencieux** quand il n'y a pas de match (zéro bruit).
- Garder le store de décisions et le cycle stale/reindex intacts ; `node --test engine/test/` vert + les
  nouveaux tests (fences, déclenchement).

> Note hors-scope (à traiter séparément si voulu) : le store est résolu sous `CLAUDE_PROJECT_DIR`
> (= sous-projet, ex. `aura/frontend/.thunder/mind`) alors que la racine git est le monorepo `aura/`.
> Pour un index réellement *partagé* entre deux devs sur des sous-projets différents, il faudrait le
> résoudre à la **racine git**. Ce n'est PAS l'objet de ce prompt (qui porte sur la capture au 1er coup).
