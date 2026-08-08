# Rapport P2.5.2 — ScoreRepository et frontière WAL

## Statut

P2.5.2 est terminé en deux sous-lots distincts :

1. implémentation du contrat et migration de `useScoreManager` ;
2. isolation technique de `scoreWalExecutor`.

P2.5.3 n'est pas commencé.

Supabase reste l'unique implémentation active et la source de vérité.

## Dépendances supprimées

### Cycle potentiel via supabaseClient

Avant :

```text
ScoreRepository
  -> api/supabaseClient
     -> réexport de tous les api/modules
```

`ScoreRepository` utilisait cette façade uniquement pour `fetchHeatMetadata`. Il importe maintenant directement :

```text
api/modules/heats.api
```

La fonction appelée, son retour, ses requêtes et son comportement d'erreur n'ont pas changé. `api/supabaseClient.ts` reste intact comme façade de compatibilité et ne délègue à aucun repository.

Le cycle futur `supabaseClient -> repositories -> supabaseClient` est donc supprimé pour `ScoreRepository` avant toute évolution de la façade.

### Dépendance publique à Zustand

Avant, `ScoreRepository` importait directement `useOfflineStore` et enregistrait les deux mutations :

- `scores / insert / Score` ;
- `score_overrides / insert / ScoreOverrideLog`.

Après, il dépend de `scoreOfflineMutationAdapter`, frontière interne qui effectue exactement ces deux appels sur le store existant. Le contrat public `ScoreRepositoryContract` ne dépend ni de Zustand ni des types du store.

La logique du store, son middleware persist, IndexedDB, localStorage, FIFO et traitement de queue n'ont pas été déplacés.

## Implémentation explicite du contrat

La déclaration est maintenant explicite :

```ts
class ScoreRepository extends BaseRepository implements ScoreRepositoryContract
```

Les méthodes canoniques ajoutées délèguent aux méthodes historiques :

| Contrat canonique | Méthode legacy conservée |
|---|---|
| `save` | `saveScore` |
| `listByHeat` | `fetchScores` |
| `override` | `overrideScore` |
| `listOverrideLogs` | `fetchOverrideLogs` |
| `syncHeat` | `syncScores` |
| `syncPending` | `syncPendingScores` |

Les méthodes legacy restent publiques et inchangées pour rollback et pour les consommateurs hors périmètre P2.5.2.

## Mappings créés

Le fichier interne `scoreRepositoryMappings.ts` formalise les frontières suivantes :

- `SaveScoreRequest` canonique vers request legacy ;
- `OverrideScoreRequest` canonique vers request legacy ;
- `Score` legacy vers `ScoreRecord` ;
- `ScoreRecord` vers `Score` legacy ;
- `ScoreOverrideLog` vers `ScoreOverrideLogRecord` ;
- mapping retour override legacy vers canonique.

Correspondances explicites :

| Canonique | Legacy/Supabase |
|---|---|
| `lycraColor` | `surfer` |
| `heatId` | `heat_id` |
| `eventId` | `event_id` |
| `judgeId` | `judge_id` |
| `judgeName` | `judge_name` |
| `judgeStation` | `judge_station` |
| `judgeIdentityId` | `judge_identity_id` |
| `waveNumber` | `wave_number` |
| `createdAt` | `created_at` |

Les mappings de retour conservent exactement :

- UUID du score et du log ;
- `timestamp` et `created_at` comme deux valeurs distinctes ;
- station et identité juge ;
- couleur de lycra ;
- indicateur `synced` ;
- raison/commentaire d'override.

La génération des UUID n'est pas déplacée : `saveScore` et `overrideScore` continuent d'appeler `BaseRepository.generateId` aux mêmes endroits.

## Comportement saveScore avant/après

La méthode `saveScore` elle-même conserve :

1. normalisation du heat ID ;
2. génération UUID ;
3. création séparée de `timestamp` et `created_at` via `now()` ;
4. station fallback sur `judgeId` ;
5. création/validation du parent `heats` ;
6. RPC `upsert_score_secure` ;
7. fallback `.from('scores').upsert(..., onConflict: 'id')` uniquement si RPC indisponible ;
8. même politique retry/fallback de `BaseRepository.execute` ;
9. écriture IDB en ligne et hors ligne ;
10. événement `localScoresUpdated` ;
11. enregistrement WAL hors ligne.

La façade canonique `save` ne fait que mapper la requête, appeler `saveScore`, puis mapper son retour.

