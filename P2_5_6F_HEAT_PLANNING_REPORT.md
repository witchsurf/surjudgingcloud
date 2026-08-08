# P2.5.6f — Heat Planning

## Conclusion

Le planning initial des heats passe désormais par `HeatPlanningRepositoryContract` et `HeatPlanningRepository`, une frontière dédiée distincte du repository heat runtime, du lifecycle, de la qualification et du scoring.

Les deux consommateurs du planning initial ont été migrés. La façade historique `api/supabaseClient` reste disponible pour rollback. Aucune migration SQL, règle de bracket, règle de scoring, WAL, timer, priorité, Realtime, synchronisation Cloud ↔ HP, ESP32, route P1, `event-box` ou `beach` n'a été modifié.

`createHeat` n'a pas été déplacé : l'inventaire montre qu'il est utilisé par le workflow runtime dans `useSupabaseSync`, `useHeatManager` et `AdminPage`, notamment pour préparer un heat suivant. Il ne fait donc pas partie du planning initial de ce lot.

## Responsabilité architecturale

La nouvelle façade expose seulement :

- `createWithEntries(request)` : génération initiale d'un bracket et persistance associée ;
- `deletePlanned(request)` : suppression explicite selon le périmètre historique.

Elle délègue strictement aux adaptateurs existants :

- `createHeatsWithEntries` ;
- `deletePlannedHeats`.

Les DTO publics décrivent la requête de planning et remappent le résultat snake_case en `PlannedHeatRecord` et `PlannedHeatEntryRecord`. Aucun type PostgREST brut n'est exposé par le contrat.

## Chemin avant / après

Avant :

```text
GenerateHeatsPage / ParticipantsStructure
  -> api/supabaseClient.createHeatsWithEntries
  -> participants
  -> RPC bulk_upsert_heats
  -> heat_configs
```

Après :

```text
GenerateHeatsPage / ParticipantsStructure
  -> HeatPlanningRepositoryContract
  -> HeatPlanningRepository
  -> api/modules/heats.api (adaptateur inchangé)
  -> participants
  -> RPC bulk_upsert_heats
  -> heat_configs
```

L'ordre d'exécution, les payloads, les erreurs et les messages de l'adaptateur n'ont pas été modifiés.

## Ordre de génération conservé

`createHeatsWithEntries` continue d'exécuter exactement :

1. construction en mémoire des participants, heats, entries, mappings et configurations ;
2. upsert des participants sur `(event_id, category, seed)` ;
3. relecture de leurs IDs par événement et catégorie ;
4. construction des entries par seed, puis par nom comme fallback historique ;
5. si `overwrite=true`, lecture de tous les IDs de heats de l'événement/catégorie ;
6. RPC `bulk_upsert_heats` ;
7. upsert de `heat_configs` sur `heat_id` ;
8. retour des heats et entries construits.

La génération conserve :

- `event_id`, catégorie et seed des participants ;
- l'ordre fourni par les rounds/heats/slots ;
- les IDs normalisés existants ;
- `color_order` fourni par `getColorSet` (`RED`, `WHITE`, `YELLOW`, etc.) ;
- la couleur de chaque entry à la même position ;
- les placeholders et mappings de qualification ;
- les juges par défaut ;
- `waves: 15` et le type de tournoi ;
- les libellés de lycra dans `heat_configs.surfers` (`ROUGE`, `BLANC`, `JAUNE`, etc.).

Il n'existe pas de fallback offline propre à `createHeatsWithEntries` ou `deletePlannedHeats` sur le chemin historique utilisé par ces deux écrans. Aucun fallback n'a été ajouté.

## Opérations destructives existantes

### `createHeatsWithEntries`

La RPC reçoit toujours `p_delete_ids` avant de recréer les lignes :

- avec `overwrite=true`, la liste contient **tous les heats existants** de l'événement et de la catégorie, sans filtre de statut ;
- avec `overwrite=false`, la liste contient les IDs des nouveaux heats générés. Un heat déjà présent sous le même ID est donc supprimé avant recréation.

La RPC versionnée supprime, dans cet ordre :

1. `heat_slot_mappings` ;
2. `heat_entries` ;
3. `heat_realtime_config` ;
4. `heats` ;
5. puis réinsère/upsert participants, heats, mappings, entries et configurations Realtime.

La base locale montre en outre des clés étrangères `ON DELETE CASCADE` de `heats` vers `heat_configs`, `heat_entries`, `heat_history`, `heat_judge_assignments`, `heat_slot_mappings`, `heat_timers`, `interference_calls` et `scores`. Ainsi, bien que le client et le repository n'écrivent jamais directement dans `scores`, la stratégie de remplacement historique peut supprimer des scores par cascade lorsqu'elle supprime un heat existant. Ce comportement critique est préexistant et n'a volontairement pas été changé.

### `deletePlannedHeats`

Cette opération :

1. sélectionne uniquement les heats du couple événement/catégorie dont le statut est `planned` ou `open` ;
2. supprime explicitement leurs `heat_entries` ;
3. supprime ces heats ;
4. laisse les cascades existantes traiter les tables liées.

Elle ne sélectionne pas les autres statuts. Aucun filtre, ID ou appel de suppression supplémentaire n'a été ajouté.

Comportement d'erreur historique conservé : l'erreur du `select` et celle du `delete heats` sont propagées ; le résultat du `delete heat_entries` n'est actuellement pas vérifié avant la suppression des heats.

## Fichiers créés

