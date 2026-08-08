# P2.5.6d — Propagation / rebuild de qualifiés : recovery

## Statut

P2.5.6d est terminé sur les deux opérations manuelles de secours autorisées :

- `propagateQualifiersForSourceHeat` ;
- `rebuildDivisionQualifiersFromScores`.

La fermeture atomique validée en P2.5.6c n'a pas été modifiée. L'active heat pointer, le heat planning, Realtime, timer et priorité n'ont pas été migrés.

Aucun SQL, scoring métier, WAL, Cloud↔HP, ESP32, route P1, `event-box` ou `beach` n'a été modifié.

## Responsabilité architecturale

Une frontière dédiée a été créée :

- `QualificationRecoveryRepositoryContract` ;
- `QualificationRecoveryRepository` ;
- entrée `RepositoryRegistry.qualificationRecovery`.

Cette façade est explicitement réservée à l'orchestration/réparation manuelle. Elle reste distincte :

- de `HeatRepository`, qui conserve les responsabilités CRUD ;
- de `HeatLifecycleRepository.close`, qui reste le chemin nominal atomique ;
- du moteur de scoring, qui n'importe pas ce repository et ne calcule aucun qualifié pour lui.

Le repository ne contient aucune règle de classement, aucun calcul sportif et aucune écriture directe en base. Il délègue exclusivement aux deux adaptateurs RPC existants.

## Chemin nominal et chemin recovery

### Fermeture nominale

```text
HeatLifecycleRepository.close
  -> close_heat_on_podium_strict
  -> close_heat_on_podium
  -> propagation + rebuild intrinsèques SQL
  -> retour immédiat du client
```

Après une fermeture atomique réussie, `atomicCloseSucceeded` vaut vrai et `useHeatManager` exécute un `return` avant tout appel à `QualificationRecoveryRepository`.

Garantie statique testée :

```text
close atomique réussi
  -> 0 propagateSourceHeat client
  -> 0 rebuildDivision client
```

`HeatLifecycleRepository` ne référence ni la façade recovery ni les deux adaptateurs RPC manuels.

### Propagation recovery

Le chemin manuel de `useHeatManager` reste atteint uniquement lorsque la fermeture atomique n'a pas réussi ou n'a pas été utilisée, après le chemin de fermeture/status legacy.

Conditions préexistantes conservées :

- des scores strictement positifs existent pour le heat courant ;
- un eventId est résolu ;
- Supabase est configuré ;
- `atomicCloseSucceeded` est faux, car le chemin a déjà retourné sinon.

Ordre inchangé :

1. appel RPC via `qualificationRecoveryRepository.propagateSourceHeat` ;
2. si succès, `qualifiersHandledByDatabase = true` et aucun fallback client ;
3. si erreur `RPC_UNAVAILABLE:fn_propagate_qualifiers_for_source_heat`, warning puis fallback client historique ;
4. toute autre erreur est propagée ;
5. le fallback client historique reconstruit les qualifiés/mappings dans son ordre existant.

### Rebuild recovery

Le rebuild est une action opérateur explicite dans `AdminInterface`.

Conditions préexistantes conservées :

- compétition et division présentes ;
- eventId résolu ;
- action manuelle déclenchée par l'opérateur.

Ordre inchangé :

1. appel RPC via `qualificationRecoveryRepository.rebuildDivision` ;
2. si succès, message avec le compteur, reload et retour ;
3. si erreur `RPC_UNAVAILABLE:rebuild_division_qualifiers_from_scores`, warning puis fallback client historique ;
4. toute autre erreur bloque et utilise le message opérateur existant ;
5. le fallback relit séquence, résultats, panels, entries et mappings dans l'ordre déjà présent.

## RPC et payloads

### Propagation

RPC inchangée :

```text
fn_propagate_qualifiers_for_source_heat
```

Payload inchangé :

```ts
{
  p_source_heat_id: ensureHeatId(heatId)
}
```

Retour inchangé : `Number(data ?? 0)`.

Si la RPC est absente, l'adaptateur conserve l'erreur synthétique :

```text
RPC_UNAVAILABLE:fn_propagate_qualifiers_for_source_heat
```

### Rebuild division

RPC inchangée :

```text
rebuild_division_qualifiers_from_scores
```

Payload inchangé :

```ts
{
  p_event_id: eventId,
  p_division: division
}
```

