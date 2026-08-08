# P2.5.0 — Matrice des opérations de données

## Périmètre et lecture

Inventaire statique de `frontend/src/api/supabaseClient.ts`, `frontend/src/api/modules/*` et `frontend/src/repositories/*` au démarrage de P2.5.

`api/supabaseClient.ts` ne contient pas d'opération métier propre : il réexporte `lib/supabase` et toutes les opérations de `api/modules`. Ses consommateurs sont donc reportés sur l'opération d'origine. Aucun import consommateur n'a été modifié pendant P2.5.0/P2.5.1.

Abréviations :

- **API** : fonction actuelle de `api/modules` ;
- **Repo** : classe repository actuelle ;
- **WAL** : file durable d'écritures de score exécutée par `stores/scoreWalExecutor.ts` ;
- **LS/IDB** : localStorage/IndexedDB ;
- **futur** : propriétaire proposé, non branché pendant P2.5.1.

## Infrastructure et façade

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| `supabase`, `isSupabaseConfigured`, `get/setSupabaseMode`, verrou cloud | nombreux modules via `supabaseClient` ou `lib/supabase` | infrastructure Supabase, hors repository métier | configuration client | endpoint local/variables Vite | non | client/état | choisit local/cloud et protège le mode terrain |
| `ensureSupabase` | tous les modules API | adaptateur Supabase interne | aucun | aucun | non | `void`/exception | bloque explicitement si Supabase n'est pas configuré |
| `BaseRepository.execute` | tous les repositories classes | infrastructure repository Supabase | selon opération | retry puis fallback seulement sur erreurs transitoires | indirect | générique | auth, RLS et contraintes restent bloquantes |
| `api/supabaseClient.ts` | 31 fichiers de composants/pages/hooks/stores | façade de compatibilité, puis `RepositoryRegistry` | réexports | ceux des modules | indirect | identique au module | point central historique, sans logique propre |

## Événements et configuration

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| API `fetchEvents` / Repo `fetchEvents` | `AdminPage`, `MyEvents` | `EventRepositoryContract.list` | `events` | aucun | non | `EventSummary[]` | limite API/repo aux événements récents selon implémentation |
| API `fetchLatestEventConfig` | pages de démarrage/configuration | `EventRepository` (opération à confirmer) | `events` | reconstruction depuis config JSON | non | `EventConfigRecord \| null` | charge la dernière configuration legacy |
| API/Repo `updateEventConfiguration` | `configStore`, workflow heat | `EventRepositoryContract.updateConfiguration` | `events` | aucun | non | `void` | conserve le JSON `categories`, `judges`, `config` |
| API/Repo `fetchDistinctDivisions` | Admin, génération, workflow | `EventRepositoryContract.listDivisions` | vue `v_event_divisions` | `participants.category` | non | `string[]` | la vue absente ne bloque pas si les participants existent |
| API/Repo `fetchEventConfigSnapshot` | `MyEvents`, realtime partagé, `configStore` | `EventRepositoryContract.getConfigurationSnapshot` | `event_last_config`, `heats`, `heat_entries`, `events` | reconstruction lineup/config legacy | non | `EventConfigSnapshot \| null` | restaure le heat actif et les noms affichés |
| API/Repo `saveEventConfigSnapshot` | `MyEvents`, workflow/config | `EventRepositoryContract.saveConfigurationSnapshot` | RPC `upsert_event_last_config` | aucun dans API ; logique proche du Repo | non | `void` | snapshot événement/heat pour reprise client |
| API `ensureEventExists` | `AdminInterface` | `EventRepositoryContract.ensureExists` | `events` | insert si recherche vide | non | `number` | création implicite contrôlée de l'événement |
| API/Repo `fetchEventIdByName` | Admin, génération, juges, workflow | `EventRepositoryContract.getIdByName` | `events` | normalisation du nom | non | `number \| null` | résolution legacy par nom |
| Repo `fetchEvent` | aucun consommateur direct identifié | `EventRepositoryContract.getById` | `events` | aucun | non | `EventSummary \| null` | **sans propriétaire d'usage clair** ; contrat néanmoins naturel |

