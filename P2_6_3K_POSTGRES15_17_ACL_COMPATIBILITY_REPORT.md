# P2.6.3K — PostgreSQL 15/17 ACL Compatibility Reconciliation

Date : 2026-08-08

## Conclusion

`SCHEMA_RUNTIME_SYNC_READY`

La vraie base Cloud PostgreSQL 17 et la vraie base Mac Event Box `surfjudging_postgres` PostgreSQL 15 sont maintenant dans le même état ACL sémantique et exposent toutes deux le runtime applicatif `20260808180000_reconcile_heat_configs_acl_pg15_pg17`.

Aucun frontend n'a été reconstruit ou redéployé. Aucune donnée métier, règle de scoring, WAL, timer, route, synchronisation Cloud/HP ou intégration ESP32 n'a été modifiée.

## Cibles runtime réelles

| Propriété | Cloud runtime | Mac runtime | Divergence |
|---|---|---|---|
| cible | projet lié `xwaymumbkmwxqifihuvn` | conteneur `surfjudging_postgres` | attendue |
| PostgreSQL | `17.6.1.037` | `15.1` | version majeure différente |
| historique Supabase après P2.6.3K | `20260808180000` | `20260808140000` | mécanisme d'application différent |
| singleton runtime après P2.6.3K | `20260808180000_reconcile_heat_configs_acl_pg15_pg17` | identique | aucune |
| tracker terrain `_local_applied_migrations` | non applicable | absent sur cette installation historique | documentée |
| RLS `heat_configs` | actif | actif | aucune |

La stack CLI secondaire locale n'a jamais été utilisée comme preuve de l'état Event Box.

## État réel de 150000 et 160000 sur Mac

Les deux fichiers avaient été exécutés avec succès par `psql`, malgré l'absence de nouveaux stamps dans `supabase_migrations.schema_migrations`.

Effets vérifiés avant `180000` :

- `upsert_heat_config_runtime` présente;
- owner `postgres`;
- `SECURITY DEFINER = true`;
- `search_path=public`;
- EXECUTE `authenticated` et `service_role` présent;
- INSERT/UPDATE/DELETE absents pour `anon` et `authenticated`;
- SELECT conservé pour ces deux rôles;
- privilèges opérationnels `service_role` conservés;
- RLS actif.

L'EXECUTE explicite `anon` était encore présent avant `180000`. Cela correspond à l'effet historique de `CREATE OR REPLACE FUNCTION`, qui conserve une ACL explicite existante, et confirme que `170000` n'avait appliqué aucune révocation partielle.

## Rollback intégral de l'échec 170000

Sur Mac PG15, `170000` avait échoué dans sa transaction sur le token `MAINTAIN`. Les contrôles suivants ont confirmé l'absence d'effet partiel :

- EXECUTE RPC `anon` encore présent;
- état TRUNCATE/REFERENCES/TRIGGER inchangé par rapport au baseline post-160000;
- singleton runtime toujours à `140000`;
- aucun stamp `170000`.

## Compatibilité MAINTAIN

La documentation officielle PostgreSQL 17 indique que le privilège de table `MAINTAIN` a été introduit dans PostgreSQL 17 : <https://www.postgresql.org/docs/17/release-17.html>.

Règle de parité retenue :

- PG17 : `MAINTAIN` existe et doit être explicitement absent pour `anon/authenticated`;
- PG15 : `MAINTAIN` est structurellement inexistant et donc `N/A`, ce qui est sémantiquement équivalent à « non accordable/non présent »;
- aucune assertion PG15 ne transmet le token `MAINTAIN` à son parseur.

Le seuil exact utilisé est `server_version_num >= 170000`.

## Migrations

### 170000

Le fichier versionné `20260808170000_finalize_heat_configs_acl.sql` est rendu cross-version pour les futures reconstructions :

- révocation statique de TRUNCATE/REFERENCES/TRIGGER;
- révocation dynamique conditionnelle de MAINTAIN uniquement sur PG17+.

Cette modification du fichier source n'a pas été rejouée sur le Cloud, où `170000` était déjà enregistrée et fonctionnelle. Elle résout uniquement le bootstrap neuf PG15.

### 180000

Nouveau fichier additif : `20260808180000_reconcile_heat_configs_acl_pg15_pg17.sql`.

Il :

1. révoque TRUNCATE/REFERENCES/TRIGGER à `anon/authenticated`;
2. révoque MAINTAIN par SQL dynamique uniquement sur PG17+;
3. révoque EXECUTE de la RPC runtime à `anon`;
4. réaffirme SELECT pour `anon/authenticated`;
5. réaffirme EXECUTE pour `authenticated/service_role`;
6. met à jour le singleton runtime à `180000`;
7. ne touche à aucune table métier.

Deux applications successives ont réussi sur PG15 et PG17 : la migration est idempotente.

## Reconstructions isolées

| Test | PG15 | PG17 |
|---|---:|---:|
| image | `supabase/postgres:15.1.0.147` | `public.ecr.aws/supabase/postgres:17.6.1.037` |
| migrations complètes jusqu'à 180000 | PASS | PASS |
| 170000 cross-version | PASS | PASS |
| 180000 premier passage | PASS | PASS |
| 180000 second passage | PASS | PASS |
| assertions ACL version-aware | PASS | PASS |
| runtime final | 180000 | 180000 |