La division n'est ni trimée ni normalisée par la nouvelle façade. Retour inchangé : `Number(data ?? 0)`.

Si la RPC est absente :

```text
RPC_UNAVAILABLE:rebuild_division_qualifiers_from_scores
```

Les erreurs métier, contraintes et mauvais event/division/heat sont propagés par identité comme avant.

## Consommateurs migrés

- `useHeatManager` pour la propagation recovery après fermeture legacy/non atomique ;
- `AdminInterface` pour le rebuild manuel explicite.

Les exports historiques restent présents dans `api/supabaseClient`, ce qui conserve le rollback par import.

## Absence de double propagation

Trois garanties automatiques ont été ajoutées :

1. le `return` après `atomicCloseSucceeded` précède lexicalement l'appel recovery ;
2. l'appel propagation recovery reste après le chemin `updateHeatStatus(..., closed)` legacy ;
3. `HeatLifecycleRepository` ne contient aucun import/appel propagation ou rebuild.

Le rebuild Admin conserve également l'ordre RPC d'abord, fallback client ensuite.

Aucun appel manuel n'a été ajouté au résultat de `close()`.

## Absence d'écriture scoring

`QualificationRecoveryRepository` n'importe ni moteur scoring, ni `ScoreRepository`, ni table `scores`. Il transmet des identifiants aux RPC et retourne leurs compteurs.

Les RPC restent seules responsables de la sélection et de l'écriture des slots qualifiés. Le repository ne recalcule aucun rang, résultat ou participant.

Le fallback client historique utilise encore les calculs frontend déjà présents lorsque les RPC sont absentes. Il n'a pas été déplacé, réécrit ou modifié dans ce sous-lot.

## Tests ajoutés

### Repository

- propagation nominale ;
- rebuild nominal ;
- compteurs inchangés ;
- mauvais heat ;
- mauvais event/division ;
- erreurs propagées par identité ;
- absence de calcul ou écriture scoring.

### Adaptateurs RPC

- nom et payload exacts de propagation ;
- normalisation historique du heatId ;
- nom et payload exacts du rebuild ;
- division transmise sans modification ;
- conversion numérique des deux retours ;
- erreurs `RPC_UNAVAILABLE` inchangées ;
- erreurs métier originales inchangées.

### Flux/statique

- fermeture atomique réussie : zéro appel recovery ;
- lifecycle nominal indépendant du recovery ;
- propagation recovery après fermeture/status legacy ;
- rebuild RPC avant fallback Admin.

## Résultats

- tests ciblés initiaux : **48/48 réussis** ;
- test de flux complété : **4 assertions de frontière** ;
- typecheck : **succès** ;
- suite complète : **277 réussis, 2 intégrations Supabase conditionnelles ignorées, 0 échec** ;
- build Vite : **succès**, 2 377 modules transformés ;
- audit réseau P1 : **succès**, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` → `/admin`, `/judge`, `/priority`, `/display`.

La première tentative d'audit réseau a expiré pendant la revue automatique d'autorisation locale ; elle n'a produit aucun résultat fonctionnel. La relance autorisée s'est terminée avec succès et zéro violation.

L'avertissement Vitest `listen EPERM` du WebSocket HMR reste non bloquant.

## Rollback

Rollback sans donnée ni migration :

1. rétablir les imports `propagateQualifiersForSourceHeat` et `rebuildDivisionQualifiersFromScores` depuis `api/supabaseClient` ;
2. remplacer les deux appels repository par les appels historiques ;
3. retirer le repository/contrat/registry si souhaité.

Les adaptateurs legacy et leurs exports n'ont pas été supprimés.

## Risques ouverts

- Le fallback client historique recalcule encore des qualifiés côté frontend lorsque les RPC sont absentes. Il reste volontairement hors repository et constitue une dette legacy documentée.
- Une utilisation manuelle répétée des outils recovery peut rappeler les RPC ; aucune déduplication ou verrou client n'a été ajouté.
- Les fonctions SQL peuvent modifier plusieurs slots cibles ; aucun test Supabase réel n'a été ajouté sans fixture transactionnelle isolée.
- Les tests d'intégration WAL Supabase restent conditionnels et ont été ignorés par la suite standard.
- Les validations HP réel et Realtime plage restent ouvertes.

L'active heat pointer et le heat planning n'ont pas été commencés.