## Participants

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| API/Repo `fetchParticipants` | Admin, génération, structure, PDF/ranking (type) | `ParticipantRepositoryContract.listByEvent` | `participants` | aucun | non | `ParticipantRecord[]` | ordre catégorie puis seed |
| API/Repo `upsertParticipants` | pages participants/génération | `ParticipantRepositoryContract.upsertMany` | `participants` upsert `event_id,category,seed` | aucun | non | `void` | conserve l'identité par seed dans une catégorie |
| API/Repo `updateParticipant` | pages participants | `ParticipantRepositoryContract.update` | `participants` | aucun | non | `void` | mutation opérateur directe |
| API/Repo `deleteParticipant` | pages participants | `ParticipantRepositoryContract.delete` | `participants` | aucun | non | `void` | suppression destructive existante, toujours explicite |

## Juges et panels

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| API `fetchActiveJudges` | Admin, selector | `JudgeRepositoryContract.listActive` | `judges` | aucun | non | `Judge[]` | masque les juges désactivés |
| API `fetchJudgeById` | `JudgeLogin` | `JudgeRepositoryContract.getById` | `judges` | aucun | non | `Judge \| null` | lookup identité juge |
| API `validateJudgeCode` | `JudgeLogin` | `JudgeRepositoryContract.validateCode` | `judges` | retourne `null` sur erreur | non | `Judge \| null` | erreur réseau et code invalide sont actuellement indistinguables |
| API `createJudge` | Admin | `JudgeRepositoryContract.create` | `judges` | fédération `FSS`, actif par défaut | non | `Judge` | création opérateur |
| API `updateJudge` | Admin | `JudgeRepositoryContract.update` | `judges` | aucun | non | `Judge` | mise à jour opérateur |
| API `deactivateJudge` | Admin | `JudgeRepositoryContract.deactivate` | `judges` | aucun | non | `void` | désactivation, pas suppression |
| API `updateJudgeName` | `JudgeInterface` | `JudgeRepositoryContract.updateEventDisplayName` | JSON `events.judges` | accepte ancien format string/objet | non | `void` | maintient la compatibilité du nom d'affichage legacy |
| API `fetchPanelContexts` | `panelContextCache` | `PanelRepositoryContract.resolveContexts` | `heat_configs`, `heat_judge_assignments` | snapshot runtime explicite | non | `Map<heatId, PanelContext>` | conflit de sources => état explicite inconnu |
| API `fetchPanelContext` | façade, tests/outils | `PanelRepositoryContract.resolveContext` | mêmes tables | snapshot runtime | non | `PanelContext` | ne déduit jamais le panel depuis les scores |
| API `fetchHeatJudgeAssignments` | Admin et panel | `PanelRepositoryContract.listHeatAssignments` | `heat_judge_assignments` | aucun | non | affectations[] | source canonique secondaire du panel |
| API `fetchEventJudgeAssignments` | Admin | `PanelRepositoryContract.listEventAssignments` | `heats` puis `heat_judge_assignments` | aucun | non | affectations[] | audit de couverture événement |
| API `fetchPodiumJudgePanel` | poller/configStore | `PanelRepositoryContract.getPodiumPanel` | `podium_judge_assignments` | aucun | non | affectations[] | panel affecté au podium |
| API `setPodiumJudgePanel` | Admin/config | `PanelRepositoryContract.setPodiumPanel` | RPC `set_podium_judge_panel` | aucun | non | `void` | mutation opérateur du panel |