## WAL avant/après

### Avant

```text
scoreWalExecutor
  -> scoreRepository.saveScore / overrideScore
```

### Après

```text
scoreWalExecutor
  -> ScoreSyncAdapter
     -> scoreRepository.saveScore / overrideScore
```

`ScoreSyncAdapter` utilise volontairement les DTO legacy internes. Il ne traduit, ne stocke et ne réordonne rien.

Invariants confirmés :

- interface `OfflineMutation` inchangée ;
- propriétés `id`, `timestamp`, `table`, `action`, `payload` inchangées ;
- payload snake_case stocké inchangé ;
- aucune clé ajoutée ou retirée du stockage ;
- aucun changement de middleware Zustand/IDB ;
- FIFO interne inchangé ;
- suppression d'une mutation seulement après replay réussi inchangée ;
- verrou `syncInProgress` inchangé ;
- file legacy exécutée avant la WAL score inchangée ;
- aucune modification de `offlineSyncCoordinator`, `offlineStore`, `idbOfflineStore`, `idbStorage` ou `offlineOperations`.

Le test de frontière clone le payload avant replay et vérifie qu'il reste identique après l'appel pour score et override.

### UUID WAL legacy

Le comportement historique du replay est conservé strictement : `scoreWalExecutor` ne transmettait pas `payload.id` à `saveScore`, lequel génère un nouvel UUID de score. P2.5.2 ne corrige pas ce comportement car cela changerait l'observable WAL interdit dans ce lot. L'idempotence serveur caractérisée par P0 repose sur le replay d'une même mutation RPC avec le même ID ; l'écart entre cette fixture et l'exécuteur frontend reste un risque ouvert à auditer séparément avant toute correction.

## Imports migrés

Seulement deux consommateurs ont été migrés, dans l'ordre demandé :

1. `hooks/useScoreManager.ts`
   - utilise `save`, `override`, `syncHeat` ;
   - reconvertit les DTO canoniques en objets legacy avant mise à jour des stores UI ;
   - événements UI et formes de store inchangés.
2. `stores/scoreWalExecutor.ts`
   - utilise `ScoreSyncAdapter` ;
   - payload et mapping legacy inchangés.

Tous les autres consommateurs conservent leurs imports/méthodes historiques, notamment `useSupabaseSync`.

## Tests de parité ajoutés

### ScoreRepository

Quatre tests vérifient :

- `lycraColor -> surfer` ;
- station et identité juge ;
- aller-retour exact UUID/timestamps du score ;
- aller-retour exact du log d'override ;
- délégation de `ScoreRepositoryContract.save` vers `saveScore` sans branche alternative.

### WAL

Deux tests vérifient :

- payload score non muté et arguments de replay identiques à l'ancien exécuteur ;
- payload override non muté et arguments identiques.

Les tests préexistants confirment également :

- ordre file legacy puis WAL ;
- idempotence lorsqu'un replay est déjà en cours ;
- scoring P2 3/5, LWW, interférences et politique officielle.

## Validations par sous-lot

### Sous-lot A — contrat et useScoreManager

- typecheck : réussi ;
- suite : **32 fichiers, 183 tests réussis** ;
- build : réussi ;
- tests P0 Supabase locale isolée : perte d'accusé, refresh WAL, invariant lycra et timer réussis ;
- dump/restauration : comptes égaux, avertissements `auth` connus ;
- audit réseau P1 : aucune violation ;
- routes P1 : validées.

### Sous-lot B — ScoreSyncAdapter et scoreWalExecutor

- typecheck : réussi ;
- suite : **33 fichiers, 185 tests réussis** ;
- build : réussi, 2 368 modules et 48 entrées PWA précachées ;
- tests P0 Supabase locale isolée : seconde exécution réussie ;
- perte d'accusé : 1 ligne physique/1 ligne métier ;
- refresh WAL : 1 ligne, file vide après replay ;
- ordre/idempotence : tests unitaires verts ;
- invariant lycra : 2 scores ROUGE, aucun déplacé ;
- audit réseau P1 : aucune violation ;
- routes `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display` validées.

La restauration P0 obtient encore `restoreExitCode: 1` à cause des policies qui référencent le schéma `auth` absent de la base PostgreSQL nue. Les nombres restaurés sont identiques : 1 événement, 1 heat, 2 scores, 1 correction et 3 affectations juges. Le risque R15 reste ouvert.

