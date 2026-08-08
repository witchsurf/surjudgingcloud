# P2.5.7 — Compatibility facade cleanup + architectural closure

Date : 8 août 2026
Périmètre : clôture architecturale P2.5 uniquement. Supabase reste l'unique source de vérité et l'unique implémentation active.

## Conclusion

**P2_5_ARCHITECTURE_READY**

La façade globale `api/supabaseClient.ts` n'est plus importée par le code de production. Elle reste intégralement disponible, explicitement dépréciée, comme façade de rollback et de compatibilité ancien schéma. Aucun export n'a été supprimé à l'aveugle. Les dépendances canoniques sont enregistrées dans un `RepositoryRegistry` complet et gelé. Aucun changement de règle métier, SQL, WAL, timer, Cloud ↔ HP, ESP32 ou route P1 n'a été introduit dans ce lot.

## Architecture obtenue

```text
UI / hooks / stores
  -> services d'orchestration ou repositories canoniques
  -> api/modules étroits (exceptions legacy documentées)
  -> lib/supabase
  -> Supabase local/cloud

domain pur
  -> aucun repository, api/modules ou Supabase

api/supabaseClient
  -> façade legacy/rollback uniquement, protégée par test architectural
```

Le registre actif expose exactement : `activeHeatPointer`, `events`, `heatLifecycle`, `heatPlanning`, `heats`, `judges`, `panels`, `participants`, `planningSafety`, `qualificationRecovery`, `scores`, `scoringReads`.

## Inventaire exhaustif de la façade de compatibilité

La classification porte sur l'import depuis **la façade globale**, et non sur l'utilisation de l'opération via son module étroit ou son repository. Après migration, tous les symboles ci-dessous sont en catégorie **rollback/compatibilité** : 0 consommateur production direct, 0 test direct, conservation volontaire. Les fonctions mortes du workflow moderne sont signalées séparément.

