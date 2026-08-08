# P2.5.6h1 — Canonical Import Contract + CSV Normalization

## Conclusion

La frontière canonique d'import participants est créée et le parsing CSV local/Google converge désormais vers un pipeline unique :

```text
CSV text
  -> Papa Parse (adaptateur local)
  -> matrice neutre
  -> normalisation canonique des headers/lignes
  -> validation canonique
  -> PlanningImportParseResult
```

Le domaine et l'adaptateur CSV n'importent ni React, Supabase, repositories, stores, hooks ou APIs navigateur. Ils n'appellent ni `fetch`, `.from()` ou `.rpc()`.

Aucune dépendance XLSX n'a été installée. Aucun SQL, statut heat, `bulk_upsert_heats`, mécanisme destructif ou bouton final de planning n'a été modifié. P2.5.7 reste bloqué et H3/XLSX n'a pas commencé.

## Architecture créée

### Domaine pur

`frontend/src/domain/planningImport/` contient :

- `contracts.ts` : contrats canoniques et diagnostics ;
- `normalizeHeaders.ts` : normalisation et résolution des alias ;
- `normalizeRows.ts` : projection des cellules neutres et détection des lignes vides/invalides ;
- `validate.ts` : règles canoniques, doublons, libellés de catégorie et tri ;
- `index.ts` : exports du domaine.

Types publics :

- `PlanningImportSource` ;
- `PlanningImportParticipant` avec `sourceRow` ;
- `CanonicalPlanningInput` ;
- `PlanningImportDiagnostic` ;
- `PlanningImportParseResult` ;
- types neutres internes pour matrice/lignes.

### Adaptateur CSV

`frontend/src/adapters/planningImport/csvParser.ts` conserve Papa Parse uniquement comme décodeur CSV. Il ne possède aucune règle participant : il transforme le texte en matrice, puis délègue au domaine.

Le parsing local reste compatible avec `File.text()` et ne consulte jamais `navigator.onLine`. Il fonctionne avec le réseau désactivé.

## Normalisation des headers

Pipeline unique :

1. suppression du BOM initial ;
2. trim ;
3. passage en minuscules ;
4. décomposition Unicode NFD ;
5. suppression des diacritiques ;
6. ponctuation remplacée par un espace logique ;
7. espaces consécutifs réduits.

Alias supportés :

| Colonne | Alias |
|---|---|
| seed | `seed`, `classement`, `ranking`, `rank`, `tete`, `tête` |
| name | `name`, `nom`, `surfer`, `surfeur`, `athlete`, `athlète` |
| category | `category`, `categorie`, `catégorie`, `division` |
| country | `country`, `pays`, `nation`, `club`, `team`, `pays/club` |
| license | `license`, `licence`, `identifiant`, `id` |

`PAYS/CLUB`, `pays club` et leurs variantes de casse/ponctuation convergent vers la même clé.

## Diagnostics

### Erreurs bloquantes implémentées

- `EMPTY_FILE` ;
- `HEADER_MISSING` ;
- `REQUIRED_COLUMN_MISSING` ;
- `EMPTY_CATEGORY` ;
- `EMPTY_SEED` ;
- `INVALID_SEED` ;
- `DUPLICATE_SEED` ;
- `EMPTY_NAME` ;
- `INVALID_ROW` ;
- `DUPLICATE_PARTICIPANT` pour une licence non vide dupliquée ;
- `CSV_PARSE_ERROR` pour une erreur structurelle Papa Parse exploitable.

Chaque diagnostic porte sévérité, code, message, `sourceRow` et colonne canonique éventuelle.

### Warnings

- `EMPTY_ROW` pour une ligne intérieure entièrement vide ;
- `DUPLICATE_PARTICIPANT` pour un nom normalisé identique, sans licence, dans la même catégorie.

Une simple fin de fichier vide n'est pas présentée comme une ligne métier vide.

`CanonicalPlanningInput` vaut `null` dès qu'une erreur bloquante existe. Les lignes individuellement valides restent disponibles dans `validRows` à des fins de preview/diagnostic, mais elles ne constituent pas une entrée canonique confirmable.

## Catégories et seeds

La clé logique de catégorie est insensible à la casse, aux accents, espaces et ponctuation normalisée.

Exemple :

```text
OPEN MEN
Open Men
open men
```

Ces valeurs partagent la même clé pour les doublons. Le premier libellé valide rencontré devient le libellé d'affichage de toutes les lignes correspondantes.

Le seed doit être un entier strictement positif. Aucun fallback automatique n'existe.

Tri final déterministe :

1. clé de catégorie normalisée ;
2. seed croissant ;
3. `sourceRow` comme dernier ordre stable.

Ce tri ne modifie aucune règle de bracket ; il normalise seulement l'entrée.

## Règle duplicate participant

- licence non vide identique dans tout le fichier, comparaison normalisée : erreur `DUPLICATE_PARTICIPANT` ;
- licence absente et nom normalisé identique dans la même catégorie logique : warning `DUPLICATE_PARTICIPANT` ;
- même nom dans deux catégories distinctes : non bloquant dans ce lot.

`UNKNOWN_CATEGORY` n'a pas été introduit.

## Anciens parseurs et migration

### Parseur principal

`utils/csv.ts::parseCSVParticipants` est conservé comme façade de compatibilité, mais délègue désormais au pipeline canonique. Son retour historique `{ rows, errors }` reste disponible pour les composants existants.

`ImportParticipants` conserve :

- `File.text()` pour le fichier local ;
- le fetch Google existant ;
- ses callbacks et son workflow actuel.

Après obtention du texte, les deux sources passent par le même parseur. Le chemin Google précise `source='google_sheets'`; le fichier local utilise `source='csv'`.

