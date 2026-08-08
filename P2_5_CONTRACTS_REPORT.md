# Rapport P2.5.0 / P2.5.1 — inventaire et contrats repository

## Statut

P2.5.0 et P2.5.1 sont terminés. Aucun consommateur n'a été migré et aucune implémentation active n'a été remplacée. Supabase demeure l'unique implémentation et la source de vérité.

P2.5.2 n'est pas commencé.

## P2.5.0 — inventaire

La matrice complète est disponible dans `P2_5_OPERATION_MATRIX.md`. Elle couvre :

- la façade `api/supabaseClient.ts` ;
- les six modules `api/modules` métier et `core.api` ;
- les repositories Event, Heat, Participant, Score et Timer ;
- chaque opération publique, ses consommateurs, son propriétaire futur proposé, ses tables/RPC, fallbacks, implication WAL, retour et comportement opérateur notable.

Constat principal : `api/supabaseClient.ts` est déjà une façade de réexport sans logique propre, mais reste importée directement par 31 fichiers applicatifs. Les repositories sont utilisés dans 7 zones et dupliquent encore certaines opérations des modules API.

## P2.5.1 — contrats créés

### Contrats communs

- `repositories/contracts/common.ts`
  - identifiants et timestamps neutres ;
  - `SyncSummary` ;
  - `HeatSyncSummary`.

### Événements

- `EventSummary` ;
- `EventJudgeSnapshot` ;
- `EventConfigSnapshot` ;
- `SaveEventSnapshotRequest` ;
- `EventConfigurationUpdate` ;
- `EventRepositoryContract`.

Les objets JSON PostgreSQL bruts ne sont pas exposés. Les DTO canoniques utilisent des noms applicatifs en camelCase.

### Heats

- `HeatRecord` ;
- `HeatSlotRecord` et `HeatSlotParticipant` ;
- `HeatRoundRecord` ;
- `HeatSequenceEntry` ;
- `HeatSlotMapping` ;
- DTO de remplacement et d'override lineup ;
- DTO de validation des dépendances ;
- `HeatRepositoryContract`.

Le lycra et le participant sont des champs distincts. Le contrat ne permet pas de rattacher un score à un participant.

### Scores

- `ScoreRecord` ;
- `ScoreOverrideLogRecord` ;
- `InterferenceCallRecord` ;
- `EffectiveInterferenceRecord` ;
- DTO save/override/correction ;
- `ScoreRepositoryContract` ;
- `ScoringReadRepositoryContract`.

Les DTO sont transport-neutral et ne modifient pas la WAL actuelle. La différence de nom `lycraColor`/`surfer` rend explicite qu'un mapping sera nécessaire dans l'adaptateur Supabase de P2.5.2 ; aucun mapping n'est encore branché.

### Participants

- `ParticipantRecord` ;
- `ParticipantInput` ;
- `ParticipantPatch` ;
- `ParticipantRepositoryContract`.

Cette définition prépare la suppression future de la duplication entre `api/modules/participants.api.ts` et `repositories/ParticipantRepository.ts`.

### Juges et panels

- `JudgeRecord`, inputs et `JudgeRepositoryContract` ;
- `JudgeAssignment` ;
- `PodiumJudgePanel` ;
- `SetPodiumPanelRequest` ;
- `PanelRepositoryContract`.

`PanelRepositoryContract` réutilise le `PanelContext` métier P2.4a. La résolution 3/5, les conflits et l'état inconnu ne sont ni copiés ni modifiés.

### Registre

`repositories/RepositoryRegistry.ts` déclare :

- `events` ;
- `heats` ;
- `judges` ;
- `panels` ;
- `participants` ;
- `scores` ;
- `scoringReads`.

Le registre est une interface uniquement. Il n'existe ni instance, ni factory, ni sélection locale, ni nouveau singleton. Les repositories Supabase actuels restent les seuls objets actifs.

## Dépendances détectées

### Dépendances souhaitées

- `api/modules/* -> lib/supabase` ;
- `api/modules/panelContext.api -> domain/scoring/panelContext` ;
- `repositories/contracts/panels -> domain/scoring/panelContext` ;
- implémentations repositories actuelles -> `BaseRepository` et infrastructure Supabase.

### Dépendances de transition à corriger ultérieurement

- `ScoreRepository -> api/modules/scoring.api` ;
- `ScoreRepository -> api/supabaseClient -> tous les api/modules` pour `fetchHeatMetadata` ;
- `ScoreRepository -> stores/offlineStore` ;
- `EventRepository -> singleton HeatRepository` ;
- `events.api -> heats.api` ;
- hooks/stores -> mélange de repositories et `api/supabaseClient`.

Les contrats ajoutés n'introduisent aucune de ces dépendances.

## Cycles potentiels

### Façade Supabase vers repositories

Le risque principal apparaît si `api/supabaseClient.ts` est transformé trop tôt pour déléguer aux repositories : `ScoreRepository` importe actuellement cette façade pour `fetchHeatMetadata`. Cela formerait :

```text
supabaseClient -> ScoreRepository -> supabaseClient
```

P2.5.2 devra d'abord remplacer cette dépendance par un adaptateur interne précis ou une dépendance injectée en lecture.

### Repository vers store

`ScoreRepository` importe `useOfflineStore`. Si les stores consomment demain `RepositoryRegistry`, un cycle logique store/repository devient possible. La WAL et son store ne doivent pas être déplacés ; une petite interface technique interne sera nécessaire pour éviter que le contrat public dépende de Zustand.

### EventRepository vers HeatRepository

`EventRepository` dépend du singleton `heatRepository` pour reconstruire un snapshot. Ce couplage concret empêchera une factory propre tant qu'il ne sera pas remplacé par une dépendance explicite ou un adaptateur de composition.