## Heats, lineups et mappings

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| API/Repo `deletePlannedHeats` | génération, repository interne | `HeatPlanningRepository` ou méthode interne | `heats`, `heat_entries` | aucun | non | `void` | opération destructive de régénération ; propriétaire public à confirmer |
| API `createHeatsWithEntries` | `GenerateHeatsPage` | futur `HeatPlanningRepository` | `participants`, RPC `bulk_upsert_heats`, `heat_configs` | suppression/remplacement optionnel | non | `void` | construit bracket et entries ; hors résultat sportif |
| Repo `createHeat` | aucun consommateur direct clairement identifié | adaptateur interne heat planning | `heats` | file offline `saveOffline` | non-WAL score | `void` | **propriétaire d'usage à confirmer** |
| API/Repo `fetchOrderedHeatSequence` | Admin, JudgePage, hooks | `HeatRepositoryContract.listSequence` | `heats` | aucun | non | séquence[] | ordre round/heat |
| API `fetchHeatMetadata` | Admin, Judge, stores, repositories | `HeatRepositoryContract.getById` | `heats` | aucun | non | `HeatRow \| null` | source metadata heat |
| API/Repo `fetchHeatEntriesWithParticipants` | Admin, hooks, configStore | `HeatRepositoryContract.listEntries` | `heat_entries` joint `participants` | vue `v_heat_lineup` | non | entries[] | fusionne le nom fallback sans déplacer les scores du lycra |
| API `fetchHeatEntriesWithParticipantsBatch` | Display/overlays | `HeatRepositoryContract.listEntriesBatch` | mêmes sources, requête batch | vue `v_heat_lineup` batch | non | `Map` | évite N+1 |
| API `replaceHeatEntries` | Admin | `HeatRepositoryContract.replaceEntries` | delete/insert `heat_entries` | aucun | non | `void` | remplace lineup explicitement |
| API `adminOverrideHeatEntry` | Admin | `HeatRepositoryContract.overrideEntry` | RPC `admin_override_heat_entry` | aucun | non | override result | change participant/nom, pas l'identité score lycra |
| API `fetchHeatSlotMappings` | Admin/hooks/stores | `HeatRepositoryContract.listSlotMappings` | `heat_slot_mappings` | aucun | non | mappings[] | sources de qualification |
| API `fetchHeatSlotMappingsBatch` | Display/overlays | `HeatRepositoryContract.listSlotMappingsBatch` | `heat_slot_mappings` batch | aucun | non | `Map` | évite N+1 |
| API `fetchCategoryHeats` | pages structure/export | `HeatRepositoryContract.listCategoryRounds` | `heats` + entries + mappings | ordre couleur généré | non | `RoundSpec[]` | reconstruit le bracket d'affichage |
| API/Repo `fetchAllEventCategories` | Admin/export/config | `EventRepository.listDivisions` ou query heat interne | `heats.division` | aucun | non | `string[]` | doublon fonctionnel avec divisions événement |
| API `fetchAllEventHeats` | Admin/export | `HeatRepositoryContract.listAllEventRounds` | `heats` + entries + mappings | reconstruction par catégorie | non | record de rounds | export complet |
| Repo `saveHeatConfig` | `configStore`, `useSupabaseSync` | future mutation `HeatRepository` | `heat_configs`, `heat_judge_assignments`, `heat_entries`, RPC snapshot | files `saveOffline` par table | non-WAL score | `void` | conserve configuration/panel/snapshot |
| Repo `updateHeatStatus` | `useSupabaseSync` | future mutation `HeatRepository` | `heats` | `saveOffline` seulement si déjà hors ligne | non-WAL score | `void` | vérifie qu'une ligne a réellement été modifiée |
| API `subscribeToHeatUpdates` | aucun import direct actuel identifié | abonnement Realtime séparé | Realtime `heats`, entries/mappings | debounce/local callback | non | unsubscribe | **propriétaire futur : subscription gateway, pas repository CRUD** |

