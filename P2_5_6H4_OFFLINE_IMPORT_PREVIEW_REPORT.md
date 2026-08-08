# P2.5.6h4 — Offline XLSX Import UI + Preview

## Conclusion

**H4_PREVIEW_READY**

Le nouveau parcours opérateur local est disponible sur la route production existante `/participants`, derrière le bouton explicite **« Nouvel import hors ligne (preview sans écriture) »** :

```text
choisir CSV/XLSX local
  -> parsing canonique
  -> diagnostics
  -> preview participants par catégorie
  -> choix catégorie/format
  -> computeHeats
  -> BracketPreview en mémoire
  -> STOP
```

Le workflow CSV/Google historique reste inchangé et clairement séparé. Le workflow H4 ne persiste rien. P2.5.7 reste bloqué ; H5/H6 n'ont pas commencé.

## UI créée

`PlanningImportPanel` expose les états opérateur :

- `IDLE` ;
- `PARSING` ;
- `VALID` ;
- `INVALID` ;
- `PREVIEW_READY` ;
- `ERROR`.

Il affiche : nom et type de fichier, onglet XLSX retenu, lignes valides, erreurs, warnings, catégories détectées, participants groupés par catégorie, seed, nom, **Club / Pays** et licence.

La propriété canonique reste `country`; seul le libellé UI est « Club / Pays ».

Les diagnostics avec ligne sont présentés sous la forme actionnable `Ligne N — message`. Une erreur bloquante conserve `input=null` et masque toute action de génération de preview.

Le bouton final d'écriture est désactivé avec le texte imposé :

> Création en base indisponible tant que le contrôle de sécurité planning n'est pas activé.

## CSV/XLSX et import dynamique

- CSV : `parsePlanningCsv`, import statique léger ;
- XLSX : `await import('../adapters/planningImport/xlsxParser')` uniquement après sélection d'un `.xlsx` ;
- `read-excel-file` reste épinglé exactement en `9.2.0` ;
- aucun import statique de `xlsxParser` dans App, routes, `ParticipantsPage`, `ParticipantsStructure` ou composants de démarrage.

Les deux sources aboutissent au même `PlanningImportParseResult` et au même appel `computeHeats`. La source du fichier n'influence donc ni seeding, snake distribution, byes, hybrid, couleurs ou rounds.

## Multi-feuilles

La résolution H3 est conservée :

1. onglet `Participants` prioritaire ;
2. onglet unique automatiquement retenu ;
3. plusieurs onglets sans `Participants` affichent un sélecteur ;
4. le fichier est reparsé avec l'onglet choisi ;
5. aucun onglet n'est fusionné silencieusement.

Les métadonnées `workbookName`, `worksheetName` et `availableWorksheets` sont visibles ou utilisées par l'UI.

## Preview bracket

Le panneau appelle directement les fonctions existantes :

- `computeHeats` pour les règles de bracket ;
- `BracketPreview` pour le rendu.

L'opérateur choisit une catégorie et l'un des formats existants : élimination directe ou repêchage. La preview vit uniquement dans l'état React. Les actions d'export de `BracketPreview` sont masquées dans ce contexte afin de ne pas présenter de boutons sans effet.

Aucune logique de bracket n'a été copiée dans le panneau.

## Competition X.xlsx

Le test UI opt-in utilise le fichier terrain original via `REAL_COMPETITION_X_XLSX`, sans copie dans le dépôt.

Résultat observé :

- onglet `Feuil1` sélectionné automatiquement ;
- 62 participants ;
- 7 catégories ;
- répartition H3 conservée, dont OPEN 20 et CADET 13 vérifiés dans l'UI ;
- 8 warnings `EMPTY_ROW` ;
- aucune erreur bloquante ;
- preview participants disponible ;
- bracket OPEN généré en mémoire ;
- état final `PREVIEW_READY` ;
- zéro `fetch` et zéro `localStorage.setItem`.

## Preuve zéro persistance

Le test architectural inspecte le code H4 et interdit :

- Supabase ;
- `ParticipantRepository` / `participantRepository` ;
- `HeatPlanningRepository` / `heatPlanningRepository` ;
- `.from()` et `.rpc()` ;
- `upsertMany` et `createWithEntries` ;
- `localStorage` et IndexedDB.

Les tests de flux espionnent également `fetch` et `Storage.setItem` pendant parsing et génération de preview : aucun appel.

La page legacy conserve volontairement ses anciennes écritures localStorage pour son propre workflow CSV/Google. Elles ne sont jamais appelées par `PlanningImportPanel` et constituent le rollback production existant.

## Build, chunk et PWA

