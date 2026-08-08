# P2.6.3E — Heat configs privilege reconciliation

Date : 2026-08-08 (Africa/Dakar)

## Conclusion

**DB_PRIVILEGE_BLOCKED**

La révocation candidate ne peut pas être appliquée sans casser un workflow runtime encore actif : `HeatRepository.saveConfiguration` fait un `upsert` direct sur `public.heat_configs`, et la file offline rejoue ce même upsert. Le test transactionnel confirme que ce chemin reçoit `insufficient_privilege` après `REVOKE INSERT, UPDATE`, alors que le planning moderne safe v2 continue de fonctionner.

L'inventaire a en outre révélé des divergences ACL plus larges que le blocker initial : le Cloud accorde aussi `DELETE` à `authenticated` et `ALL` à `anon` et `service_role`, alors que le Mac ne le fait pas. Ces privilèges et les policies historiques ne peuvent pas être retirés arbitrairement dans ce lot.

Conséquences :

- aucune migration `20260808150000` créée ;
- aucune mutation Cloud ou Mac ;
- `SCHEMA_SYNC = FALSE` ;
- aucun commit/release/artefact ;
- aucun frontend déployé.

## A. ACL avant

Les résultats ci-dessous décrivent les privilèges de table, avant évaluation RLS.

### Cloud

Le dump post-`140000` contient `GRANT ALL ON TABLE public.heat_configs` pour `anon`, `authenticated` et `service_role`. `postgres` est propriétaire.

| Principal | SELECT | INSERT | UPDATE | DELETE |
|---|---:|---:|---:|---:|
| `anon` | oui | oui | oui | oui |
| `authenticated` | oui | oui | oui | oui |
| `service_role` | oui | oui | oui | oui |
| `postgres` / owner | oui | oui | oui | oui |

### Mac

| Principal | SELECT | INSERT | UPDATE | DELETE |
|---|---:|---:|---:|---:|
| `anon` | oui | non | non | non |
| `authenticated` | oui | non | non | non |
| `service_role` | non direct | non direct | non direct | non direct |
| `postgres` / owner | oui | oui | oui | oui |

`service_role` peut appeler les RPC `SECURITY DEFINER`; l'absence de privilège direct de table sur le Mac ne bloque donc pas safe v2.

### Matrice combinée

| Principal / privilège | Cloud | Mac | Match |
|---|---:|---:|---:|
| anon SELECT | oui | oui | oui |
| anon INSERT | oui | non | **non** |
| anon UPDATE | oui | non | **non** |
| anon DELETE | oui | non | **non** |
| authenticated SELECT | oui | oui | oui |
| authenticated INSERT | oui | non | **non** |
| authenticated UPDATE | oui | non | **non** |
| authenticated DELETE | oui | non | **non** |
| service_role SELECT/WRITE direct | oui | non | **non** |
| owner | tous | tous | oui |

La consigne initiale identifiait INSERT/UPDATE authenticated comme seul blocker. La lecture exhaustive obligatoire montre que ce n'est pas la seule divergence brute d'ACL.

## B. RLS et policies

RLS est activé sur `heat_configs` sur les deux cibles ; `FORCE ROW LEVEL SECURITY` est désactivé. Le propriétaire est `postgres`.

### Cloud

Le schéma Cloud cumule plusieurs générations de policies, notamment :

- `Users can manage heat configs for their events` ;
- `Users can view heat configs for accessible events` ;
- `heat_configs_insert_accessible` pour `authenticated` ;
- `heat_configs_update_accessible` pour `authenticated` ;
- `heat_configs_public_insert` avec `WITH CHECK true` ;
- `heat_configs_public_update` avec `USING true` ;
- `heat_configs_upsert_public` avec `USING/WITH CHECK true` ;
- `heat_configs_public_read` et `heat_configs_read_public` ;
- `service_delete` pour `service_role`.

Les policies permissives ne suffisent pas sans privilège SQL, mais deviennent effectives lorsque `GRANT ALL` est présent. Le couple ACL + policies rend donc les écritures directes possibles sur le Cloud.

### Mac

Le Mac possède notamment :

- `authenticated_insert`, `authenticated_update`, `authenticated_delete`, `authenticated_read` ;
- `heat_configs_insert_accessible`, `heat_configs_update_accessible` ;
- `heat_configs_write_policy` ;
- `heat_configs_read_public` et `heat_configs_select_policy`.

Les droits directs de table retirés empêchent actuellement les écritures directes malgré ces policies. Les ensembles de policies Cloud et Mac ne sont pas identiques ; les aligner dépasse une simple révocation INSERT/UPDATE et exige une caractérisation dédiée.

## C. Fonctions d'écriture

La fonction canonique identifiée qui écrit dans `heat_configs` est :

```text
bulk_upsert_heats_safe_v2(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb)
```

Elle est `SECURITY DEFINER`, propriétaire `postgres`, `search_path=public`, et reste exécutable par `authenticated` et `service_role`. Elle n'a donc pas besoin d'accorder INSERT/UPDATE directs à l'appelant.

Aucune autre RPC `SECURITY DEFINER` dédiée à l'upsert runtime d'une configuration existante n'a été trouvée.

## D. Consommateurs produit

| Usage | Classification | Accès |
|---|---|---|
| `panelContext.api.ts` | lecture canonique panel | SELECT batch |
| `useSupabaseSync.loadHeatConfig` | lecture runtime | SELECT |
| `HeatRepository.saveHeatConfig/saveConfiguration` | **écriture runtime légitime active** | upsert direct |
| `configStore`, `AdminPage`, `useHeatManager`, `useSupabaseSync` | consommateurs du runtime précédent | délégation vers upsert direct |
| `lib/supabase.ts::replayOfflineEntry` | **fallback/replay offline actif** | upsert direct générique |
| `PlanningSafetyRepository/planningSafety.api` | planning moderne | RPC safe v2 |
| `FixScores.tsx` | legacy/réparation ciblée | SELECT puis UPDATE direct |
| `hp-field-mutation-test.mjs` | test opérateur | INSERT SQL direct avec rôle DB |
| migrations de backfill/reporting | migration/lecture historique | SQL versionné |

