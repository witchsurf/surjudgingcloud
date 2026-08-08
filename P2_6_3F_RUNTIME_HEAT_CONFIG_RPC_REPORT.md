# P2.6.3F — Runtime Heat Config RPC Migration + ACL Convergence Prep

Date : 2026-08-08

## Conclusion

`RUNTIME_HEAT_CONFIG_BLOCKED`

La migration de code est réalisée et les validations unitaires, SQL isolées, build et audit réseau sont vertes. La conclusion reste toutefois bloquée au sens strict du checkpoint : la stack Supabase HTTP locale était arrêtée, donc le scénario navigateur réel perte LAN → queue IndexedDB → retour LAN → replay → lecture admin/judge/display n'a pas pu être exécuté. La migration ACL `160000` n'est ni créée ni appliquée. Aucune migration n'a été appliquée au Cloud ou à la base Mac opérationnelle.

## Ancien chemin runtime

`configStore`, `AdminPage`, `useHeatManager` et `useSupabaseSync` appellent `HeatRepository.saveConfiguration`, qui normalise le contrat puis appelle `saveHeatConfig`.

Le payload historique écrit dans `public.heat_configs` est :

```ts
{
  heat_id: string;
  judges: unknown[];          // défaut []
  surfers: unknown[];         // défaut []
  judge_names: object;        // défaut {}
  waves: number;              // défaut 15
  tournament_type: string;    // défaut "elimination"
}
```

L'upsert utilisait `heat_id` comme clé de conflit et ne demandait aucun retour de ligne. Insert et update remplaçaient les six valeurs ci-dessus. Après succès, l'ordre reste :

1. `heat_configs` ;
2. `heat_judge_assignments` ;
3. reconstruction `heat_entries` ;
4. snapshot événement pour le podium A.

`BaseRepository.execute` conserve trois retries pour les erreurs transitoires. Les erreurs de validation, RLS et authentification restent bloquantes et ne sont pas transformées en offline fallback.

## Queue offline legacy

Le format persisté n'a pas changé :

```ts
{
  operation_id: string;
  queued_at: string;
  table: "heat_configs";
  action: "upsert";
  payload: {
    rows: RuntimeHeatConfigPayload;
    options: { onConflict: "heat_id" };
  };
  timestamp: number;
}
```

Le stockage IndexedDB/localStorage, les clés, l'ordre FIFO, le retry, la suppression après succès et la priorité de la queue legacy restent inchangés. Seule l'exécution de `table=heat_configs/action=upsert` est redirigée vers la RPC. Les anciennes entrées snake_case restent lisibles. L'idempotence continue de reposer sur l'upsert `heat_id` côté RPC.

## Nouvelle RPC

Migration proposée : `backend/supabase/migrations/20260808150000_runtime_heat_config_rpc.sql`.

Fonction :

```sql
public.upsert_heat_config_runtime(
  p_heat_id text,
  p_judges text[],
  p_surfers text[],
  p_judge_names jsonb,
  p_waves integer,
  p_tournament_type text
) returns void
```

Propriétés :

- `SECURITY DEFINER`, owner `postgres`, `search_path = public` ;
- `PUBLIC` révoqué ;
- `EXECUTE` accordé à `authenticated` et `service_role` ;
- vérification d'un `heat_id` non vide et d'un heat parent existant ;
- contrôle `user_has_event_access(event_id)` en Cloud ;
- compatibilité terrain via `is_local_database()` ;
- accès explicite `service_role` ;
- même `INSERT ... ON CONFLICT (heat_id) DO UPDATE` et mêmes six colonnes ;
- aucune logique planning, lifecycle, scoring, timer ou qualification.

Le niveau d'autorisation reprend les helpers historiques : propriétaire de l'événement ou événement payé en Cloud, base locale terrain, ou `service_role`. Un heat d'un événement non accessible est refusé avec `42501`.

## Migration repository et replay

- `HeatRepository.saveHeatConfig` appelle maintenant `upsertRuntimeHeatConfig` ; signatures, retours, erreurs et ordre d'orchestration inchangés.
- `replayOfflineEntry` reconnaît l'entrée legacy existante et appelle `replayLegacyRuntimeHeatConfig`.
- aucun composant, hook ou store n'ajoute une dépendance Supabase directe.
- aucun chemin scoring/WAL n'a été modifié.