| Domaine | Exports de valeur conservés | Types conservés | Production via façade | Décision |
|---|---|---|---:|---|
| Client | `supabase`, `isSupabaseConfigured`, `getSupabaseConfig`, `getSupabaseMode`, `setSupabaseMode`, `isCloudLocked`, `setCloudLocked` | — | 0 | rollback ; les consommateurs modernes utilisent `lib/supabase` si nécessaire |
| Core | `ensureSupabase` | — | 0 | rollback ; adaptateur étroit `core.api` |
| Events | `fetchEvents`, `fetchLatestEventConfig`, `updateEventConfiguration`, `fetchDistinctDivisions`, `fetchEventConfigSnapshot`, `saveEventConfigSnapshot`, `ensureEventExists`, `fetchEventIdByName` | `EventSummary`, `EventConfigRecord`, `EventConfigSnapshot` | 0 | rollback ; `EventRepository` implémente désormais le contrat canonique |
| Participants | `fetchParticipants`, `upsertParticipants`, `updateParticipant`, `deleteParticipant` | `ParticipantRecord` | 0 | rollback ; `ParticipantRepository` canonique actif |
| Heat planning | `createHeatsWithEntries`, `deletePlannedHeats` | `CreateHeatsOptions` | 0 | rollback ; création moderne atomique via service sûr ; suppression legacy destructive conservée mais interdite aux consommateurs modernes |
| Heat reads | `fetchOrderedHeatSequence`, `fetchCategoryHeats`, `fetchAllEventCategories`, `fetchAllEventHeats`, `fetchHeatEntriesWithParticipants`, `fetchHeatEntriesWithParticipantsBatch`, `fetchHeatSlotMappings`, `fetchHeatSlotMappingsBatch`, `fetchHeatMetadata` | `HeatRow`, `HeatEntryRow`, `HeatSlotMappingRow`, `HeatEntriesWithParticipantRow` | 0 | rollback ; lectures canoniques via `HeatRepository` |
| Pointer/panel | `fetchActiveHeatPointer`, `upsertActiveHeatPointer`, `fetchPodiumJudgePanel`, `setPodiumJudgePanel`, `fetchHeatJudgeAssignments`, `fetchEventJudgeAssignments`, `fetchPanelContext`, `fetchPanelContexts`, `parseActiveHeatId` | `ActiveHeatPointer`, `PodiumJudgeAssignment`, `HeatJudgeAssignmentRow`, `PanelContext`, `PanelContextIssue`, `PanelSource` | 0 | rollback ; repositories dédiés et cache canonique |
| Lifecycle/recovery | `activateHeatOnPodium`, `closeHeatOnPodium`, `propagateQualifiersForSourceHeat`, `rebuildDivisionQualifiersFromScores`, `validateHeatStartDependencies` | `PodiumHeatTransitionResult`, `HeatStartDependencyBlocker`, `HeatStartDependencyCheck` | 0 | rollback ; lifecycle nominal séparé des chemins recovery |
| Heat mutations/runtime | `upsertHeatRealtimeConfig`, `replaceHeatEntries`, `adminOverrideHeatEntry`, `subscribeToHeatUpdates` | `HeatRealtimeConfigWriteInput`, `HeatEntryOverrideInput`, `HeatEntryOverrideResult` | 0 | rollback ; repositories ou modules étroits documentés |
| Scoring identity/read | `normalizeScoreJudgeId`, `SCORE_SURFER_MAP`, `normalizeScoreSurfer`, `scoreTimestampMs`, `toParsedScore`, `canonicalizeScores`, `fetchHeatScores`, `fetchScoresForHeats`, `fetchAllScoresForEvent`, `fetchCanonicalScoresForEvent`, `fetchPreferredScoresForEvent` | `RawScoreRow` | 0 | rollback ; moteur P2 et `ScoringReadRepository` canoniques |
| Scoring diagnostics | `fetchEventJudgeAssignmentCoverage`, `fetchEventJudgeAccuracySummary`, `fetchHeatCloseValidation`, `fetchHeatCloseReadiness`, `fetchHeatMissingScoreSlots` | `EventJudgeAssignmentCoverageRow`, `EventJudgeAccuracySummaryRow`, `HeatMissingScoreSlotRow`, `HeatCloseValidationResult` | 0 | rollback ; modules étroits conservés sans changement observable |
| Scoring mutations | `applyScoreCorrectionSecure`, `deleteScoreSecure`, `recordScoreOverrideSecure` | `SecureScoreCorrectionInput`, `SecureScoreDeletionInput`, `SecureScoreOverrideInput` | 0 | rollback ; frontière ScoreRepository/WAL validée SAFE |
| Interférences | `fetchInterferenceCalls`, `fetchAllInterferenceCallsForEvent`, `upsertInterferenceCall`, `deleteInterferenceCall` | — | 0 | rollback ; module étroit conservé, règles inchangées |
| Juges | `fetchActiveJudges`, `fetchJudgeById`, `validateJudgeCode`, `createJudge`, `updateJudge`, `deactivateJudge`, `updateJudgeName` | `Judge` | 0 | rollback ; `JudgeRepository` canonique actif |

Statut des exports potentiellement morts : `deletePlannedHeats` n'a aucun consommateur UI/service moderne et reste uniquement un mécanisme legacy/rollback explicitement destructif. Aucun export n'est supprimé dans P2.5.7 afin de préserver la réversibilité et les anciens schémas.

## Imports migrés et exceptions étroites

Les 19 consommateurs de la façade globale ont été migrés. Sont concernés notamment `AdminInterface`, `JudgeInterface`, `DisplayPage`, `OverlayPage`, `ScoreDisplay`, `HeatResults`, `GenerateHeatsPage`, `ParticipantsStructure`, `PriorityJudgePage`, les hooks heat/realtime/sync et les stores/configurations.

Les imports directs résiduels vers `api/modules` sont des adaptateurs étroits documentés : analytics juges, interférences, realtime et structures heat legacy qui ne relèvent pas d'un calcul sportif. Ils ne réintroduisent pas la façade globale. Le test architectural interdit tout nouvel import de `api/supabaseClient` en production.

