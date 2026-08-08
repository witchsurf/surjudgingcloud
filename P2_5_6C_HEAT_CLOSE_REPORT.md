# P2.5.6c — Fermeture de heat

## Statut

P2.5.6c est terminé sur la fermeture uniquement. La propagation manuelle séparée, le rebuild séparé, l'active heat pointer hors comportement intrinsèque des RPC et la création/suppression de heats planifiés n'ont pas été migrés.

Aucun SQL, scoring, WAL, règle timer, priorité, Realtime client, Cloud↔HP, ESP32, route P1, `event-box` ou `beach` n'a été modifié.

## Responsabilité

La fermeture rejoint `HeatLifecycleRepositoryContract` sous la méthode `close`. Comme l'activation, elle orchestre plusieurs tables et fonctions métier dans une transaction ; elle n'appartient ni au CRUD heat ni au moteur de scoring.

## Chemin avant/après

Avant :

```text
useHeatManager
  -> api/supabaseClient.closeHeatOnPodium
  -> api/modules/heats.api.closeHeatOnPodium
  -> close_heat_on_podium_strict
     -> éventuellement close_heat_on_podium si la fonction stricte est absente
```

Après :

```text
useHeatManager
  -> HeatLifecycleRepository.close
  -> api/modules/heats.api.closeHeatOnPodium
  -> close_heat_on_podium_strict
     -> éventuellement close_heat_on_podium si la fonction stricte est absente
```

La façade `api/supabaseClient.closeHeatOnPodium` reste exportée pour rollback.

## RPC stricte

Premier appel inchangé : `close_heat_on_podium_strict`.

Payload :

```ts
{
  p_event_id: input.eventId,
  p_podium_id: normalizedPodiumId,
  p_heat_id: ensureHeatId(input.heatId),
  p_next_heat_id: input.nextHeatId ? ensureHeatId(input.nextHeatId) : null,
  p_closed_by: input.closedBy || 'admin',
  p_force: Boolean(input.force),
  p_force_reason: input.forceReason?.trim() || null,
}
```

La fonction stricte :

1. calcule `fn_get_heat_close_readiness` ;
2. exige une raison non vide si `p_force = true` ;
3. en mode forcé, positionne le flag transactionnel et écrit `HEAT_CLOSE_FORCED` dans `competition_audit_log` avec la readiness ;
4. appelle la fonction legacy `close_heat_on_podium` dans la même transaction ;
5. retourne sans transformation son résultat JSON.

Erreurs métier bloquantes caractérisées :

- heat absent : `23503` ;
- heat ne correspondant pas à event : `23503` ;
- pointeur actif différent du heat/podium : `23514` ;
- readiness bloquante : `23514`, message `HEAT_CLOSE_BLOCKED:<json>` ;
- force sans raison : `23514` ;
- RLS/permission : erreur originale propagée.

## Fallback vers la RPC legacy

Le fallback `close_heat_on_podium` reste interdit en mode forcé. Hors force, il est utilisé uniquement lorsque la fonction stricte est réellement indisponible :

- code PostgREST `PGRST202` ;
- code PostgreSQL `42883` ;
- ou message contenant le nom `close_heat_on_podium_strict` **et** un marqueur d'absence : `schema cache`, `could not find`, `does not exist`, `function ... not found`.

Payload legacy inchangé :

```ts
{
  p_event_id: input.eventId,
  p_podium_id: normalizedPodiumId,
  p_heat_id: ensureHeatId(input.heatId),
  p_next_heat_id: input.nextHeatId ? ensureHeatId(input.nextHeatId) : null,
  p_closed_by: input.closedBy || 'admin',
}
```

### Correction de sécurité nécessaire

L'inventaire préalable a découvert que le motif historique considérait la seule présence du texte `close_heat_on_podium_strict` comme preuve d'absence. Une erreur réelle telle que `permission denied for function close_heat_on_podium_strict` pouvait donc basculer vers la RPC legacy. Le `catch` externe de `useHeatManager` avait le même défaut et pouvait ensuite appliquer `updateHeatStatus`.

Le critère a été centralisé dans `utils/heatCloseErrors.ts` et resserré aux seuls marqueurs d'indisponibilité ci-dessus. Aucun fallback n'a été ajouté ; seuls les faux positifs RLS/métier/contrainte sont désormais bloqués conformément au point de sécurité obligatoire. Les erreurs réelles sont propagées et affichées par les mêmes chemins opérateur.

## Effets DB intrinsèques

La fonction legacy atomique effectue dans cet ordre :

1. verrouille le heat appartenant à l'événement ;
2. verrouille et vérifie `active_heat_pointer` pour le couple événement/podium ;
3. vérifie la readiness, sauf force transactionnel ;
4. met à jour `heats` :
   - `status = closed` ;
   - `closed_at = coalesce(closed_at, now())` ;
   - `is_active = false` ;
   - `updated_at = now()` ;
5. upsert `heat_realtime_config` :
   - `status = closed` ;
   - `timer_start_time = null` ;
   - `updated_by = closedBy/admin` ;
6. appelle `fn_propagate_qualifiers_for_source_heat` ;
7. appelle `rebuild_division_qualifiers_from_scores` ;
8. si `nextHeatId` existe, appelle intrinsèquement `activate_heat_on_podium` ;
9. retourne les compteurs et le résultat d'activation éventuel.

Effets par zone :