Comparaison H3 non branché / H4 branché :

| Mesure | H3 | H4 | Delta |
|---|---:|---:|---:|
| Modules transformés | 2 386 | 2 451 | +65 |
| Chunk principal brut | 466,98 kB | 468,35 kB | +1,37 kB |
| Chunk principal gzip | 144,74 kB | 145,16 kB | +0,42 kB |
| ParticipantsPage brut | 30,45 kB | 48,31 kB | +17,86 kB |
| ParticipantsPage gzip | 10,97 kB | 16,18 kB | +5,21 kB |
| Chunk XLSX brut | absent | 99,89 kB | chunk séparé |
| Chunk XLSX gzip | absent | 35,66 kB | chunk séparé |
| PWA precache | 46 entrées | 47 entrées | +1 |
| PWA total | 3 030,33 KiB | 3 157,40 KiB | +127,07 KiB |

Le service worker généré référence explicitement `assets/xlsxParser-Bk_wm5jr.js` dans `precacheAndRoute`. Le chunk est donc disponible hors ligne après installation du build PWA, sans être évalué ou chargé par la route au démarrage.

## Preuve offline

Les validations automatisées couvrent :

- `navigator.onLine=false` ;
- `fetch` forcé en erreur ;
- parsing du vrai XLSX ;
- preview participants ;
- génération du bracket ;
- zéro requête réseau applicative ;
- chunk dynamique présent dans le precache produit.

Un smoke Chromium production réel a été préparé dans `frontend/scripts/h4-offline-smoke.mjs`. Il vérifie le cache du chunk, coupe le réseau du contexte Chrome, sélectionne le vrai fichier et attend `PREVIEW_READY`. Son exécution a été refusée par la limite d'autorisation du runner au moment de la validation ; il n'est donc pas compté comme réussi dans ce rapport. Safari/WebKit reste également non exécuté, comme en H3.

## Tests

- UI CSV nominale + bracket mémoire ;
- CSV invalide, preview interdite lorsque `input=null` ;
- XLSX multi-feuilles et reparsing de l'onglet choisi ;
- zéro réseau et zéro stockage local ;
- vrai `Competition X.xlsx` opt-in ;
- tests parser H1/H3 et parité CSV/XLSX ;
- test architectural de frontière d'écriture ;
- TypeScript `tsc --noEmit` : réussi ;
- suite complète : **332 réussis, 3 opt-in ignorés** ;
- build Vite/PWA : réussi ;
- chunk XLSX séparé et précaché : confirmé statiquement dans `sw.js`.

L'avertissement WebSocket Vitest `listen EPERM` concerne son canal optionnel dans le sandbox et n'a empêché aucun test.

## Fichiers H4

Créés :

- `frontend/src/components/PlanningImportPanel.tsx` ;
- `frontend/src/components/__tests__/PlanningImportPanel.test.tsx` ;
- `frontend/src/components/__tests__/PlanningImportPanel.realCompetitionX.integration.test.tsx` ;
- `frontend/scripts/h4-offline-smoke.mjs` ;
- `P2_5_6H4_OFFLINE_IMPORT_PREVIEW_REPORT.md`.

Modifiés :

- `frontend/src/components/ParticipantsPage.tsx` : bouton/panneau expérimental ;
- `frontend/src/components/BracketPreview.tsx` : option pure d'affichage des actions export ;
- `frontend/src/domain/planningImport/__tests__/architecture.test.ts` : garde-fou H4.

Ni `event-box`, ni `beach`, ni SQL, repositories, statuts, `bulk_upsert_heats`, scoring, WAL, timer, Cloud↔HP, ESP32 ou routes P1 n'ont été modifiés.

## Rollback et risques ouverts

Rollback minimal : retirer le bouton et l'import de `PlanningImportPanel` dans `ParticipantsPage`. Le workflow legacy CSV/Google reste alors intégralement disponible ; aucune donnée ne nécessite restauration puisque H4 n'écrit rien.

Risques ouverts :

1. smoke Chromium production hors ligne préparé mais non exécuté à cause du runner ;
2. Safari/WebKit toujours à valider sur matériel disponible ;
3. augmentation de 127 KiB du precache, volontaire pour garantir l'import hors ligne ;
4. workflow legacy toujours persistant et distinct : l'opérateur doit utiliser le bouton explicitement marqué preview-only ;
5. aucune confirmation base ne doit être activée avant le contrôle de sécurité planning prévu dans une phase approuvée séparément.

**H4_PREVIEW_READY** : l'UI, le parsing, les diagnostics et les previews en mémoire sont prêts. Toute persistance reste volontairement bloquée.
