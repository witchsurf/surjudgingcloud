# P2.5.6h3 — XLSX Offline Spike + Real File Characterization

## Conclusion

**GO pour préparer H4**, avec `read-excel-file` **épinglé en 9.2.0** et chargé ultérieurement de façon paresseuse. Le classeur terrain réel est accepté hors ligne et produit exactement l'entrée canonique attendue. Le parser reste un spike non branché à l'UI et ne possède aucun chemin de persistance.

P2.5.7 reste bloqué. Aucun appel Supabase, repository, SQL, planning ou écriture participant n'a été ajouté.

## Fichier terrain caractérisé

Source lue sans modification : `Competition X.xlsx`.

- taille : 76 200 octets ;
- SHA-256 avant et après les tests : `6571d2706e5e8b6e3425ecf65304d1e97bc4e7457d65d083d818b9efd6bdcd5b` ;
- onglets disponibles : `Feuil1` ;
- onglet automatiquement retenu : `Feuil1` ;
- en-têtes : `SEED | NAME | CLUB | LICENCE | CATEGORY` ;
- 71 lignes XLSX lues, dont l'en-tête et 8 lignes intérieures entièrement vides ;
- 62 participants valides ;
- aucune erreur seed, nom, catégorie ou doublon de seed dans une catégorie ;
- toutes les licences du fichier sont vides et acceptées.

Répartition retrouvée automatiquement :

| Catégorie | Participants |
|---|---:|
| OPEN | 20 |
| CADET | 13 |
| BENJAMIN | 8 |
| JUNIOR | 6 |
| ONDINE U16 | 6 |
| ONDINE OPEN | 5 |
| MINIME | 4 |
| **Total** | **62** |

Ces nombres sont uniquement des assertions de la fixture terrain, pas des règles métier.

Les lignes vides produisent le warning canonique `EMPTY_ROW`. Elles n'arrêtent pas le parsing et les lignes suivantes conservent leur véritable `sourceRow`.

## Pipeline et sélection d'onglet

Le spike suit exclusivement :

```text
File / Blob / ArrayBuffer local
  -> read-excel-file
  -> matrice neutre de cellules texte
  -> normalizePlanningHeaders (H1)
  -> normalizePlanningRows (H1)
  -> validatePlanningRows (H1)
  -> PlanningImportParseResult + métadonnées workbook
```

L'adaptateur XLSX ne contient aucune règle participant. Il retourne `workbookName`, `worksheetName` et `availableWorksheets`.

Règle testée :

1. `Participants` est choisi s'il existe ;
2. un onglet unique, tel que `Feuil1`, est choisi automatiquement ;
3. plusieurs onglets sans `Participants` retournent `WORKSHEET_SELECTION_REQUIRED` ;
4. une sélection explicite absente retourne `WORKSHEET_NOT_FOUND` ;
5. plusieurs onglets ne sont jamais fusionnés.

Mapping réel délégué aux alias canoniques H1 :

| XLSX | Canonique |
|---|---|
| SEED | seed |
| NAME | name |
| CLUB | country |
| LICENCE | license |
| CATEGORY | category |

`CLUB` reste un alias de `country`; aucun champ canonique supplémentaire n'a été créé.

## Bibliothèque retenue

- bibliothèque : `read-excel-file` ;
- version retenue et épinglée : **9.2.0** ;
- licence : MIT ;
- dépendances directes déclarées : `@xmldom/xmldom ^0.9.10`, `fflate ^0.8.3`, `unzipper-esm ^0.13.0` ;
- versions résolues : `@xmldom/xmldom 0.9.10`, `fflate 0.8.3`, `unzipper-esm 0.13.3`, ce dernier utilisant `graceful-fs 4.2.11` et `node-int64 0.4.0` ;
- `fflate 0.8.3` est dédupliqué avec la dépendance déjà utilisée par `jspdf`.

La version 9.3.5 a été évaluée en premier. Ses entrées `browser` et `universal` échouent sur le chemin multi-feuilles avec `readFiles(...).then is not a function`. La version 9.2.0 passe les mêmes tests et le fichier réel. Elle est donc épinglée sans plage `^` afin d'éviter une réintroduction silencieuse de cette régression. SheetJS CE n'a pas été retenu ni installé, car la solution prioritaire fonctionne après épinglage.

## Types Excel et licences

Les fixtures synthétiques vérifient :

- seed Excel numérique `1` -> seed canonique `1` ;
- seed texte numérique `"2"` -> seed canonique `2` ;
- licence texte `"00123"` -> `"00123"`, zéro initial conservé ;
- licence numérique Excel `456` -> chaîne canonique `"456"`.

Limite : si Excel a déjà stocké une licence comme nombre, le format numérique ne contient plus nécessairement les zéros initiaux saisis. Le parser ne peut pas reconstruire une information absente du fichier. Une licence dont les zéros sont significatifs doit rester une cellule texte dans le classeur.

## Parité CSV/XLSX

Une matrice XLSX et un CSV équivalents produisent exactement :