### API events vers API heats

`events.api` appelle `fetchHeatEntriesWithParticipants` depuis `heats.api`. Ce n'est pas encore un cycle, mais cela croise les responsabilités et doit être pris en compte lors de l'adaptation Supabase.

## Opérations sans propriétaire clair

Les opérations suivantes ne sont volontairement pas entrées dans `RepositoryRegistry` avant décision :

- planification/création et suppression de heats : candidat `HeatPlanningRepository` ;
- abonnements Realtime : candidat `SubscriptionGateway` ;
- active heat pointer, activation/fermeture podium et propagation : couche d'orchestration ;
- diagnostics d'affectation, précision des juges et close-readiness : repository diagnostics ou sous-interface lecture ;
- mutations d'interférence : repository dédié ou extension scoring ;
- timer : hors périmètre P2.5 fonctionnel ;
- `fetchLatestEventConfig`, `fetchEvent` et `createHeat` : usages ou propriété finale à confirmer.

Ne pas les forcer dans les contrats évite de mélanger CRUD, Realtime, orchestration et logique de secours.

## Casts critiques encore bloquants

Aucun cast existant n'a été modifié pendant P2.5.1.

Priorités observées par inventaire statique simple :

- `lib/supabase.ts` : 22 occurrences structurelles `any`/double cast, dont `as unknown as SurfSupabaseClient` ;
- `api/modules/heats.api.ts` : 21 occurrences, principalement jointures entries/participants, vues lineup et retours RPC ;
- `repositories/HeatRepository.ts` : 11 occurrences sur config, heat data et lignes jointes ;
- `hooks/useHeatManager.ts` : 14 occurrences sur séquence, mappings, updates et caches ;
- `api/modules/judges.api.ts` : 2 occurrences sur le JSON legacy `events.judges`.

Les chemins `scoring.api.ts`, `ScoreRepository.ts` et `participants.api.ts` n'ont pas de cast `any` détecté par ce filtre, mais utilisent encore des DTO legacy snake_case et des gardes `unknown` légitimes.

Blocages :

1. le client Supabase double-cast masque les divergences du schéma généré ;
2. les jointures PostgREST heat/participant n'ont pas de DTO de persistance explicite ;
3. plusieurs formes legacy de lineup et `events.judges` doivent être parsées sans changer leur sérialisation ;
4. typer le replay score ne doit modifier ni payload, ni clé d'idempotence, ni ordre de file.

Les `unknown` d'erreurs réseau/RPC sont conservés : ils sont préférables à `any` lorsqu'ils sont affinés par un guard.

## Tests architecturaux

Nouveau fichier : `frontend/src/repositories/__tests__/architecture.test.ts`.

Quatre invariants sont vérifiés :

1. aucun import Supabase/PostgREST dans `repositories/contracts` ;
2. aucune dépendance React, hooks ou stores dans `api/modules` ;
3. aucun import repository depuis `domain` ;
4. aucun alias brut généré `Database`, `Tables`, `TablesInsert`, `TablesUpdate` ou PostgREST dans les contrats publics.

Résultat ciblé : **4/4 tests réussis**.

## Validation complète

- `npx tsc --noEmit --pretty false` : réussi ;
- Vitest : **31 fichiers, 179 tests réussis** ;
- build Vite/PWA : réussi, **2 365 modules** et **48 entrées précachées** ;
- benchmark scoring : 250 calculs/360 faits en 160,12 ms lors de la validation finale ;
- audit réseau P1 : réussi, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` vers `/admin`, `/judge`, `/priority`, `/display` ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

L'avertissement Vitest `listen EPERM` concerne uniquement le port WebSocket HMR dans le sandbox. Les 179 tests sont exécutés et réussissent. L'audit P1 a été relancé avec accès au port local et est vert.

## Fichiers créés

- `P2_5_OPERATION_MATRIX.md` ;
- `P2_5_CONTRACTS_REPORT.md` ;
- `frontend/src/repositories/RepositoryRegistry.ts` ;
- `frontend/src/repositories/contracts/common.ts` ;
- `frontend/src/repositories/contracts/events.ts` ;
- `frontend/src/repositories/contracts/heats.ts` ;
- `frontend/src/repositories/contracts/judges.ts` ;
- `frontend/src/repositories/contracts/panels.ts` ;
- `frontend/src/repositories/contracts/participants.ts` ;
- `frontend/src/repositories/contracts/scores.ts` ;
- `frontend/src/repositories/contracts/index.ts` ;
- `frontend/src/repositories/__tests__/architecture.test.ts`.

Aucun fichier existant d'implémentation, consommateur, WAL, timer, SQL, Cloud ↔ HP, ESP32, route P1, `event-box` ou `beach` n'a été modifié pour P2.5.0/P2.5.1.

## Réversibilité

Les nouveaux fichiers ne sont importés par aucun consommateur et le registre n'est pas instancié. Le rollback de P2.5.0/P2.5.1 consiste donc simplement à retirer ces contrats, leur test et les deux documents ; aucune donnée ou configuration runtime ne serait affectée.

## Critères de sortie P2.5.0/P2.5.1

- [x] opérations API/modules/repositories inventoriées ;
- [x] consommateurs, propriétaire futur, table/RPC, fallback, WAL, retour et comportement notable documentés ;
- [x] contrats purs et DTO canoniques créés ;
- [x] `RepositoryRegistry` déclaré sans implémentation active ;
- [x] aucun import consommateur modifié ;
- [x] invariants architecturaux testés ;
- [x] Supabase demeure l'unique implémentation active ;
- [x] validations complètes vertes ;
- [x] aucun changement fonctionnel ou infrastructurel interdit ;
- [ ] approbation explicite avant P2.5.2.

P2.5.2 n'est pas commencé.
