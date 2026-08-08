# P2.5.5 — PanelRepository

## Statut

P2.5.5 est terminé sur le seul périmètre PanelRepository. La résolution P2.4a, les messages opérateur et le cache ont conservé leur comportement. P2.5.6 n'a pas été commencé.

Aucun changement SQL, WAL, scoring, timer, priorité, Realtime, Cloud↔HP, ESP32, route P1, `event-box` ou `beach` n'a été effectué.

## Repository créé

`frontend/src/repositories/PanelRepository.ts` implémente explicitement `PanelRepositoryContract` et délègue aux adaptateurs Supabase existants :

- `fetchPanelContext` ;
- `fetchPanelContexts` ;
- `fetchHeatJudgeAssignments` ;
- `fetchEventJudgeAssignments` ;
- `fetchPodiumJudgePanel` ;
- `setPodiumJudgePanel`.

La façade `api/supabaseClient` conserve ses exports historiques pour rollback. Elle n'est plus utilisée directement par les consommateurs migrés pour ces opérations.

## Contrats et mappings

Les lignes snake_case Supabase d'affectation sont converties vers `JudgeAssignment` :

- `heat_id` → `heatId` ;
- `event_id` → `eventId` ;
- `judge_id` → `judgeId` ;
- `judge_name` → `judgeName` ;
- `assigned_at` → `assignedAt` ;
- `updated_at` → `updatedAt`.

Pour une affectation permanente de podium, `heatId` vaut explicitement `null`, car cette table est liée au podium et non à un heat. `assignedBy` a été ajouté au DTO de mutation afin de préserver les valeurs existantes comme `admin-auto-podium-panel` au lieu de les remplacer par le fallback `admin`.

## Résolution P2.4a inchangée

Le repository ne réimplémente pas la résolution. Il retourne directement le résultat de `panelContext.api`, qui continue d'appeler le résolveur caractérisé P2.4a avec la même priorité :

1. `heat_configs` ;
2. `heat_judge_assignments` ;
3. runtime snapshot ;
4. `unknown`.

Sont conservés strictement :

- panels supportés : 3 et 5 uniquement ;
- conflit entre sources : `source: unknown`, `issue: panel_conflict` ;
- taille explicite non supportée : `source: unknown`, `issue: panel_invalid` ;
- absence de source : `panel_unknown` ;
- erreur de lecture : `network_error` avec le message opérateur existant ;
- aucune déduction depuis les scores ;
- `observedScoreCount` reste exclusivement diagnostic et n'influence jamais `judgeCount`.

## Cache avant/après

Avant P2.5.5, `domain/scoring/panelContextCache.ts` importait directement `fetchPanelContexts` depuis `panelContext.api`.

Après P2.5.5 :

- le cache reste un mécanisme neutre du domaine ;
- `repositories/panelContextCache.ts` injecte `panelRepository.resolveContexts` comme loader ;
- la règle architecturale « domain ne dépend jamais des repositories » reste donc respectée ;
- les consommateurs utilisent tous la même instance de cache.

Invariants conservés :

- clé exacte `${heatId}::${stations normalisées}` ;
- même cache résolu ;
- même cache des promesses en cours ;
- même déduplication concurrente ;
- même requête batch pour plusieurs heats ;
- aucune requête unitaire de secours ;
- les `network_error` ne sont pas conservées et restent retryables ;
- aucun TTL ajouté.

## Imports migrés

Résolution/cache P2 :

- `DisplayPage` ;
- `OverlayPage` — couvre également le chemin overlay/OBS partagé ;
- `AdminInterface` ;
- `canonicalHeatSnapshots` via loader injecté ;
- `pdfExport`, qui fournit `PanelRepository.resolveContexts` au constructeur de snapshots.

Affectations/podium :

- `AdminInterface` : lectures événement et écriture du panel podium ;
- `configStore` : affectations heat et panel podium ;
- `PendingJudgeAssignmentPoller` : lecture du panel podium ;
- `useSupabaseSync` : lecture des affectations heat.