- les mêmes `validRows` ;
- les mêmes erreurs ;
- les mêmes warnings ;
- les mêmes numéros `sourceRow`.

Les deux adaptateurs convergent vers les fonctions H1 existantes ; aucune validation XLSX parallèle n'a été créée.

## Offline et frontière d'écriture

Les tests positionnent `navigator.onLine=false`, remplacent `fetch` par une fonction qui échoue et vérifient zéro appel. Le fichier réel reste parsé correctement. Le test architectural interdit dans le domaine et les adaptateurs d'import : Supabase, repositories, hooks, stores, `.from()`, `.rpc()` et `fetch()`.

L'audit réseau P1 du build terrain réussit : aucune violation statique ou runtime sur `/admin`, `/chief-judge`, `/judge`, `/priority` et `/display`.

## Mesures build et performance

### Build production/PWA

Le spike n'est importé par aucun composant de production. Le build avant/après reste donc identique :

| Mesure | H1 | H3 non branché | Delta |
|---|---:|---:|---:|
| Modules Vite | 2 386 | 2 386 | 0 |
| Chunk ParticipantsPage brut | 30,45 kB | 30,45 kB | 0 |
| Chunk ParticipantsPage gzip | 10,97 kB | 10,97 kB | 0 |
| PWA precache | 46 entrées | 46 entrées | 0 |
| PWA precache total | 3 030,33 KiB | 3 030,33 KiB | 0 |

Le build isolé du futur adaptateur représente 68 modules, **196,25 kB brut / 55,15 kB gzip**. Cette mesure inclut l'adaptateur, `read-excel-file` et le pipeline canonique nécessaires à l'entrée du spike. H4 devra conserver un import dynamique afin de ne charger ce coût qu'à l'ouverture de l'import XLSX.

### Parsing du fichier réel

- exécution isolée initiale : environ 253 ms ;
- médiane sous suite complète, cinq parsings : environ 383 ms ;
- variation mémoire Node/jsdom approximative sur cinq parsings : +37 MiB, mesure incluant allocations et GC non forcé, donc non assimilable au pic navigateur.

Le fichier de 76 kB et ses 62 participants ne présentent pas de risque de performance terrain observé.

### Navigateurs

- Chromium : bundle ESM généré avec succès et audit runtime P1 exécuté dans Chromium/Chrome ;
- Safari/WebKit : aucun moteur Playwright WebKit n'était installé dans l'environnement, donc pas de validation d'exécution réelle dans ce lot ;
- le code utilise `Blob`/`ArrayBuffer`, Promises et ESM standards, mais un smoke test Safari sur matériel réel reste requis avant H4 terrain.

## Tests et validations

- tests XLSX synthétiques : 6/6 ;
- test opt-in `Competition X.xlsx` réel : 1/1 ;
- suite complète : **326 réussis, 3 opt-in ignorés** ;
- TypeScript `tsc --noEmit` : réussi ;
- build production : réussi ;
- build isolé XLSX : réussi ;
- audit réseau P1 : réussi, aucune violation ;
- original terrain : checksum inchangé.

L'avertissement Vitest `listen EPERM` concerne uniquement son serveur WebSocket optionnel dans le sandbox et n'a empêché aucun test.

## Fichiers H3

Créés :

- `frontend/src/adapters/planningImport/xlsxParser.ts` ;
- `frontend/src/adapters/planningImport/__tests__/xlsxParser.test.ts` ;
- `frontend/src/adapters/planningImport/__tests__/realCompetitionX.integration.test.ts` ;
- `frontend/src/spikes/xlsxBundleEntry.ts` ;
- `frontend/vite.xlsx-spike.config.ts` ;
- `P2_5_6H3_XLSX_OFFLINE_SPIKE_REPORT.md`.

Modifiés :

- `frontend/package.json` et `frontend/package-lock.json` pour la dépendance épinglée ;
- `frontend/src/domain/planningImport/contracts.ts` pour les diagnostics d'onglet/XLSX ;
- le test architectural H1 pour couvrir également l'adaptateur XLSX.

Le classeur réel n'a pas été copié dans le dépôt, afin de ne pas y introduire de données terrain. Son test est opt-in via `REAL_COMPETITION_X_XLSX`.

## Risques et recommandation H4

Risques ouverts :

1. régression confirmée en 9.3.5 : conserver strictement 9.2.0 jusqu'à caractérisation d'une version ultérieure ;
2. coût futur de 55,15 kB gzip : imposer un chargement dynamique en H4 ;
3. zéros initiaux irrécupérables si Excel stocke la licence en nombre ;
4. WebKit/Safari non exécuté dans cet environnement ;
5. les 25 vulnérabilités npm déjà signalées au niveau du projet restent à auditer séparément ; aucune mise à niveau automatique n'a été effectuée.

**GO H4 conditionnel** : H4 peut préparer la preview opérateur en conservant l'absence totale de persistance, l'import dynamique et l'épinglage 9.2.0. Aucun branchement production ou passage à H5/H6/P2.5.7 n'est autorisé par ce rapport.
