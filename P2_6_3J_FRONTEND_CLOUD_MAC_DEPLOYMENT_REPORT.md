# P2.6.3J — Frontend Cloud + Mac Synchronized Deployment

Date : 2026-08-08

## Conclusion

`FIELD_BLOCKED`

Les frontends Cloud et Mac servent exactement l'artefact immuable officiel et leur parité binaire est démontrée. La validation terrain ne peut toutefois pas être déclarée prête : la base réellement utilisée par la stack Mac Event Box était au stamp `20260808140000`, contrairement au stamp `20260808170000` annoncé par P2.6.3I. Après backup, les migrations déjà approuvées `150000` et `160000` ont réussi, mais `170000` a échoué avec `unrecognized privilege type "maintain"` sur PostgreSQL 15.1. L'exécution s'est arrêtée immédiatement et aucun contournement SQL n'a été appliqué.

## Release immuable

| Élément | Valeur |
|---|---|
| commit applicatif | `30705d1fc8153659654d676618f17567ba9b849e` |
| worktree détaché | `/private/tmp/surfjudging-release-30705d1` |
| RELEASE_ID | `surfjudging-2026.08.08-p2.6.3i-30705d1` |
| archive | `releases/surfjudging-2026.08.08-p2.6.3i-30705d1-frontend.tar.gz` |
| SHA-256 archive | `6b413eae3b68b88fc278be4a85a8772302d85a70fd6a7b39259e95b3edf74b85` |

Aucun rebuild frontend n'a été exécuté sur le VPS ou le Mac.

## Déploiement Cloud

Le workflow GitHub immuable a réussi dans le run `31280530961` : vérification de l'archive, transfert, extraction dans une release distincte, bascule atomique, contrôle HTTP et contrôle du RELEASE_ID.

Contrôles publics :

- `https://surfjudging.cloud/RELEASE_ID` : `surfjudging-2026.08.08-p2.6.3i-30705d1`;
- SHA-256 `index.html` : `06ad3ca87a07b591a272c781b6f9d2f1ff53d9bfe259357277aa199359074d57`;
- SHA-256 `sw.js` : `7f5130d604f73ceabcebd5f18b05ffb97df92d338b1682af1d14faa878d7b47f`;
- SHA-256 `xlsxParser-Djmyzu8_.js` : `37c65dbd0a7188dbf795a972f4f26562de727c5767447e6b539bd48896b38ab2`.

## Déploiement Mac Event Box

État avant : conteneur `surfjudging`, image `surfjudging-field:surfjudging-2026.08.08-p2.5.7-36dba46dcd63`, sans montage, port `8080`.

Backup frontend :

- dossier : `backups/p2_6_3j_mac_frontend_predeploy_20260808`;
- archive : `frontend-predeploy.tar.gz`;
- SHA-256 : `65556136aef0e538c45dcf334bffaf7e4246fd58553bd064ee0b51fc6827534d`.

Après bascule :

- nouveau conteneur `surfjudging`, même image Nginx, montage en lecture seule de `releases/mac-runtime/current/dist`;
- ancien conteneur conservé sous `surfjudging-rollback-p2_5_7-20260808`;
- `/RELEASE_ID` correspond à la release officielle;
- routes `/`, `/admin`, `/participants`, `/judge`, `/priority`, `/display`, `/chief-judge` : HTTP 200;
- hashes `index.html`, `sw.js` et chunk XLSX identiques au Cloud.

Rollback frontend immédiat disponible : arrêter/supprimer le nouveau conteneur, renommer `surfjudging-rollback-p2_5_7-20260808` en `surfjudging`, puis le redémarrer.

## Écart de schéma runtime Mac

La vérification a ciblé `surfjudging_postgres`, c'est-à-dire la base réellement exposée avec la stack LAN sur le port 8000, et non une autre stack CLI.

État découvert :

- PostgreSQL `15.1`;
- dernier stamp enregistré : `20260808140000`;
- RPC safe présentes : `bulk_upsert_heats_safe` et `bulk_upsert_heats_safe_v2`.

Backup avant intervention :

- fichier : `backups/p2_6_3j_mac_runtime_pre170000_20260808/postgres.dump`;
- SHA-256 : `fb9f8edba2a317f9e59bd3e5690e2b125eb3bf5562614f89b4aebac834ab2ab2`;
- dump PostgreSQL custom non vide, stocké hors volume Docker.

Application avec `ON_ERROR_STOP=1` :

| Migration | Résultat |
|---|---|
| `20260808150000_runtime_heat_config_rpc.sql` | succès |
| `20260808160000_reconcile_heat_configs_acl.sql` | succès |
| `20260808170000_finalize_heat_configs_acl.sql` | échec, transaction annulée |

Erreur exacte : `unrecognized privilege type "maintain"`. PostgreSQL 15 ne reconnaît pas le privilège de table `MAINTAIN`, introduit dans une version PostgreSQL ultérieure. Aucun SQL correctif n'a été improvisé. Comme les migrations `150000` et `160000` ne créent pas de ligne de stamp dans `supabase_migrations.schema_migrations`, le dernier stamp visible reste `140000` malgré leur application réussie.

## Parité et validations

| Condition | Résultat |
|---|---|
| `CODE_SYNC` | `TRUE` |
| hashes Cloud/Mac identiques | `TRUE` |
| `CLOUD_MAC_RELEASE_MATCH` | `TRUE` |
| `SCHEMA_SYNC` sur la base Mac runtime | `FALSE` |
| smoke routes Mac | `PASS` |
| PWA/cache sur vraie tablette | non exécuté après blocage SQL |
| événement temporaire/scoring/timer | non exécuté après blocage SQL |
| Realtime réseau plage | non exécuté |
| ESP32 | non testé, non bloquant pour le scoring |

## Suite requise

Caractériser puis approuver une migration de compatibilité PostgreSQL 15 qui révoque uniquement les privilèges reconnus tout en garantissant la même ACL finale que `170000`. Après application et vérification du stamp/ACL, reprendre P2.6.3J aux tests vraie tablette, scoring, timer, Realtime, backup final et cleanup.

Le risque R15 et les validations terrain déjà identifiées restent ouverts.

Conclusion obligatoire : `FIELD_BLOCKED`.
