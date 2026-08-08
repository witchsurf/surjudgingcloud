# P2.5.6b — Activation de heat

## Statut

P2.5.6b est terminé sur l'activation uniquement. La fermeture, la propagation, l'active heat pointer hors RPC, le rebuild des qualifiés et la création/suppression de heats planifiés n'ont pas été migrés.

Aucun SQL, fallback, scoring, WAL, timer, priorité, Realtime client, Cloud↔HP, ESP32, route P1, `event-box` ou `beach` n'a été modifié.

## Responsabilité choisie

L'activation n'est pas un CRUD heat : la RPC orchestre plusieurs agrégats et tables dans une transaction. Une frontière dédiée minimale a donc été créée :

- `HeatLifecycleRepositoryContract` ;
- `HeatLifecycleRepository` ;
- méthode unique dans ce lot : `activate`.

Cette responsabilité est enregistrée séparément sous `RepositoryRegistry.heatLifecycle`. Aucune méthode d'activation n'a été ajoutée artificiellement à `HeatRepository` et aucune logique n'a été placée dans le moteur de scoring.

## Chemin avant/après

Avant :

```text
AdminInterface / useHeatManager
  -> api/supabaseClient.activateHeatOnPodium
  -> api/modules/heats.api.activateHeatOnPodium
  -> RPC activate_heat_on_podium
```

Après :

```text
AdminInterface / useHeatManager
  -> HeatLifecycleRepository.activate
  -> api/modules/heats.api.activateHeatOnPodium
  -> RPC activate_heat_on_podium
```

La façade `api/supabaseClient.activateHeatOnPodium` reste exportée et fonctionnelle pour rollback.

## RPC et payload

RPC inchangée :

```text
activate_heat_on_podium
```

Payload inchangé :

```ts
{
  p_event_id: input.eventId,
  p_podium_id: normalizedPodiumId,
  p_heat_id: ensureHeatId(input.heatId),
  p_assigned_by: input.assignedBy || 'admin',
}
```

La normalisation reste exclusivement dans l'adaptateur historique :

- podium trimé et mis en majuscules, fallback `A` ;
- heat normalisé par `ensureHeatId` ;
- `assignedBy` fallback `admin`.

Le repository transmet la requête à l'adaptateur sans la reconstruire. Les erreurs Postgres/RLS sont propagées par identité, sans enveloppe ni nouveau message.

## Effets DB observés dans la migration existante

L'inventaire de `20260727090000_podium_panels_and_atomic_heat_transitions.sql` montre l'ordre transactionnel suivant :

1. verrouillage du heat correspondant à `p_heat_id` et `p_event_id` ;
2. rejet `23503` si le heat n'appartient pas à l'événement ;
3. rejet `23514` si le heat est fermé ;
4. appel `copy_podium_panel_to_heat` :
   - validation de l'existence du heat ;
   - vérification qu'un panel podium existe ;
   - suppression des stations heat absentes du panel podium ;
   - upsert des affectations du panel dans `heat_judge_assignments` ;
5. appel intrinsèque à `upsert_active_heat_pointer` avec événement, compétition, heat, instant courant et podium ;
6. update `heats` :
   - `waiting` devient `open` ;
   - les autres statuts non fermés restent inchangés ;
   - `is_active = true` ;
   - `updated_at = now()` ;
7. retour JSON avec événement, podium, heat, division, round, numéro et taille de panel.

L'activation ne met pas à jour `heat_realtime_config`, ne lance pas le timer, ne propage aucun qualifié et n'écrit aucune donnée de scoring. Ces effets restent absents côté client et repository.

## Retry, double activation et heat déjà actif

Le client n'ajoute aucune déduplication : deux appels produisent deux appels RPC identiques, comme avant.