## Casts supprimés et restants

### Supprimés/évités

- aucun cast existant n'a été supprimé dans ce lot, afin de ne pas élargir la modification des chemins de persistance ;
- aucune conversion `any` ou `unknown` n'est nécessaire dans les nouveaux mappings ;
- `ScoreRepository` ne traverse plus la façade large `api/supabaseClient` pour lire un heat ; le client Supabase sous-jacent reste inchangé ;
- le contrat public ne voit aucun type Zustand, Supabase ou PostgREST.

### Restants

- `(data || []) as RawScoreRow[]` dans `fetchScores` ;
- casts d'erreurs affinées dans `ScoreRepository` et `BaseRepository` ;
- `OfflineMutation.payload: any` et `registerMutation(... payload: any)` dans le store WAL ;
- double cast du client dans `lib/supabase.ts` ;
- casts heat/lineup dans `heats.api.ts`.

`OfflineMutation.payload` n'est volontairement pas retapé dans ce lot afin de ne pas modifier la structure WAL publique/persistée.

## Cycles restants

- `ScoreRepository -> scoreOfflineMutationAdapter -> offlineStore` reste une dépendance runtime interne unidirectionnelle ; `offlineStore` charge `scoreWalExecutor` dynamiquement, évitant un cycle d'import statique immédiat.
- `ScoreSyncAdapter -> ScoreRepository` est volontaire et interne au replay.
- `EventRepository -> HeatRepository` reste hors périmètre.
- `events.api -> heats.api` reste hors périmètre.
- les consommateurs mélangent encore repositories et `api/supabaseClient` hors des deux fichiers autorisés.

Le cycle potentiel précis via `ScoreRepository -> api/supabaseClient` est supprimé.

## Rollback

Le rollback reste simple et sans données :

- `useScoreManager` peut reprendre `saveScore`, `overrideScore`, `syncScores` ;
- `scoreWalExecutor` peut reprendre son import direct du singleton ;
- les méthodes legacy n'ont pas été supprimées ;
- aucun schéma, payload WAL ou stockage n'a changé ;
- les mappings et adaptateurs peuvent être retirés sans migration de données.

## Fichiers créés

- `frontend/src/repositories/internal/scoreRepositoryMappings.ts` ;
- `frontend/src/repositories/internal/scoreOfflineMutationAdapter.ts` ;
- `frontend/src/repositories/internal/scoreSyncAdapter.ts` ;
- `frontend/src/repositories/__tests__/ScoreRepository.contract.test.ts` ;
- `frontend/src/stores/__tests__/scoreWalExecutor.test.ts` ;
- `P2_5_2_SCORE_REPOSITORY_REPORT.md`.

## Fichiers modifiés

- `frontend/src/repositories/ScoreRepository.ts` ;
- `frontend/src/hooks/useScoreManager.ts` ;
- `frontend/src/stores/scoreWalExecutor.ts`.

Aucun SQL, timer, Cloud ↔ HP, ESP32, route P1, `event-box`, `beach` ou règle de scoring n'a été modifié.

## Risques ouverts

- écart d'UUID entre la fixture P0 lost-ack et le replay réel de `scoreWalExecutor`, conservé par contrainte de non-changement ;
- restauration PostgreSQL nue avec warnings `auth` et risque R15 ;
- dépendance interne du repository au store via l'adaptateur, à remplacer éventuellement par injection lors de la composition du registre ;
- DTO legacy et canoniques coexistent pendant la migration ;
- `useSupabaseSync` utilise encore les méthodes legacy ;
- type `any` du payload WAL, conservé pour compatibilité persistée ;
- validations terrain HP et Realtime plage toujours ouvertes.

## Critères de sortie P2.5.2

- [x] dépendance `ScoreRepository -> api/supabaseClient` supprimée ;
- [x] lecture heat limitée au module interne approprié ;
- [x] mappings score/save/override formalisés ;
- [x] `ScoreRepositoryContract` implémenté explicitement ;
- [x] chemin legacy save/RPC/fallback/IDB conservé ;
- [x] Zustand masqué derrière une frontière interne ;
- [x] `useScoreManager` seul migré au premier sous-lot ;
- [x] `scoreWalExecutor` migré séparément au second ;
- [x] payload, ordre et stockage WAL inchangés ;
- [x] validations complètes après chaque sous-lot ;
- [ ] approbation explicite avant P2.5.3.

P2.5.3 n'est pas commencé.