## FixScores

La route historique `/fix` est encore compilée. Son changement de `heat_configs.surfers` utilisait un `UPDATE` direct. Elle charge désormais la configuration complète et passe par la même RPC avec les autres valeurs préservées. Les corrections de scores continuent d'utiliser leur API sécurisée existante. Il ne reste plus d'écriture directe `heat_configs` dans cette page.

## Caractérisation ACL restante

| Droit | Consommateur produit identifié | Décision P2.6.3F |
|---|---|---|
| `authenticated INSERT/UPDATE` | aucun après cette migration ; runtime et replay passent par RPC | révocation candidate dans `160000`, non créée |
| `authenticated DELETE` | aucun consommateur frontend identifié | à caractériser/retirer séparément |
| `anon INSERT/UPDATE/DELETE` | aucun consommateur produit identifié ; héritage de politiques Cloud historiques | à retirer seulement après validation de compatibilité |
| `service_role` direct | aucun frontend ; scripts/backend opérationnels possibles | ne pas retirer sans inventaire opérationnel complet |
| `SELECT` | panel context, config sync, FixScores, admin/judge/display | doit rester disponible selon les politiques de lecture |

Les politiques Cloud historiques sont plus permissives et dupliquées (`public_*`, `accessible`, `write_policy`). P2.6.3F ne les modifie pas. `20260808160000_reconcile_heat_configs_acl.sql` n'est volontairement pas créé afin de séparer le rollback RPC du futur retrait ACL.

## Tests exécutés

### SQL isolé

Une base temporaire `p263f_runtime_test` a été créée depuis le schéma `public` local, testée puis supprimée. Aucune donnée de la base source n'a été modifiée.

`backend/supabase/tests/p2_6_3f_runtime_heat_config_rpc.sql` valide dans une transaction rollbackée :

- insert initial et update via RPC ;
- idempotence physique par `heat_id` ;
- refus d'un heat appartenant à un événement non accessible ;
- refus d'un `heat_id` vide ;
- simulation Cloud avec droits directs initiaux, puis `REVOKE INSERT, UPDATE` ;
- RPC toujours fonctionnelle après revoke ;
- `SELECT` toujours fonctionnel ;
- insert direct refusé ;
- `PUBLIC` sans `EXECUTE` ;
- `service_role` autorisé ;
- `bulk_upsert_heats_safe_v2` toujours fonctionnel.

Résultat : `P2.6.3F runtime heat config RPC: PASS`.

### Frontend

- typecheck `tsc --noEmit` : réussi ;
- tests ciblés : 12/12 réussis avant ajout du dernier garde statique ;
- suite complète : 66 fichiers réussis, 6 ignorés ; 369 tests réussis, 7 ignorés ;
- Competition X réel : 2/2 réussis, fichier inchangé et parsing offline ;
- build Vite/PWA : réussi, 48 entrées précachées ;
- audit réseau P1 : réussi, aucune violation ; routes `/admin`, `/chief-judge -> /admin`, `/judge`, `/priority`, `/display` en HTTP 200.

Les suites unitaires scoring, timer, architecture, queue coordinator, score WAL et override WAL sont incluses et vertes. Les tests d'intégration réelle Supabase marqués opt-in sont ignorés puisque la stack HTTP locale est arrêtée.

## Validation manquante et blocage

Restent nécessaires avant `RUNTIME_HEAT_CONFIG_RPC_READY` :

1. appliquer `150000` dans une stack Supabase locale isolée complète, jamais la base terrain ;
2. exécuter le vrai scénario navigateur offline IndexedDB puis replay HTTP ;
3. vérifier après refresh que admin, juge et display relisent une seule configuration ;
4. rejouer les intégrations réelles WAL score/override et planning Competition X sur cette stack ;
5. valider une reconstruction complète depuis toutes les migrations sur stack vierge.

## Impact release et rollback

- aucun commit de release ;
- aucun artefact de release ;
- aucun déploiement frontend ;
- aucune ACL Cloud modifiée ;
- rollback applicatif : restaurer l'appel direct historique tant que les ACL n'ont pas été révoquées ;
- rollback DB : supprimer uniquement la RPC `upsert_heat_config_runtime` si aucun frontend migré ne l'utilise ;
- la future révocation ACL restera dans une migration séparée après validation complète.