Chaque fichier a été appliqué avec `--single-transaction`, conformément au comportement requis par la migration historique `20251227120000_dedupe_events_unique_name.sql` et sa table temporaire `ON COMMIT DROP`. Un premier harness autocommit PG15 a reproduit l'échec historique documenté; le conteneur a été jeté et la reconstruction correcte a ensuite réussi.

Les deux conteneurs de test `sj-p263k-pg15` et `sj-p263k-pg17` ont été arrêtés et automatiquement supprimés.

## Matrice ACL sémantique finale

| Rôle / capacité | Cloud PG17 | Mac PG15 | Parité |
|---|---:|---:|---:|
| anon SELECT | oui | oui | oui |
| anon INSERT/UPDATE/DELETE | non | non | oui |
| anon TRUNCATE/REFERENCES/TRIGGER | non | non | oui |
| anon MAINTAIN | non | N/A | oui, sémantique |
| anon EXECUTE runtime RPC | non | non | oui |
| authenticated SELECT | oui | oui | oui |
| authenticated INSERT/UPDATE/DELETE | non | non | oui |
| authenticated TRUNCATE/REFERENCES/TRIGGER | non | non | oui |
| authenticated MAINTAIN | non | N/A | oui, sémantique |
| authenticated EXECUTE runtime RPC | oui | oui | oui |
| service_role table | ALL selon version | ALL selon version | oui, contractuelle |
| service_role EXECUTE runtime RPC | oui | oui | oui |
| RLS | actif | actif | oui |

Validation API LAN réelle :

- SELECT anon `heat_configs` : HTTP 200;
- RPC runtime anon : HTTP 401, `permission denied for function`;
- écriture directe authenticated : refusée;
- appel runtime RPC authenticated : réussi dans une transaction annulée;
- RPC `bulk_upsert_heats_safe_v2` : présente.

## Tracking des migrations

Trois mécanismes distincts ont été caractérisés :

1. `supabase_migrations.schema_migrations` est l'historique du runner Supabase. Cloud est à `180000`. Mac reste honnêtement à `140000`, car `150000`, `160000` et `180000` ont été exécutées manuellement par `psql`;
2. `app_runtime_schema_version` décrit le schéma applicatif effectivement déployé. Il est maintenant à `180000` sur Cloud et Mac;
3. `_local_applied_migrations` est le tracker du script terrain `hp-refresh-stack.sh`. Il n'existe pas encore dans cette installation historique Mac.

Aucune ligne n'a été insérée artificiellement dans `supabase_migrations.schema_migrations`.

Méthode propre proposée pour le prochain refresh terrain : laisser `hp-refresh-stack.sh` créer `_local_applied_migrations` puis utiliser son mécanisme existant `seed_tracking_if_runtime_is_current`. Celui-ci ne seed l'inventaire local que lorsque le singleton runtime correspond exactement à la dernière migration versionnée. Cet inventaire est un baseline opérationnel, pas une prétention d'exécution historique par le runner Supabase.

## Backups Mac

Backup pré-150000/160000 vérifié :

- `backups/p2_6_3j_mac_runtime_pre170000_20260808/postgres.dump`;
- SHA-256 `fb9f8edba2a317f9e59bd3e5690e2b125eb3bf5562614f89b4aebac834ab2ab2`;
- non vide;
- `pg_restore --list` : PASS.

Backup post-150000/160000 et pré-180000 créé :

- `backups/p2_6_3k_mac_post160000_pre180000_20260808/postgres.dump`;
- SHA-256 `824bec2eb7971979781866ba21ca1c00c4b3b5a52713ab9dd59932fbcefb09e7`;
- non vide;
- `pg_restore --list` : PASS.

Le warning `pg_dump` sur une contrainte circulaire historique a été conservé; le dump est complet au format custom, pas un dump data-only.

## Cloud et Mac après application

Cloud :

- dry-run : uniquement `180000` proposé;
- push : uniquement `180000` appliqué;
- historique Supabase : `180000`;
- singleton public : `180000`;
- dump de schéma : SELECT seulement pour anon/authenticated sur `heat_configs`, ALL pour service_role, aucun EXECUTE anon de la RPC runtime;
- RLS actif.

Mac :

- seule `180000` appliquée après backup;
- singleton : `180000`;
- matrice ACL et tests API conformes;
- historique Supabase laissé inchangé à `140000` pour ne pas falsifier le runner.

## Rollback

La migration est exclusivement ACL et singleton runtime. En cas de nécessité, restaurer le dump pré-180000 exact. Un rollback ACL manuel n'est pas recommandé, car il réouvrirait l'EXECUTE anon et des privilèges auxiliaires supprimés volontairement.

## Reprise

`SCHEMA_SYNC = TRUE` au sens runtime et ACL sémantique sur les deux bases réelles.

P2.6.3J peut reprendre uniquement aux validations terrain restantes : vraie tablette/PWA, événement temporaire Competition X, activation, scoring, timer, Realtime, perte/reprise Wi-Fi, ESP32 si disponible, backup final et cleanup.

Conclusion obligatoire : `SCHEMA_RUNTIME_SYNC_READY`.