### Parseur legacy

Le parseur dupliqué dans `ParticipantsPage` a été supprimé. Cette page utilise maintenant `parsePlanningCsv` pour le fichier local et le CSV Google.

Règles legacy volontairement abandonnées :

- catégorie manquante inventée à `OPEN` ;
- pays manquant inventé à `SENEGAL` ;
- nom manquant inventé à `Surfeur N` ;
- seed absent/invalide remplacé par le numéro de ligne.

Ces valeurs ne sont plus fabriquées silencieusement. La page legacy conserve sa persistance localStorage après succès ; aucune nouvelle persistance n'a été introduite.

## Frontière d'écriture

Le nouveau pipeline ne connaît aucune persistance. Le test architectural inspecte directement ses sources et interdit :

- Supabase ;
- `ParticipantRepository` ;
- `HeatPlanningRepository` ;
- repositories, hooks et stores ;
- `.from()` et `.rpc()` ;
- `fetch()` dans le domaine et l'adaptateur CSV local.

`ParticipantsStructure.handleImport` n'a pas été migré ou modifié. Son callback de persistance historique reste en dehors du pipeline. Aucun nouveau chemin d'écriture planning n'a été créé et le parser n'est pas connecté à une confirmation finale de heat planning.

Limite observable conservée : la façade UI principale peut encore transmettre ses `validRows` historiques même si d'autres lignes ont produit des erreurs, car modifier cette orchestration/persistance n'était pas autorisé dans H1. La future preview canonique devra exiger `input !== null` avant toute confirmation.

## Fichiers créés

- `frontend/src/domain/planningImport/contracts.ts`
- `frontend/src/domain/planningImport/normalizeHeaders.ts`
- `frontend/src/domain/planningImport/normalizeRows.ts`
- `frontend/src/domain/planningImport/validate.ts`
- `frontend/src/domain/planningImport/index.ts`
- `frontend/src/adapters/planningImport/csvParser.ts`
- `frontend/src/domain/planningImport/__tests__/csvParser.test.ts`
- `frontend/src/domain/planningImport/__tests__/architecture.test.ts`
- treize fixtures CSV sous `frontend/src/domain/planningImport/__fixtures__/`

## Fichiers modifiés

- `frontend/src/utils/csv.ts`
- `frontend/src/components/ImportParticipants.tsx`
- `frontend/src/components/ParticipantsPage.tsx`

Aucun repository, hook, store, migration ou fichier SQL n'a été modifié.

## Fixtures et tests

Fixtures :

- nominal ;
- plusieurs catégories ;
- seeds désordonnés ;
- seed dupliqué ;
- variations de casse catégorie ;
- catégorie accentuée ;
- headers français accentués avec BOM ;
- colonne obligatoire absente ;
- seeds invalides ;
- ligne vide intérieure ;
- licence absente ;
- licence dupliquée ;
- noms/pays/licences sénégalais et français accentués.

Les tests vérifient notamment :

- `sourceRow` exact ;
- diagnostics, sévérités et colonnes ;
- tri déterministe ;
- premier libellé de catégorie conservé ;
- parité du contenu canonique CSV local/CSV Google équivalent ;
- parsing avec `navigator.onLine=false` ;
- zéro appel `fetch` local ;
- zéro dépendance ou appel de persistance.

Résultats :

- tests ciblés : **16 réussis sur 16** ;
- typecheck `tsc --noEmit` : **réussi** ;
- suite complète : **318 réussis, 3 opt-in ignorés** ;
- build Vite production : **réussi**, 2 386 modules transformés ;
- PWA : 46 entrées précachées, environ 3 030 KiB ;
- audit réseau P1 : **réussi**, aucune violation statique ou runtime ;
- routes contrôlées : `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display`.

L'avertissement WebSocket Vitest `listen EPERM` provient du sandbox et n'empêche pas les suites.

## Impact production

Impact volontaire :

- tous les CSV participants utilisent les mêmes alias et validations ;
- les headers accentués sont désormais reconnus ;
- les catégories équivalentes en casse/accent partagent la même identité logique ;
- le tri devient catégorie puis seed ;
- le chemin legacy ne fabrique plus de données silencieuses.

Inchangé :

- fetch Google online ;
- sélection de fichier via `File.text()` ;
- callbacks UI existants ;
- écritures participants historiques en dehors du pipeline ;
- génération bracket et planning ;
- SQL et données persistantes.

## Rollback

Rollback limité au frontend :

1. restaurer l'ancien corps de `utils/csv.ts` ;
2. restaurer le parseur local dupliqué de `ParticipantsPage` ;
3. remettre les appels `parseCSVParticipants(text)` sans source explicite ;
4. supprimer les nouveaux modules/fixtures.

Aucune migration ou transformation de données n'est nécessaire.

## Risques ouverts

- L'UI principale peut encore persister un sous-ensemble valide malgré des erreurs sur d'autres lignes ; la future preview devra bloquer sur `input=null`.
- La règle « même licence dans tout le fichier » doit être confrontée aux fichiers terrain réels.
- Le premier libellé de catégorie dépend de l'ordre source, bien que le résultat soit ensuite trié ; ce comportement est explicite et déterministe pour un même fichier.
- Les catégories inconnues ne sont pas contrôlées dans H1.
- Aucun XLSX ou export Google XLSX n'est encore testé.
- Les statuts et la destructivité du planning restent bloquants selon P2.5.6g.

## État final

P2.5.6h1 est terminé côté code et validation. Aucun travail H3/XLSX ou P2.5.7 n'a commencé. Une validation explicite est requise avant la suite.
