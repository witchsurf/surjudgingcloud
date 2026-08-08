# P2.5.6e — Active Heat Pointer

## Conclusion

Le pointeur de heat actif passe désormais par une façade repository dédiée, distincte du CRUD heat, du lifecycle, de la qualification et du moteur de scoring. Les adaptateurs Supabase existants restent l'unique implémentation active et leur comportement n'a pas été modifié.

Le lot ne contient aucun changement SQL, scoring, WAL, timer, priorité, Realtime, Cloud ↔ HP, ESP32, route P1, `event-box` ou `beach`. Le heat planning n'a pas commencé.

## Responsabilité choisie

`ActiveHeatPointerRepositoryContract` porte uniquement deux opérations :

- `get`: lire le pointeur d'un événement/podium ;
- `upsert`: écrire le pointeur d'un événement/podium.

Cette frontière est volontairement séparée de :

- `HeatRepository`, consacré aux données heat/lineup ;
- `HeatLifecycleRepository`, consacré à l'activation et à la fermeture ;
- `QualificationRecoveryRepository`, consacré aux chemins manuels de secours ;
- le moteur de scoring.

`parseActiveHeatId` a été extrait comme utilitaire pur. Il reste réexporté par la façade historique afin de préserver le rollback et les imports externes éventuels.

## Chemin avant / après

Avant :

```text
consommateur
  -> api/supabaseClient ou api/modules/heats.api
  -> fetchActiveHeatPointer / upsertActiveHeatPointer
  -> RPC/table Supabase
```

Après :

```text
consommateur
  -> ActiveHeatPointerRepositoryContract
  -> ActiveHeatPointerRepository
  -> adaptateurs existants de api/modules/heats.api
  -> RPC/table Supabase inchangées
```

`api/supabaseClient` conserve ses exports historiques. Le rollback consiste donc à rétablir les imports consommateurs vers cette façade, sans changement de données ou de schéma.

## RPC, table et fallbacks conservés

### Écriture

Le repository délègue sans transformer le comportement à `upsertActiveHeatPointer` :

1. RPC `upsert_active_heat_pointer` avec la signature courante et `podium_id` ;
2. uniquement si la RPC est détectée comme indisponible, nouvel appel à la même RPC avec la signature legacy sans podium ;
3. uniquement si la RPC reste indisponible, fallback sur la table `active_heat_pointer` ;
4. fallback de schéma sans colonne `podium_id` lorsque l'ancien schéma est détecté.

Le payload transmis par le repository reste composé de `eventId`, `eventName`, `podiumId`, `activeHeatId` et `updatedAt`. L'adaptateur existant conserve la normalisation et les noms SQL actuels.

Les erreurs RPC réelles ne sont pas converties en indisponibilité et restent propagées comme auparavant.

### Lecture

Le repository délègue à `fetchActiveHeatPointer` :

- lecture de `active_heat_pointer` filtrée par événement et podium lorsque le schéma le permet ;
- fallback legacy sans colonne podium lorsque l'erreur de schéma correspondante est détectée ;
- `null` lorsqu'aucun pointeur n'existe ;
- `null` sur l'erreur de lecture résiduelle, conformément au comportement historique de l'adaptateur.

Aucune validation de statut du heat, désactivation d'un autre heat ou réparation automatique n'a été ajoutée. Un pointeur vers un heat fermé reste donc conservé.

## Multi-podium et compatibilité legacy

Sur le schéma courant, `podium_id` reste normalisé comme auparavant et deux podiums peuvent posséder deux pointeurs indépendants.

Le fallback pour un ancien schéma sans colonne podium est strictement conservé. Sa limite historique demeure : la base legacy ne peut pas représenter plusieurs pointeurs indépendants par podium. Le repository ne masque pas et ne corrige pas cette limitation.

Le hint localStorage reste dans l'adaptateur existant, sans modification :

- clé : `active_heat_pointer_event_id_upsert_support` ;
- durée : 6 heures ;
- même cache mémoire et même normalisation ;
- aucune nouvelle écriture localStorage dans le repository.

Un identifiant de heat invalide n'est pas réparé : la lecture conserve la valeur brute et l'utilitaire pur `parseActiveHeatId` retourne `null`. Un event ID absent ou non exploitable suit les filtres historiques de l'adaptateur.

## Fichiers créés

- `frontend/src/repositories/contracts/activeHeatPointer.ts`
- `frontend/src/repositories/ActiveHeatPointerRepository.ts`
- `frontend/src/utils/activeHeatId.ts`
- `frontend/src/api/modules/__tests__/activeHeatPointer.api.test.ts`
- `frontend/src/repositories/__tests__/ActiveHeatPointerRepository.test.ts`
- `frontend/src/utils/__tests__/activeHeatId.test.ts`