- `heats.status/is_active` : modifiés comme indiqué ;
- `active_heat_pointer` : vérifié, mais non effacé ; il ne change que si un prochain heat est activé intrinsèquement ;
- `heat_entries/mappings` : la fermeture ne les réécrit pas directement ; propagation/rebuild intrinsèques peuvent mettre à jour les slots de qualification cibles selon les fonctions SQL existantes ;
- qualification : exécutée atomiquement dans la RPC, jamais réimplémentée dans le repository ;
- panel : aucune modification directe pendant la fermeture ; une activation intrinsèque du suivant recopie son panel selon la RPC d'activation ;
- Realtime DB : `heat_realtime_config` fermé et timer serveur annulé ;
- scores : lus par readiness/rebuild, jamais écrits par le repository ou la RPC de fermeture.

## Résultat canonique

`HeatLifecycleRepository.close` expose sans recalcul :

- événement et podium ;
- heat fermé ;
- indicateur force ;
- readiness ;
- `qualifierSlotsUpdated` ;
- `divisionSlotsRebuilt` ;
- résultat `next` éventuel.

`useHeatManager` additionne les deux mêmes compteurs qu'avant pour son message opérateur. Aucun résultat de qualification n'est recalculé.

## Fallbacks client existants

Le flux client reste inchangé :

1. tentative de pause timer avant fermeture ;
2. fermeture lifecycle atomique si Supabase/event disponibles ;
3. si les RPC de fermeture sont réellement absentes et hors force, `updateHeatStatus` legacy ;
4. arrêt immédiat du timer UI/localStorage ;
5. si la fermeture atomique a réussi, retour immédiat : aucune propagation client ;
6. sinon, le chemin legacy de propagation/rebuild/fallback client continue exactement comme avant.

Ce chemin manuel n'a pas été déplacé dans le repository et n'a pas été fusionné avec `close`.

## Double fermeture / heat déjà fermé

Le client n'ajoute aucune déduplication : un retry appelle de nouveau la RPC.

Le comportement SQL historique dépend alors de l'état :

- le pointeur doit toujours viser ce heat ;
- la readiness stricte peut bloquer ;
- si la fermeture est autorisée, `closed_at` est conservé par `coalesce`, `updated_at` est rafraîchi et propagation/rebuild sont rappelés.

Le repository ne masque ni ne transforme ce comportement.

## Tests

Tests adaptateur strict/legacy :

- fermeture nominale par strict ;
- payload strict exact ;
- résultat/compteurs de qualification inchangés ;
- fallback legacy pour `PGRST202`, `42883` et message d'absence explicite ;
- payload legacy exact ;
- aucun fallback en mode force ;
- aucune bascule legacy pour readiness, RLS, contrainte, heat/event/podium invalide ;
- valeurs par défaut et nulls inchangés.

Tests lifecycle :

- mapping du résultat ;
- heat déjà fermé ;
- heat/event/podium invalide ;
- erreur readiness ;
- double fermeture/retry non dédupliqué ;
- compteurs qualification conservés ;
- absence de dépendance scoring.

Tests de classification sécurité :

- absence réelle acceptée ;
- RLS mentionnant le nom de fonction refusée ;
- `HEAT_CLOSE_BLOCKED` refusée ;
- contrainte `23503/23514` refusée ;
- absence réelle de la RPC legacy reconnue par le fallback externe.

Résultats :

- tests ciblés finaux : **54/54 réussis** ;
- typecheck : **succès** ;
- suite complète : **262 réussis, 2 intégrations Supabase conditionnelles ignorées, 0 échec** ;
- build Vite : **succès**, 2 376 modules transformés ;
- audit réseau P1 : **succès**, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` → `/admin`, `/judge`, `/priority`, `/display`.

L'avertissement Vitest `listen EPERM` du WebSocket HMR du sandbox reste non bloquant.

## Test Supabase réel

Aucun test destructif réel n'a été ajouté. La fermeture modifie atomiquement le heat, la configuration Realtime, des slots de qualification, le pointeur éventuel, un audit force éventuel et peut activer un autre heat. Sans fixture locale réservée et transaction de test englobant la RPC, restaurer exactement ces effets et timestamps n'est pas garanti via PostgREST.

Conformément à la contrainte, aucune base locale potentiellement active n'a été touchée. La fonction SQL versionnée a été caractérisée ligne par ligne et l'adaptateur/fallback est testé exhaustivement.

## Rollback

1. rétablir l'import `closeHeatOnPodium` depuis `api/supabaseClient` dans `useHeatManager` ;
2. remplacer `heatLifecycleRepository.close(request)` par la fonction legacy ;
3. conserver ou retirer `close` du contrat lifecycle sans donnée à migrer.

La façade legacy reste exportée. La correction de classification sécurité est indépendante de la façade repository ; la retirer rétablirait le faux positif RLS et n'est donc pas recommandée.

## Risques ouverts

- Le pointeur reste sur le heat fermé lorsqu'aucun `nextHeatId` n'est fourni ; comportement SQL historique conservé.
- Un retry autorisé peut relancer propagation/rebuild et rafraîchir `updated_at`.
- Le fallback externe `updateHeatStatus` ne produit pas les garanties atomiques de la RPC ; il reste réservé aux anciens schémas réellement dépourvus des fonctions.
- Aucun test réel n'est exécuté faute de fixture transactionnelle isolée.
- Les validations HP réel et Realtime plage restent ouvertes.

La propagation/rebuild séparée n'a pas été commencée.
