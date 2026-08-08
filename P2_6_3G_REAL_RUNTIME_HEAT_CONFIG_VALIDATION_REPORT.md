# P2.6.3G — Real Runtime Heat Config Offline Validation

Date : 2026-08-08

## Conclusion

`RUNTIME_HEAT_CONFIG_RPC_READY`

La RPC runtime, le repository, le replay offline legacy et le comportement après révocation simulée ont été validés sur une stack Supabase HTTP complète reconstruite depuis zéro et dans un vrai navigateur Chromium.

Les droits directs `INSERT/UPDATE` de `authenticated` sur `public.heat_configs` peuvent maintenant être révoqués. La migration ACL `20260808160000_reconcile_heat_configs_acl.sql` peut être préparée dans le lot suivant, séparément de la RPC. Aucune release finale n'est créée et aucune mutation Cloud n'a été effectuée.

## Stack isolée complète

Projet temporaire : `surfjudging_p263g3`.

- ports isolés `573xx`, distincts de la stack terrain `backend/543xx` ;
- volumes Docker portant exclusivement le suffixe `surfjudging_p263g3` ;
- PostgreSQL, Kong/API, PostgREST, Auth, Realtime et frontend Vite candidat actifs ;
- reconstruction vierge par la totalité des migrations du dépôt ;
- aucune utilisation ou réinitialisation du volume terrain.

Le premier essai sous `/private/tmp` a échoué avant migration : Docker Desktop transformait le bind mount du secret `pgsodium` en dossier. Le projet correspondant n'a jamais démarré et ses ressources isolées ont été supprimées. Le second essai depuis un chemin workspace partagé par Docker a réussi.

Stamp final vérifié :

| Version | Migration |
|---|---|
| `20260808150000` | `runtime_heat_config_rpc` |
| `20260808140000` | `reconcile_planning_safety_uuid_text` |
| `20260808130000` | `atomic_safe_planning_heat_configs` |

## Validation HTTP réelle

Le test `frontend/e2e/runtime-heat-config-offline.spec.ts` utilise Chromium, le frontend servi par Vite et le client Supabase réel configuré sur Kong/PostgREST local.

Résultats :

- insert initial via `HeatRepository.saveConfiguration` : réussi ;
- update de la même configuration : réussi ;
- refresh complet puis lecture HTTP : valeur attendue ;
- une seule ligne physique pour `heat_id` ;
- aucun appel SQL direct utilisé pour l'écriture métier de la configuration.

Le SQL du test est limité au seed temporaire, aux contrôles physiques, à la révocation isolée et au nettoyage.

## Scénario offline legacy réel

Chemin testé :

```text
/admin Chromium
→ HeatRepository.saveConfiguration
→ upsert_heat_config_runtime
→ commit serveur
→ ACK HTTP réellement perdu dans le navigateur
→ fallback BaseRepository
→ IndexedDB SurfJudging / legacy_queue
→ refresh Chromium avec mutation persistée
→ syncOffline
→ replayLegacyRuntimeHeatConfig
→ upsert_heat_config_runtime
```

Constats :

- l'entrée `heat_configs/upsert` reste dans le vrai IndexedDB après perte d'ACK ;
- structure historique inchangée : `payload.rows` snake_case et `options.onConflict=heat_id` ;
- refresh avant replay : entrée toujours présente ;
- retour HTTP puis replay normal : succès ;
- deuxième replay : sans effet supplémentaire ;
- queue supprimée seulement après succès ;
- une seule ligne physique finale.

## Compatibilité anciennes entrées

Une entrée legacy snake_case historique a été injectée directement dans `legacy_queue`, sans migration de schéma IndexedDB ni transformation du stockage.

Résultat : replay réussi via `upsert_heat_config_runtime`, queue vidée et valeur mise à jour sur l'unique ligne existante.

## Idempotence et retry

- retries réels après perte d'ACK : même cible `heat_id` ;
- plusieurs commits/replays : une ligne physique ;
- refresh navigateur avant replay : identique ;
- replay répété : identique ;
- valeur finale vérifiée : `waves=19` ;
- nombre final de lignes : `1`.

## Admin, Judge et Display

Après révocation simulée, les routes suivantes ont chacune subi une navigation et un refresh complets :

- `/admin` ;
- `/judge` ;
- `/display`.

Depuis chacune, la configuration a été relue via `SELECT` HTTP avec la valeur finale correcte. Aucun droit direct d'écriture table n'est requis pour ces lectures.

## Realtime

`heat_configs` ne figure pas dans la publication `supabase_realtime`. Ce n'est pas une régression de P2.6.3F : le workflow produit historique publie les changements de configuration dans `heat_realtime_config` via `publishConfigUpdate` / `upsertHeatRealtimeConfig`.

Le test à deux clients reproduit donc ce chemin réel :