### Chemin runtime encore dépendant

```text
Admin/configStore/hooks
  -> HeatRepository.saveConfiguration
  -> supabase.from('heat_configs').upsert(...)
```

En offline :

```text
saveConfiguration
  -> entrée legacy { table: 'heat_configs', action: 'upsert' }
  -> replayOfflineEntry
  -> supabase.from(entry.table).upsert(...)
```

Ce chemin ne passe ni par safe v2 ni par une autre fonction `SECURITY DEFINER`.

## E. Droits minimaux : décision

L'objectif futur reste :

- SELECT public/authenticated pour admin, juges et display ;
- planning initial uniquement via safe v2 ;
- configuration runtime via une RPC dédiée et étroite ;
- aucun INSERT/UPDATE direct authenticated une fois tous les consommateurs migrés ;
- service_role/owner selon les besoins administratifs explicitement testés.

Cet objectif n'est pas atteignable par la seule migration candidate demandée. Retirer maintenant INSERT/UPDATE du Cloud rendrait son comportement identique au Mac au niveau ACL, mais casserait précisément le runtime Cloud qui dépend encore des droits directs.

Le fait que le Mac survive actuellement sans ces grants ne prouve pas la sécurité de la révocation Cloud : le mode local, les rôles/clefs utilisés et les policies `is_local_database()` suivent un chemin différent. La preuve pertinente est le test sous rôle `authenticated`, qui échoue.

## F. Test Cloud-like de révocation

Test ajouté :

```text
backend/supabase/tests/p2_6_3e_heat_configs_privilege_characterization.sql
```

Le test est transactionnel et termine par `ROLLBACK`. Il :

1. crée un événement et des heats temporaires ;
2. reproduit `GRANT ALL` Cloud pour `authenticated/service_role` ;
3. valide une écriture directe authenticated avant révocation ;
4. applique la révocation candidate INSERT/UPDATE ;
5. valide SELECT authenticated ;
6. valide le refus INSERT direct ;
7. valide le refus UPDATE direct ;
8. valide safe v2 sous `authenticated` ;
9. valide la conservation de service_role ;
10. reproduit l'upsert du repository/offline et vérifie son refus.

Résultat :

```text
P2.6.3E heat_configs privilege characterization:
EXPECTED RUNTIME BLOCKER CONFIRMED
```

La RLS et les policies existantes sont actives pendant le test. Aucune fixture ne persiste.

## G. Migration additive 150000

**Non créée.** La condition préalable « les INSERT/UPDATE directs ne sont plus nécessaires » est fausse.

La migration minimale envisagée :

```sql
revoke insert, update
on table public.heat_configs
from authenticated;
```

est idempotente sur le Mac mais fonctionnellement dangereuse sur le Cloud actuel. Elle ne réglerait pas non plus les divergences DELETE, anon, service_role et policies.

## H. Cloud et Mac

Aucune mutation P2.6.3E n'a été effectuée :

- aucun nouveau backup requis après l'arrêt au diagnostic ;
- stamp Cloud : reste `20260808140000_reconcile_planning_safety_uuid_text` ;
- stamp Mac : reste identique ;
- aucune migration inattendue appliquée ;
- aucune donnée métier modifiée.

## I. Parité

| Élément | Cloud | Mac | Match |
|---|---|---|---:|
| Stamp | `140000` | `140000` | oui |
| Inventory UUID/text | canonique | canonique | oui |
| Safe v1/v2 | présents | présents | oui |
| Grants RPC | exécutables | exécutables | oui |
| `heats.status` avec `open` | oui | oui | oui |
| heat_configs SELECT authenticated | oui | oui | oui |
| heat_configs INSERT authenticated | oui | non | **non** |
| heat_configs UPDATE authenticated | oui | non | **non** |
| heat_configs DELETE authenticated | oui | non | **non** |
| heat_configs ACL anon | ALL | SELECT | **non** |
| heat_configs ACL service_role | ALL | aucun direct | **non** |
| RLS activé | oui | oui | oui |
| Policies exactes | historiques Cloud | historiques Mac | **non** |

```text
SCHEMA_SYNC = FALSE
```

## J. Reprise nécessaire

Un futur lot doit être approuvé avant toute révocation :

1. créer une RPC `SECURITY DEFINER` étroite pour l'upsert runtime de `heat_configs`, avec ownership/event/RLS métier équivalents ;
2. migrer `HeatRepository.saveConfiguration` vers cette RPC ;
3. adapter le replay offline `heat_configs` sans changer structure, ordre ni stockage de la file ;
4. remplacer ou retirer le write direct de `FixScores` ;
5. caractériser DELETE ainsi que les ACL/policies `anon` et `service_role` ;
6. tester Cloud, Mac, offline replay, admin/judge/display et safe v2 ;
7. seulement ensuite créer une migration additive de révocation et de convergence ACL/policies ;
8. reprendre la création de release lorsque `SCHEMA_SYNC = TRUE`.

## K. Release

La condition de création n'est pas remplie.

| Élément | État |
|---|---|
| Migration 150000 | NON |
| Nouveau commit | NON |
| Nouveau SHA | NON ATTRIBUÉ |
| RELEASE_ID | NON ATTRIBUÉ |
| Suite frontend complète | NON REJOUÉE après blocker |
| Artefact unique | NON CONSTRUIT |
| Frontend déployé | NON |