Mesure des imports directs de `panelContext.api` :

- avant : 1 consommateur de production direct, `panelContextCache`, puis tous les écrans indirectement ;
- après : 0 consommateur de production direct hors `PanelRepository` ;
- les exports de compatibilité de `api/supabaseClient` restent présents mais sans nouvel appel.

## Batch et N+1

Le test repository/cache charge deux heats en une seule invocation `resolveContexts`. Deux appels concurrents puis un appel répété utilisent toujours une seule requête batch. Le repository ne boucle jamais sur `resolveContext` pour réaliser un batch.

Nombre observé dans le test multi-heats :

- heats demandés : 2 ;
- appels batch repository : 1 ;
- appels unitaires : 0 ;
- appels supplémentaires après lecture répétée : 0.

## Casts

Les nouveaux fichiers `PanelRepository.ts`, `repositories/panelContextCache.ts` et le cache domaine ne contiennent aucun `any` ni `as unknown`.

Les mappings Admin temporaires vers `HeatJudgeAssignmentRow` sont explicites et sans cast, afin de ne pas réécrire dans ce lot les structures internes d'affichage et d'analytics déjà caractérisées.

## Tests

Tests nouveaux :

- délégation single/batch sans donnée score ;
- conservation exacte des issues/messages ;
- mapping affectations heat et événement ;
- lecture podium et panel vide ;
- écriture podium avec métadonnées inchangées ;
- cache repository partagé ;
- batch multi-heats sans N+1 ;
- erreur réseau retryable.

Tests P2.4a/P2.4 réexécutés :

- panel 3 depuis `heat_configs` ;
- panel 5 depuis assignments ;
- runtime snapshot ;
- conflit ;
- source invalide ;
- panel inconnu ;
- historiques à 2/4 scores sans déduction ;
- DisplayPage ;
- overlays ;
- AdminInterface ;
- export canonique.

Résultats :

- suite ciblée : **60/60 réussis** ;
- typecheck : **succès** ;
- suite complète : **225 réussis, 2 intégrations Supabase conditionnelles ignorées, 0 échec** ;
- build Vite : **succès**, 2 374 modules transformés ;
- audit réseau P1 : **succès**, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` → `/admin`, `/judge`, `/priority`, `/display`.

L'avertissement Vitest `listen EPERM` du WebSocket HMR reste propre au sandbox et non bloquant ; tous les processus de test terminent avec le code 0.

## Rollback

Le rollback ne nécessite aucune opération de données :

1. rétablir l'import du cache domaine dans Display/Overlay/Admin ;
2. rétablir le loader API par défaut dans le cache ;
3. rétablir les imports `api/supabaseClient` pour affectations/podium ;
4. conserver ou retirer `PanelRepository` sans impact sur Supabase.

Les adaptateurs existants et leurs signatures de compatibilité n'ont pas été supprimés.

## Cycles

Aucun cycle runtime n'a été introduit :

- `PanelRepository` dépend de `api/modules` et des contrats ;
- `api/modules` ne dépend pas du repository ;
- le domaine expose un cache avec loader injecté et ne dépend pas des repositories ;
- la façade repository dépend du cache domaine et du repository concret.

Les tests architecturaux P2.5 restent verts.

## Risques ouverts

- Les exports panel directs de `api/supabaseClient` restent disponibles pour compatibilité ; une suppression éventuelle devra attendre la clôture de la stratégie de rollback.
- `AdminInterface` conserve en interne sa forme historique snake_case pour ses tableaux d'analytics. La frontière repository est canonique, mais supprimer cette représentation interne relève d'un lot UI/analytics distinct.
- Une absence de lignes podium est représentée par `null` dans le contrat repository, tout en conservant le comportement consommateur « garder la configuration courante ».
- Les validations terrain HP réel et Realtime plage restent ouvertes comme précédemment.
- Les deux tests d'intégration Supabase réels sont conditionnels à leur environnement et ont été ignorés par la suite standard.

P2.5.6 n'a pas été commencé.
