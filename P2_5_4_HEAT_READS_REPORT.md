# P2.5.4 — HeatRepository : lectures et typage heat/lineup/mappings

## Statut

P2.5.4 est implémenté sur le périmètre **lecture uniquement**. Aucune mutation heat, migration SQL, logique WAL, scoring, timer, priorité, Realtime, Cloud↔HP, ESP32, route P1, `event-box` ou `beach` n'a été modifiée.

`HeatRepository` implémente un sous-contrat explicite `Pick<HeatRepositoryContract, ...>` limité aux huit lectures prévues. Il n'annonce volontairement pas l'implémentation du contrat de mutation complet avant la phase correspondante.

## Fichiers créés

- `frontend/src/api/modules/heatReadParsers.ts`
- `frontend/src/api/modules/__tests__/heatReadParsers.test.ts`
- `frontend/src/repositories/__tests__/HeatRepository.reads.test.ts`
- `P2_5_4_HEAT_READS_REPORT.md`

## Fichiers modifiés

- `frontend/src/api/modules/heats.api.ts`
- `frontend/src/repositories/HeatRepository.ts`
- `frontend/src/hooks/useHeatParticipantDetails.ts`

## Types créés et frontières

Les formes PostgREST restent internes à `api/modules` :

- `HeatRow`
- `HeatSequenceRow`
- `HeatEntryJoinedRow`
- `LegacyLineupRow`
- `HeatSlotMapping`
- `HeatWithEntriesRow`
- forme jointe interne `HeatSlotParticipant`

Les consommateurs repository reçoivent exclusivement les contrats canoniques existants :

- `HeatRecord`
- `HeatSequenceEntry`
- `HeatRoundRecord`
- `HeatSlotRecord`
- `HeatSlotParticipant`
- `HeatSlotMapping`

Les noms snake_case et les particularités des joins Supabase ne franchissent pas la frontière publique du repository.

## Parsers et guards

Les réponses `unknown` sont traitées par des parsers internes dédiés :

- `parseHeatRow`
- `parseHeatSequenceRow`
- `parseHeatEntryJoinedRow`
- `parseLegacyLineupRow`
- `parseHeatSlotMapping`
- `parseHeatWithEntriesRow`
- `parseHeatSlotParticipant`
- `parseRows`

Ils couvrent les joins participant retournés sous forme d'objet ou de tableau, les champs legacy nullables, les tableaux joints absents et les propriétés PostgREST supplémentaires. Une ligne structurellement inexploitable produit désormais une erreur explicite au lieu de circuler sous forme `any`.

## Lectures implémentées

- `getById`
- `listSequence`
- `listEntries`
- `listEntriesBatch`
- `listSlotMappings`
- `listSlotMappingsBatch`
- `listCategoryRounds`
- `listAllEventRounds`

Les méthodes historiques `fetchHeatEntriesWithParticipants` et `fetchOrderedHeatSequence` restent disponibles comme façade de compatibilité et délèguent aux lectures typées. Le rollback d'un consommateur consiste donc uniquement à rétablir son ancien import.

## Consommateurs migrés

`useHeatParticipantDetails` utilise désormais `heatRepository.listEntries` et `heatRepository.listSlotMappings`. Son abonnement Realtime, son fallback d'affichage et son comportement d'erreur sont inchangés.

Les consommateurs qui mêlent lectures et orchestration (`useHeatManager`, `useHeatParticipants`, `configStore`, `AdminInterface`, pages display/overlay) restent derrière `api/supabaseClient` dans ce lot. Les migrer ici aurait mélangé la frontière read-only avec progression, scoring, activation ou gestion de configuration. La façade de compatibilité conserve leur comportement actuel.

## Invariant lycra et fallback historique

- La couleur reste copiée depuis `heat_entries.color` ou `v_heat_lineup.jersey_color` sans être dérivée du participant.
- Le participant est mappé dans un objet séparé.
- Un changement de participant conserve donc la même identité sportive de lycra.
- Le fallback `v_heat_lineup`, son enrichissement par position et la reconstruction historique du round 1 restent dans `heats.api.ts` dans le même ordre.
- L'ordre de la séquence reste celui de la requête `round ASC, heat_number ASC`.
- L'ordre couleur existant reste celui de `color_order` puis des mécanismes legacy déjà présents.

## Batch et N+1

`listEntriesBatch` et `listSlotMappingsBatch` appellent chacun exactement une fonction batch et n'effectuent aucun fallback unitaire par heat. Le test vérifie qu'aucune lecture simple n'est appelée.