## Heat actif, podium et orchestration

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| API `upsertActiveHeatPointer` | configStore, ParticipantsStructure | orchestration heat, interface distincte | RPC `upsert_active_heat_pointer` | ancien RPC puis table `active_heat_pointer`, cache LS event id | non | `void` | compatibilité schéma podium ancien/nouveau |
| API `fetchActiveHeatPointer` | Display/configStore/realtime | orchestration heat read | `active_heat_pointer` | requête sans colonne podium si schéma legacy, hint LS | non | pointer/null | source de heat actif multi-podium |
| API `parseActiveHeatId` | Judge/Priority/realtime | utilitaire pur heat | aucun | aucun | non | identifiants/null | parse uniquement, pas accès données |
| API `activateHeatOnPodium` | Admin | orchestration heat | RPC `activate_heat_on_podium` | aucun | non | transition | activation reste hors repository résultat |
| API `closeHeatOnPodium` | chemins API/Admin | orchestration heat | RPC strict `close_heat_on_podium_strict` | RPC legacy `close_heat_on_podium` si indisponible | non | transition | fermeture et propagation atomiques selon RPC disponible |
| API `upsertHeatRealtimeConfig` | Judge/Priority/hooks | adaptateur Realtime config | RPC `upsert_heat_realtime_config` | table `heat_realtime_config`, variantes de colonnes | non | `void` | timer/config/priorité : hors migration P2.5 fonctionnelle |
| API `propagateQualifiersForSourceHeat` | workflow Admin | orchestration qualification | RPC `fn_propagate_qualifiers_for_source_heat` | aucun | non | nombre | ne doit pas entrer dans moteur heat |
| API `rebuildDivisionQualifiersFromScores` | Admin secours | orchestration secours | RPC `rebuild_division_qualifiers_from_scores` | aucun | non | nombre | réparation, pas chemin normal |
| API `validateHeatStartDependencies` | Admin | `HeatRepositoryContract.validateStartDependencies` ou orchestration | RPC `validate_heat_start_dependencies` | aucun | non | check structuré | bloque démarrage si sources non prêtes |

## Scores, corrections et interférences — API lecture/mutation

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| normaliseurs `normalizeScoreJudge*`, `normalizeScoreSurfer`, `scoreTimestampMs`, `canonicalizeScores`, `toParsedScore` | scoring legacy/P2, Judge, Display, repositories | adaptateur/mapper score pur | aucun | normalisation legacy | non | valeurs/`Score[]` | LWW actuel et alias lycra/station |
| API `fetchHeatScores` | Admin, Judge, hooks | `ScoringReadRepository.listByHeat` | `scores` | cache/normalisation interne | non | `Score[]` | retourne scores canoniques du heat |
| API `fetchScoresForHeats` | Display/overlays | `ScoringReadRepository.listForHeats` | `scores` batch | pagination | non | record scores | évite N+1 |
| API `fetchAllScoresForEvent` | exports/sync | lecture scoring interne | `heats`, `scores` | pagination | non | record scores | chemin brut événement |
| API `fetchCanonicalScoresForEvent` | export/audit | lecture scoring interne | `heats`, vue `v_scores_canonical_enriched` | aucun | non | record scores | enrichissement station/identité |
| API `fetchPreferredScoresForEvent` | Admin/export | `ScoringReadRepository.listPreferredForEvent` | vue canonique | `fetchAllScoresForEvent` si vue absente | non | record scores | préférence canonique, compatibilité ancien schéma |
| API `fetchEventJudgeAssignmentCoverage` | Admin diagnostics | diagnostics scoring | vue `v_event_judge_assignment_coverage` | tableau vide si vue absente | non | coverage[] | diagnostic non bloquant |
| API `fetchEventJudgeAccuracySummary` | Admin diagnostics | diagnostics scoring | vue `v_event_judge_accuracy_summary` | tableau vide si vue absente | non | accuracy[] | diagnostic non bloquant |
| API `fetchHeatMissingScoreSlots` | Admin diagnostics | diagnostics scoring | vue `v_heat_missing_score_slots` | tableau vide si vue absente | non | slots[] | close-readiness opérateur |
| API `fetchHeatCloseValidation` | Admin | diagnostics scoring | RPC `fn_get_heat_close_validation` | `null` si RPC absente | non | validation/null | compatibilité migrations incomplètes |
| API `fetchHeatCloseReadiness` | Admin | diagnostics scoring | RPC `fn_get_heat_close_readiness` | état explicite si RPC absente | non | readiness | message opérateur de fermeture |
| API `fetchInterferenceCalls` | écrans résultat/juges | `ScoringReadRepository.listInterferences` | `interference_calls` | cache court, tableau vide si table absente | non | calls[] | absence legacy non bloquante |
| API `fetchAllInterferenceCallsForEvent` | Admin/export | lecture scoring | `heats`, `interference_calls` | tableau vide si table absente | non | record calls | export événement |
| API `upsertInterferenceCall` | Admin/Judge | futur `InterferenceRepository` ou scoring mutation | `interference_calls` upsert | aucun | non | `void` | clé logique heat/juge/lycra/vague |
| API `deleteInterferenceCall` | Admin/Judge | même propriétaire | `interference_calls` delete | aucun | non | `void` | retrait explicite d'un vote |
| API `deleteScoreSecure` | Admin/FixScores | score mutation sécurisée | RPC `delete_score_secure` | aucun | non | nombre | demande session admin réelle |
| API `recordScoreOverrideSecure` | `useSupabaseSync`, ScoreRepository | score mutation interne | RPC `record_score_override_secure` | table `score_overrides` en local/RPC absente | indirect | `void` | fallback seulement compatibilité locale |
| API `applyScoreCorrectionSecure` | Admin/FixScores | score mutation sécurisée | RPC `apply_score_correction_secure` | update `scores` si local/RPC absente | non | `void` | conserve LWW et auth observable |