La RPC accepte un heat déjà actif tant qu'il n'est pas fermé. Elle recopie/upsert le panel, réécrit le pointeur et remet `is_active = true`. Les contraintes/upserts DB empêchent la création de doublons d'affectation pour la même paire `heat_id, station`, mais les timestamps peuvent être rafraîchis conformément au comportement historique.

Le repository n'inspecte jamais le statut avant l'appel et n'invente donc aucune règle concurrente à la RPC.

## Consommateurs migrés

- `AdminInterface`, dans le chemin de préparation automatique du podium ;
- `useHeatManager`, dans le chemin historique d'avance automatique.

Les messages opérateur, l'ordre `setPodiumPanel` puis activation dans Admin, les `assignedBy`, les blocs `try/catch` et les réactions UI restent inchangés.

## Tests ajoutés

### Repository/orchestration

- activation nominale ;
- mapping du DTO de réponse ;
- mauvais heatId / erreur `23503` propagée ;
- mauvais événement/podium et métadonnée RLS propagés ;
- double activation/retry : deux appels identiques, aucune déduplication client ;
- heat déjà actif : délégation sans règle client ;
- absence de toute dépendance/opération scoring.

### Adaptateur RPC

- nom RPC exact ;
- payload complet strictement identique ;
- normalisation du podium ;
- valeurs par défaut `A` et `admin` ;
- normalisation du heatId ;
- propagation de l'objet erreur par identité.

### Régressions

- moteur scoring P2 et parité legacy ;
- AdminInterface P2 ;
- suite P0/P1/P2 complète ;
- tests architecturaux repository.

## Résultats

- tests ciblés : **61/61 réussis** ;
- typecheck : **succès** ;
- suite complète : **240 réussis, 2 intégrations Supabase conditionnelles ignorées, 0 échec** ;
- build Vite : **succès**, 2 375 modules transformés ;
- audit réseau P1 : **succès**, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` → `/admin`, `/judge`, `/priority`, `/display`.

L'avertissement Vitest `listen EPERM` du WebSocket HMR du sandbox reste non bloquant ; toutes les commandes de test terminent avec le code 0.

## Intégration Supabase locale

Un test destructif opt-in n'a pas été ajouté dans ce sous-lot. Tester la vraie RPC exige un événement, un heat, un panel podium et la restauration transactionnelle de quatre ensembles (`heat_judge_assignments`, `active_heat_pointer`, `heats` et timestamps). Le client PostgREST ne permet pas d'envelopper l'appel RPC et le nettoyage dans une transaction de test unique.

Sans fixture locale dédiée explicitement réservée, un tel test pourrait altérer un événement local actif, ce qui violerait la contrainte non destructive. Les effets DB ont donc été vérifiés par lecture de la fonction SQL versionnée, tandis que le payload réel de l'adaptateur est testé automatiquement. Un futur test réel devra créer ses fixtures dans une base réinitialisable ou disposer d'une RPC de test transactionnelle séparée, après validation.

## Rollback

Rollback sans donnée ni migration :

1. rétablir l'import `activateHeatOnPodium` depuis `api/supabaseClient` dans les deux consommateurs ;
2. remplacer `heatLifecycleRepository.activate(request)` par `activateHeatOnPodium(request)` ;
3. retirer le repository et son entrée registry si souhaité.

L'adaptateur legacy, sa RPC, ses types de réponse et ses exports n'ont pas été supprimés.

## Risques ouverts

- La RPC historique ne désactive pas explicitement un autre heat précédemment marqué `is_active = true` ; elle déplace le pointeur du podium et active la cible. Ce comportement préexistant est documenté, pas corrigé dans P2.5.6b.
- Une double activation rafraîchit certains timestamps même si le résultat fonctionnel reste le même.
- Il n'existe aucun fallback si la RPC manque dans un ancien schéma ; cette absence est conservée strictement.
- La validation réelle sur stack locale n'est pas automatisée faute de fixture transactionnelle isolée.
- Les validations terrain HP réel et Realtime plage restent ouvertes.

La fermeture n'a pas été commencée.