1. client Display abonné à `heat_realtime_config` et état `SUBSCRIBED` confirmé ;
2. Admin enregistre la configuration via la nouvelle RPC ;
3. Admin publie le snapshot runtime via l'API historique ;
4. Display reçoit l'événement.

Propagation grossière observée : environ `135 ms`. Aucune optimisation n'a été introduite.

## Révocation simulée sur la stack isolée

Commande appliquée uniquement à `surfjudging_p263g3` :

```sql
REVOKE INSERT, UPDATE ON public.heat_configs FROM authenticated;
```

Après révocation :

| Scénario | Résultat |
|---|---|
| runtime `saveConfiguration` via RPC | PASS |
| perte réseau, queue IndexedDB et replay via RPC | PASS |
| frontière `/fix` via même adaptateur RPC | PASS |
| `bulk_upsert_heats_safe_v2` avec `service_role` | PASS |
| lectures Admin/Judge/Display | PASS |
| `INSERT` direct authenticated | REFUS HTTP 403 |
| `UPDATE` direct authenticated | REFUS HTTP 403 |

`FixScores` n'a pas exécuté ses actions terrain codées en dur. Le test a ouvert `/fix` puis exercé exactement son nouvel adaptateur `upsertRuntimeHeatConfig` sur le heat temporaire.

## WAL et planning réels

Exécutés sur la même stack isolée après la révocation simulée :

- score WAL réel : PASS ;
- override WAL réel : PASS ;
- double coordinator, refresh, pertes d'ACK et LWW : PASS ;
- planning safe preflight/v2 : PASS ;
- atomic safe persistence : PASS ;
- Competition X réel : PASS ;
- UI de persistance Competition X : PASS.

Résultat groupé : `4 fichiers`, `5 tests`, tous réussis.

## Reconstruction vierge et propriétés RPC

| Propriété | Valeur vérifiée |
|---|---|
| fonction | `upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text)` |
| owner | `postgres` |
| SECURITY DEFINER | oui |
| search_path | `{search_path=public}` |
| PUBLIC EXECUTE | non |
| authenticated EXECUTE | oui |
| service_role EXECUTE | oui |
| safe v2 | présente et fonctionnelle |

La reconstruction complète depuis zéro jusqu'à `150000` est réussie.

## Matrice ACL candidate pour le lot suivant

Cette matrice concerne les ACL de table proposées, pas les policies RLS.

| Principal | SELECT | INSERT | UPDATE | DELETE | Proposition |
|---|---:|---:|---:|---:|---|
| `authenticated` | oui | non | non | non | lectures directes, écritures uniquement par RPC |
| `anon` | oui | non | non | non | affichages publics en lecture seule |
| `service_role` | oui | oui | oui | oui | conserver temporairement la compatibilité des opérations backend jusqu'à inventaire séparé |

Policies RLS proposées séparément :

- conserver les policies de lecture publique nécessaires aux displays ;
- supprimer/consolider les policies historiques `INSERT/UPDATE` devenues sans effet après retrait des ACL, mais seulement dans `160000` avec assertions ;
- ne pas confondre une policy permissive avec un privilège de table : les deux couches doivent autoriser une écriture directe ;
- caractériser encore les consommateurs opérationnels `service_role` et `DELETE` avant convergence de ces droits.

État ACL observé sur la stack Mac-like isolée après revoke :

| Principal | SELECT | INSERT | UPDATE | DELETE |
|---|---:|---:|---:|---:|
| `anon` | oui | non | non | non |
| `authenticated` | oui | non | non | non |
| `service_role` | non | non | non | non |

Cette dernière ligne explique pourquoi la matrice cible Cloud doit être décidée explicitement : `service_role` contourne RLS mais a tout de même besoin d'ACL de table pour les accès directs. La RPC safe v2 fonctionne indépendamment grâce à `SECURITY DEFINER`.

## Validation globale

- Chromium réel P2.6.3G : `1/1` réussi ;
- intégrations réelles : `5/5` réussies ;
- suite Vitest standard : `370` réussis, `7` opt-in ignorés ;
- typecheck : réussi ;
- build Vite/PWA : réussi, `48` entrées précachées ;
- audit réseau P1 : réussi, aucune violation ;
- routes `/admin`, `/chief-judge -> /admin`, `/judge`, `/priority`, `/display` : HTTP 200 ;
- syntaxe `scripts/hp-refresh-stack.sh` : valide.

## Nettoyage et impact release

- données de test supprimées après chaque scénario ;
- stack et volumes isolés arrêtés/supprimés sans backup après validation ;
- aucun volume terrain modifié ;
- aucune mutation Cloud ;
- aucune migration `160000` créée ;
- aucun commit de release ;
- aucun artefact final ;
- aucun déploiement frontend.