`listAllEventRounds` transforme directement le résultat de `fetchAllEventHeats`. Une relecture par catégorie initialement repérée pendant l'implémentation a été supprimée avant validation ; elle n'est pas présente dans le résultat final.

## Casts avant/après

### `api/modules/heats.api.ts`

Les casts structurels de lecture (`slots?: any[]`, participant `any`, lignes entries/lineup/batch/category/mappings en `any`) ont été supprimés. Il reste un seul `as any`, limité au payload du RPC de **mutation** `bulk_upsert_heats`, hors périmètre P2.5.4.

### `repositories/HeatRepository.ts`

Les casts `unknown` et callbacks `row: any` des lectures entries/lineup/catégories ont été supprimés. Les occurrences `any` restantes concernent exclusivement les mutations et l'orchestration legacy (`saveHeatConfig`, `createHeat`, status payload, construction/garantie des entries, snapshot de config), explicitement hors périmètre.

### Hook migré

Aucun type PostgREST ne subsiste dans `useHeatParticipantDetails`. Son unique `as unknown` préexistant concerne l'indexation du dictionnaire de traduction des couleurs, pas une donnée heat/Supabase.

## Tests

Couverture ajoutée :

- metadata heat et suppression des propriétés PostgREST supplémentaires ;
- séquence ordonnée ;
- lineup joint avec participant objet ou tableau ;
- fallback lineup historique ;
- invariant lycra après changement de participant ;
- entries batch sans N+1 ;
- mappings simples et batch ;
- données legacy partielles/nullables ;
- transformation rounds/event sans relecture par catégorie ;
- absence de fuite PostgREST via les contrats architecturaux existants.

Résultats :

- typecheck `npx tsc --noEmit --pretty false` : **succès** ;
- suite ciblée : **11 tests réussis** ;
- suite complète : **218 tests réussis, 2 tests d'intégration Supabase conditionnels ignorés, 0 échec** ;
- build Vite : **succès**, 2 372 modules transformés ;
- audit réseau P1 : **succès**, 0 violation statique, 0 violation runtime ;
- routes contrôlées : `/admin`, alias `/chief-judge` vers `/admin`, `/judge`, `/priority`, `/display` ;
- aucun domaine public contacté par l'audit terrain.

Vitest affiche dans ce sandbox un avertissement non bloquant `listen EPERM` pour son WebSocket HMR sur le port 24678 ; l'exécution des tests se termine néanmoins avec le code 0. L'audit P1 a été relancé avec l'autorisation locale nécessaire et est entièrement vert.

## Rollback

Le rollback est local et réversible :

1. rétablir dans `useHeatParticipantDetails` les imports de la façade `api/supabaseClient` ;
2. conserver les méthodes historiques de `HeatRepository`, qui restent disponibles ;
3. retirer le sous-contrat de lecture et les parsers sans changement de données ni de schéma.

Aucune donnée persistée n'a été transformée.

## Cycles restants

Aucun nouveau cycle runtime n'a été introduit : les imports des contrats sont de type uniquement. `HeatRepository` dépend des adaptateurs internes `api/modules/heats.api`, et ceux-ci ne délèguent pas au repository.

`heats.api.ts` utilise encore le type canonique `ParticipantRecord` par import de type pour les opérations historiques de génération. Cette dépendance n'existe pas au runtime mais pourra être déplacée vers un DTO partagé lors d'un lot ultérieur si l'on veut rendre la direction de dépendance pure jusque dans le graphe de types.

## Risques ouverts

- Les mutations heat conservent leurs `any` legacy et ne sont pas couvertes par ce lot.
- Plusieurs consommateurs complexes restent sur la façade de compatibilité afin de ne pas toucher à l'orchestration ; leur migration devra être découpée par responsabilité.
- Les parsers rejettent explicitement les lignes privées de leurs identifiants/nombres indispensables. C'est souhaité pour éviter un calcul silencieux, mais un dump legacy fortement corrompu pourrait désormais produire une erreur opérateur au lieu d'une valeur `NaN`.
- Les deux tests d'intégration Supabase réels restent conditionnels à leur variable d'environnement et n'ont pas été requis pour ce changement de typage sans persistance.
- Les validations terrain déjà ouvertes (HP réel et Realtime plage) restent inchangées.

P2.5.5 PanelRepository n'a pas été commencé.