Le CSV/XLSX **moderne** de planning passe bien par preview → preflight → `persistPlanningImportSafely` → safe v2. Les écrans CSV/Google Sheets historiques de `ParticipantsPage` et `ImportParticipants` restent explicitement marqués legacy/rollback : ils importent des participants, pas un bracket, et ne doivent donc pas être décrits comme passant par safe v2. Google Sheets exige Internet et n'appartient pas au workflow terrain hors ligne recommandé ; aucun appel Google n'est déclenché par le health-check ou par le smoke terrain.

## `createHeat` runtime

Le seul chemin runtime identifié est :

```text
AdminPage / useHeatManager
  -> useSupabaseSync.createHeat
  -> HeatRepository.createRuntime
  -> upsert de la ligne heat existant
  -> initialisation realtime existante, séparée
```

Décision : la création runtime reste dans `HeatRepository`, distincte de `HeatPlanningRepository` et de `HeatLifecycleRepository`. Le contrat `RuntimeHeatCreateRequest` remplace le payload `any`. La normalisation historique `open -> waiting` est conservée exactement, ainsi que l'ID, le timestamp, le payload snake_case et le fallback offline. Aucun appel planning, scoring ou lifecycle n'est ajouté.

## Sécurité planning legacy

`deletePlannedHeats` reste disponible pour rollback mais est marqué déprécié et destructif. Aucun composant, page, hook, store ou service moderne ne peut l'appeler ; un test statique interdit également `bulk_upsert_heats`, `bulk_upsert_heats_safe` et `.deletePlanned(...)` dans ces couches. Le workflow H4 continue d'utiliser exclusivement `persistPlanningImportSafely` et la RPC atomique validée précédemment.

## Typage et casts

Mesure sur les chemins ciblés (`as any`, `as unknown as`, `: any`, `<any>`) :

| Fichier | Avant ce nettoyage | Après |
|---|---:|---:|
| `api/modules/heats.api.ts` | 0 structurel ciblé | 0 |
| `repositories/HeatRepository.ts` | 6 paramètres structurels `any` plus création runtime non typée | 0 |
| `hooks/useSupabaseSync.ts` | 0 | 0 |
| participants API/repository | 0 | 0 |
| juges API/repository | 0 | 0 |
| `hooks/useHeatManager.ts` | 14 | 14 |

Les 14 casts de `useHeatManager` restent un risque de typage d'orchestration complexe (séquence, mappings et anciens retours). Ils ne franchissent plus la frontière publique repository et leur suppression nécessiterait un lot fonctionnel distinct. `EventRepository.updateConfiguration` conserve un cast de compatibilité vers `AppConfig`, sans modifier la sérialisation existante.

## Dépendances, cycles et contrats

- `domain` ne dépend d'aucun repository, module API ou Supabase.
- `api/modules` peut importer uniquement des **types** de `repositories/contracts`, jamais une implémentation repository.
- les repositories ne dépendent pas de la façade globale.
- `ScoringReadRepository` implémente le contrat de lecture scoring et mappe les formes existantes vers les DTO canoniques.
- `EventRepository` implémente explicitement `EventRepositoryContract`.
- `RepositoryRegistry` est complet, unique et `Object.freeze` empêche sa mutation accidentelle.
- Aucun cycle runtime canonique n'est détecté par les tests architecturaux.

## Moderne vs legacy et rollback

| Moderne | Legacy/rollback |
|---|---|
| contrats purs + registre | `api/supabaseClient.ts` |
| repositories par responsabilité | fonctions brutes regroupées |
| services explicites pour orchestration/planning sûr | planning destructif historique |
| modules API étroits derrière repositories | import global réactivable fichier par fichier |

Rollback : chaque migration d'import peut revenir à l'export équivalent de `api/supabaseClient.ts`. Aucun export, payload, RPC, fallback ou stockage n'a été supprimé. La façade n'est pas débranchée du build ; seul son usage nouveau est bloqué par test.