## ScoreRepository, IDB et WAL

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| Repo `saveScore` | `useScoreManager`, `scoreWalExecutor` | `ScoreRepositoryContract.save` | RPC `upsert_score_secure`, fallback table `scores`; garantit heat parent | IDB via `BaseRepository.execute` | **oui, appel/replay** | `Score` | écrit local puis synchronise ; idempotence par ID |
| Repo `fetchScores` | `useScoreManager` | `ScoreRepositoryContract.listByHeat` | `scores` | IDB | non | `Score[]` | canonicalisation et cache IDB |
| Repo `overrideScore` | hooks/admin legacy | `ScoreRepositoryContract.override` | score secure + override log | IDB + LS logs | indirect | résultat override | correction attachée au lycra et journalisée |
| Repo `fetchOverrideLogs` | Admin/hooks | `ScoreRepositoryContract.listOverrideLogs` | `score_overrides` | LS | non | logs[] | historique opérateur disponible offline |
| Repo `syncScores` | sync hooks | `ScoreRepositoryContract.syncHeat` | RPC/table score | IDB unsynced | **rejoue données locales, distinct de la WAL coordinateur** | compteurs | déduplique et marque synced |
| Repo `syncPendingScores` | hooks sync | `ScoreRepositoryContract.syncPending` | mêmes sources | IDB | indirect | compteurs/heats | batch par heat |

La WAL proprement dite reste dans `stores/scoreWalExecutor.ts` et `lib/offlineSyncCoordinator.ts`. Aucune structure, clé, priorité ou stratégie de replay n'est modifiée en P2.5.0/P2.5.1.

## TimerRepository

| Opération actuelle | Consommateurs principaux | Propriétaire futur | Table/RPC | Fallback | WAL | Retour | Comportement opérateur notable |
|---|---|---|---|---|---|---|---|
| Repo `saveTimerState` | `useSupabaseSync` | inchangé, hors contrats P2.5.1 | RPC `upsert_heat_realtime_config` | table `heat_realtime_config`, puis `saveOffline` hors ligne | non-WAL score | `void` | timer explicitement hors périmètre ; aucune modification |

## Opérations sans propriétaire public définitivement tranché

- création/suppression de heats planifiés : probablement `HeatPlanningRepository`, afin de ne pas surcharger le repository runtime ;
- abonnements Realtime : une `SubscriptionGateway` est plus adaptée qu'un repository CRUD ;
- diagnostics juge/close-readiness : soit `ScoringDiagnosticsRepository`, soit sous-interface en lecture ;
- mutations d'interférence : repository dédié ou sous-interface scoring ;
- active heat pointer, activation/fermeture podium et propagation : couche d'orchestration, pas moteur de résultat ;
- `fetchLatestEventConfig` : snapshot événement ou compatibilité de démarrage à isoler ;
- méthodes repository sans consommateur clair (`fetchEvent`, `createHeat`) : à conserver jusqu'à preuve d'inutilisation.

Ces décisions sont volontairement différées : P2.5.1 définit seulement les contrats non ambigus et ne branche aucun consommateur.