- `frontend/src/repositories/contracts/heatPlanning.ts`
- `frontend/src/repositories/HeatPlanningRepository.ts`
- `frontend/src/repositories/__tests__/HeatPlanningRepository.test.ts`
- `frontend/src/api/modules/__tests__/heatPlanning.api.test.ts`
- `frontend/src/repositories/__tests__/realHeatPlanning.integration.test.ts`

## Fichiers modifiés

- `frontend/src/repositories/contracts/index.ts`
- `frontend/src/repositories/index.ts`
- `frontend/src/repositories/RepositoryRegistry.ts`
- `frontend/src/repositories/HeatRepository.ts`
- `frontend/src/components/GenerateHeatsPage.tsx`
- `frontend/src/pages/ParticipantsStructure.tsx`

La duplication de `deletePlannedHeats` a été retirée de `HeatRepository`, où elle n'était appelée par aucun consommateur. `createHeat` reste dans le repository runtime car ses usages ne relèvent pas de la génération initiale.

## Consommateurs et rollback

Consommateurs migrés :

- `GenerateHeatsPage` ;
- `ParticipantsStructure`.

Après migration, aucun consommateur de production n'appelle directement `createHeatsWithEntries`. Les exports historiques `createHeatsWithEntries` et `deletePlannedHeats` restent présents dans `api/supabaseClient`.

Rollback : rétablir les deux imports et appels historiques dans les écrans, retirer `heatPlanning` de `RepositoryRegistry`, puis restaurer si nécessaire la méthode dupliquée de `HeatRepository`. Aucune donnée ou migration n'est nécessaire pour ce rollback.

## Tests

### Tests unitaires et de caractérisation

Couverture ajoutée :

- génération nominale ;
- participants ordonnés par seed et identité événement/catégorie/seed ;
- conservation de `color_order` et des couleurs d'entries ;
- payload exact de `bulk_upsert_heats` ;
- `p_delete_ids` sans remplacement et avec remplacement ;
- remplacement de tous les heats existants de la catégorie selon le comportement actuel ;
- création de `heat_configs` après succès RPC ;
- aucune écriture directe vers `scores` ;
- propagation d'une erreur RPC avant création de `heat_configs` ;
- suppression limitée aux IDs `planned/open` sélectionnés ;
- absence de suppression quand la sélection est vide ;
- conservation du comportement d'erreur de suppression ;
- délégation repository et résultat canonique ;
- absence de dépendance runtime/lifecycle/scoring/timer/qualification.

Résultats :

- tests ciblés finaux : **9 réussis sur 9** pour l'adaptateur/repository ;
- tests bracket/génération ciblés : **10 réussis sur 10** ;
- suite complète : **302 réussis, 3 opt-in ignorés** ;
- typecheck `tsc --noEmit` : **réussi** ;
- build production Vite : **réussi**, 2 380 modules transformés ;
- audit réseau P1 : **réussi**, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display`.

L'avertissement WebSocket `listen EPERM` de Vitest provient du sandbox et n'empêche pas l'exécution des tests.

### Test Supabase local opt-in

Le test `realHeatPlanning.integration.test.ts` :

- crée un événement temporaire unique ;
- utilise une identité locale éphémère conforme à la RLS ;
- appelle la vraie façade et la vraie RPC ;
- prévoit la vérification des nombres de heats, entries, configs et scores ;
- appelle la suppression explicite ;
- supprime systématiquement l'événement dans un bloc `finally`.

Commande :

```bash
RUN_REAL_HEAT_PLANNING_INTEGRATION=1 npx vitest run src/repositories/__tests__/realHeatPlanning.integration.test.ts
```

Deux essais ont d'abord caractérisé les politiques RLS attendues. L'essai authenticated atteint ensuite la vraie RPC mais échoue sur la contrainte locale `heats_status_check` : l'adaptateur historique produit `status='open'`, alors que la stack locale accepte seulement `waiting`, `running`, `paused`, `finished` et `closed`.

Le nettoyage a été vérifié directement : **0 événement temporaire restant**. Le test reste opt-in et met en évidence la divergence ; il n'est pas déclaré réussi artificiellement et aucune contrainte SQL ou valeur de payload n'a été modifiée.

## Risques ouverts

1. **Divergence bloquant le planning réel local** : `status='open'` produit par le chemin legacy n'est pas accepté par la contrainte de la stack locale testée. La correction nécessite une décision séparée sur le contrat de statut ou le schéma ; elle dépasse l'encapsulation sans changement de comportement autorisée ici.
2. **Remplacement destructif** : `overwrite=true` supprime tous les heats de la catégorie, indépendamment de leur statut, avec cascades possibles jusque dans `scores`.
3. **Collision destructive sans overwrite** : les IDs nouvellement générés sont transmis dans `p_delete_ids`, donc un bracket portant les mêmes IDs est supprimé avant réinsertion.
4. **Erreur de suppression d'entries non contrôlée** : `deletePlannedHeats` ignore historiquement l'erreur du premier delete avant de supprimer les heats.
5. Les fallbacks offline ne sont pas disponibles sur ce chemin historique ; aucune capacité nouvelle n'a été inventée.

## Critère de fin du lot

L'encapsulation P2.5.6f est terminée et les tests de parité sont verts. Le test réel révèle toutefois une incompatibilité de statut préexistante qui doit être explicitement arbitrée avant de considérer la génération terrain locale comme validée.

Le nettoyage global de `api/supabaseClient` et P2.5.7 n'ont pas commencé.