## Validations exécutées

| Validation | Résultat |
|---|---|
| `tsc --noEmit` | réussi |
| suite Vitest complète | **64 fichiers réussis, 365 tests réussis, 6 fichiers/7 tests opt-in ignorés** |
| tests architecturaux P2.5.7 | 5/5 réussis |
| scoring P0/P2, panel, lifecycle, qualification, planning, timer | inclus dans la suite complète, verts |
| WAL score réel sur Supabase local | 1/1 réussi ; ACK perdu, double coordinateur, refresh, retour réseau, LWW 9 conservé, nettoyage final |
| WAL override réel sur Supabase local | 1/1 réussi ; identité log/score, ACK perdu, anciennes WAL, erreurs conservées, nettoyage final |
| vrai `Competition X.xlsx`, parser + UI preview | 2/2 réussis ; 62 participants, 5 heats ; médiane parse 173,14 ms |
| persistance UI atomique Competition X | 1/1 réussi sur événement temporaire créé puis nettoyé |
| smoke PWA hors Internet | réussi : `internet:false`, `lanSupabase:true`, XLSX précaché, 62 participants, 5 heats, 0 heat actif |
| build Vite/PWA | réussi ; 2 455 modules, 48 entrées précachées |
| audit réseau P1 statique + runtime | réussi ; aucune violation ; `/admin`, `/chief-judge -> /admin`, `/judge`, `/priority`, `/display` HTTP 200 |
| syntaxe script terrain requise par AGENTS.md | non modifiée dans ce lot ; aucun script HP touché |

Note d'environnement : Vitest affiche sous sandbox un avertissement non bloquant `listen EPERM` pour son websocket HMR ; les tests terminent normalement. L'audit P1 a été rejoué hors restriction de port et est entièrement vert.

## Fichiers créés ou structurants

- `frontend/src/repositories/RepositoryRegistry.ts`
- `frontend/src/repositories/ScoringReadRepository.ts`
- `frontend/src/repositories/contracts/heats.ts`
- `frontend/src/repositories/__tests__/compatibilityClosure.test.ts`
- `frontend/src/repositories/__tests__/HeatRepository.mutations.test.ts`
- `frontend/src/api/supabaseClient.ts`
- `frontend/src/repositories/EventRepository.ts`
- `frontend/src/repositories/HeatRepository.ts`
- `frontend/src/hooks/useSupabaseSync.ts`
- consommateurs listés dans la section Imports migrés
- présent rapport

## Risques restant ouverts

1. Les validations terrain déjà connues restent nécessaires : smoke sur le véritable HP et Realtime sur le réseau plage.
2. La façade globale est volontairement encore compilable pour rollback ; le test architectural est le garde-fou contre sa réintroduction.
3. Les 14 formes `any` de `useHeatManager` restent une dette localisée d'orchestration.
4. Certains adaptateurs `api/modules` restent directement consommés pour les responsabilités legacy non encore contractualisées ; ils sont étroits et inventoriés.
5. La divergence PostgreSQL déjà documentée demeure : la base accepte encore la note `0` et une précision supérieure à une décimale, alors que le moteur P2 impose `0,1–10,0` à une décimale.
6. Le risque de restauration complète Supabase et le risque R15 restent ouverts selon les registres P0/P1.

## Critères de clôture

- façade globale sans consommateur production : atteint ;
- exports inventoriés et rollback conservé : atteint ;
- repositories/registre canoniques complets : atteint ;
- création runtime caractérisée et séparée du planning : atteint ;
- planning destructif absent du workflow moderne : atteint ;
- frontières heat/participants/juges sans casts structurels ciblés : atteint ;
- suite, build, audit réseau, WAL réel, Competition X et offline : atteints ;
- aucun changement métier ou infrastructure hors périmètre : atteint.

P2.5.7 s'arrête ici. Aucune phase suivante n'est commencée.