## Fichiers modifiés

- `frontend/src/repositories/contracts/index.ts`
- `frontend/src/repositories/RepositoryRegistry.ts`
- `frontend/src/repositories/index.ts`
- `frontend/src/api/modules/heats.api.ts`
- `frontend/src/stores/configStore.ts`
- `frontend/src/pages/ParticipantsStructure.tsx`
- `frontend/src/pages/OverlayPage.tsx`
- `frontend/src/lib/sharedRealtimeSubscriptions.ts`
- `frontend/src/hooks/useRealtimeSync.ts`
- `frontend/src/pages/JudgePage.tsx`
- `frontend/src/pages/PriorityJudgePage.tsx`
- `frontend/src/pages/DisplayPage.tsx`

Dans `sharedRealtimeSubscriptions`, la lecture canonique est remappée vers la forme snake_case déjà attendue par le flux interne. Le abonnement Realtime lui-même, ses événements et ses callbacks n'ont pas été modifiés.

## Imports et consommateurs migrés

Inventaire avant migration :

- quatre appels directs de lecture dans trois fichiers : deux dans `configStore`, un dans `OverlayPage`, un dans `sharedRealtimeSubscriptions` ;
- deux appels directs d'écriture : `configStore` et `ParticipantsStructure` ;
- plusieurs imports du parseur via la façade API.

Après migration :

- aucun consommateur de production n'importe directement les opérations du pointeur depuis `api/supabaseClient` ou `heats.api` ;
- seul `ActiveHeatPointerRepository` dépend des deux adaptateurs API ;
- les consommateurs du parseur importent l'utilitaire pur ;
- les exports historiques restent disponibles dans `api/supabaseClient` et `heats.api` pour rollback.

## Tests ajoutés et résultats

Les tests couvrent :

- lecture nominale ;
- écriture nominale et payload RPC courant exact ;
- podiums A et B indépendants ;
- fallback RPC avec signature legacy sans podium ;
- fallback table ancien schéma sans podium ;
- pointeur absent ;
- identifiant de heat invalide ;
- event ID absent/invalide selon le comportement historique ;
- propagation des erreurs d'écriture et retour `null` historique en lecture ;
- conservation d'un pointeur vers un heat fermé ;
- absence de dépendance vers lifecycle, qualification, scoring ou timer ;
- parsing des divisions simples et des suffixes composés existants.

Résultats :

- tests ciblés : **26 réussis sur 26** ;
- typecheck `tsc --noEmit` : **réussi** ;
- suite complète : **293 réussis, 2 tests d'intégration Supabase opt-in ignorés** ;
- build Vite production : **réussi**, 2 379 modules transformés ;
- audit réseau P1 : **réussi**, aucune violation statique ou runtime ;
- routes contrôlées : `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display` ;
- aucune opération scoring, qualification ou timer déclenchée par les tests du repository.

L'avertissement `listen EPERM` du serveur WebSocket Vitest est lié au sandbox de test et n'a pas empêché l'exécution des suites. L'audit P1 a été exécuté séparément avec l'autorisation d'ouvrir son serveur Vite local et s'est terminé avec `ok: true`.

## Rollback

Le rollback est limité aux imports consommateurs :

1. rétablir `fetchActiveHeatPointer` et `upsertActiveHeatPointer` depuis `api/supabaseClient` ;
2. conserver ou rétablir le parseur réexporté par la façade historique ;
3. retirer l'entrée `activeHeatPointer` de `RepositoryRegistry` si nécessaire.

Aucune donnée, migration ou structure persistante n'est impliquée dans le rollback.

## Risques ouverts

- Un schéma legacy sans `podium_id` ne peut pas garantir l'indépendance de plusieurs podiums ; cette limite préexistante est inchangée.
- La lecture historique transforme les erreurs résiduelles en `null`, ce qui ne distingue pas « pointeur absent » d'une indisponibilité de lecture. Ce comportement observable a volontairement été conservé.
- Les deux tests d'intégration Supabase réelle de la suite globale restent opt-in ; ce lot valide les signatures et fallbacks avec des doubles Supabase exhaustifs, pas avec une base locale active.
- Le pointeur peut historiquement rester associé à un heat fermé ; aucune réparation automatique n'a été introduite.

## Critère de fin du lot

P2.5.6e est terminé côté code et tests. Le heat planning n'a pas été commencé et requiert toujours une validation explicite séparée.
