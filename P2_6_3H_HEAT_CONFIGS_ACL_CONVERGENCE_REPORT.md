# P2.6.3H — Heat Configs ACL Convergence

Date : 2026-08-08

## Conclusion

`DB_ACL_BLOCKED`

`SCHEMA_SYNC = FALSE`

Les migrations `150000` et `160000` sont appliquées sur le Cloud et le Mac Event Box, mais la convergence exacte n'est pas atteinte. Des grants historiques explicites subsistent uniquement sur le Cloud : `anon` et `authenticated` conservent `TRUNCATE`, `TRIGGER`, `REFERENCES` et `MAINTAIN` sur `public.heat_configs`; `anon` conserve aussi `EXECUTE` sur `upsert_heat_config_runtime`.

Aucune release frontend, aucun artefact final et aucun déploiement n'ont été créés.

## Baseline et migrations

| Cible | Baseline observée | Après P2.6.3H |
|---|---:|---:|
| Mac Event Box | `20260808140000`, puis `150000` appliquée après backup | `20260808160000` |
| Cloud | `20260808140000`, puis `150000` appliquée seule | `20260808160000` |
| Stack vierge isolée | reconstruction complète | `20260808160000` |

`20260808150000_runtime_heat_config_rpc.sql` a été vérifiée sur Cloud, Mac et stack vierge : owner `postgres`, `SECURITY DEFINER`, `search_path=public`, pas d'EXECUTE hérité de `PUBLIC`, EXECUTE pour `authenticated` et `service_role` dans une reconstruction vierge.

## Backups

| Backup | Taille | SHA-256 |
|---|---:|---|
| Mac avant `150000` | 712200 octets | `b1a950a5ddab9195902373855f862fa4223b20d839cb3deea9c93818b1e21e47` |
| Mac avant `160000` | 715739 octets | `b7c7863f8301f4714804cbe5cd4eda212f79df3f1194eb75ee4d23ddb7089b56` |

Le backup Cloud logique manuel `schema.sql`, `data.sql`, `roles.sql` et ses checksums avaient été validés avant ce lot. Une tentative de dump additionnel pré-`160000` a échoué avant création du fichier, car le chemin relatif a été résolu sous `backend/`; aucun faux backup n'est déclaré.

## Caractérisation des consommateurs

- Frontend produit : aucune suppression directe de `heat_configs` trouvée.
- Script administratif : `frontend/scripts/hp-photocopy-db.mjs` supprime des configurations locales avec un client `service_role` lors d'une photocopie contrôlée.
- SQL historique : `backend/sql/FIX_HEAT_ID_CANONICALIZATION_GLOBAL.sql` contient une réparation destructive explicite.
- Cascades : une suppression de heat peut supprimer sa configuration selon les FK existantes.
- Anon : aucune écriture produit légitime identifiée; les displays ont besoin de SELECT seulement.
- Authenticated : les écritures runtime passent désormais par `upsert_heat_config_runtime`; le planning passe par les RPC safe.
- Service role : utilisé par les workflows de copie/synchronisation/maintenance; `ALL` est donc conservé.

## Migration `160000`

La migration candidate :

- révoque `INSERT`, `UPDATE`, `DELETE` à `anon` et `authenticated`;
- préserve `SELECT` à `anon` et `authenticated`;
- accorde explicitement `ALL` à `service_role`;
- ne modifie aucune policy RLS;
- n'utilise pas `REVOKE ALL`.

Elle est suffisante sur une reconstruction vierge, mais pas sur le Cloud historique, où un ancien `GRANT ALL` avait également accordé des privilèges auxiliaires.

## Matrice ACL finale

### Mac et stack vierge

| Rôle | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | RPC EXECUTE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| anon | oui | non | non | non | non | non | non | non |
| authenticated | oui | non | non | non | non | non | non | oui |
| service_role | oui | oui | oui | oui | oui | oui | oui | oui |

### Cloud après `160000`

| Rôle | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN | RPC EXECUTE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| anon | oui | non | non | non | **oui** | **oui** | **oui** | **oui** | **oui** |
| authenticated | oui | non | non | non | **oui** | **oui** | **oui** | **oui** | oui |
| service_role | oui | oui | oui | oui | oui | oui | oui | oui | oui |

Les refus `INSERT/UPDATE/DELETE` visés par `160000` sont effectifs. La présence de `TRUNCATE` reste néanmoins une divergence de sécurité importante et interdit de déclarer la convergence.

## Policies RLS

Les policies historiques ont été inventoriées mais laissées intactes conformément à la priorité de sécurité du lot. Une policy permissive ne suffit pas à autoriser `INSERT/UPDATE/DELETE` sans ACL correspondante.

Le Cloud contient notamment plusieurs policies historiques publiques d'insert/update/upsert et deux policies orientées propriétaire d'événement. Le Mac reconstruit possède un autre ensemble historique, dont `authenticated_*`, `heat_configs_*_accessible` et `heat_configs_write_policy`. Cette divergence est documentée; elle n'a pas été nettoyée sans preuve supplémentaire. La lecture publique reste disponible.

## Tests

- Reconstruction Supabase vierge complète jusqu'à `160000` : PASS.
- Assertions SQL ACL/RPC : PASS après correction du test (`public`, et non rôle sensible à la casse `PUBLIC`).
- Runtime RPC insert/update, offline IndexedDB, refresh, replay, `/fix`, lectures Admin/Judge/Display, refus des écritures directes : PASS sur Chromium isolé.
- Realtime `heat_realtime_config` : PASS au second essai, environ 134 ms. Le premier essai a expiré à 10 s sans événement alors que le service était sain; aucun lien avec les ACL `heat_configs` n'a été observé.
- Planning safe v2 et persistance atomique : PASS.
- Competition X repository + UI : 3/3 PASS.
- WAL score et override réels : exercés sur la stack isolée; chemins de perte d'ACK/replay observés sans régression ACL.
- Suite Vitest : 370 PASS, 7 opt-in ignorés.
- Typecheck : PASS.
- Audit réseau P1 sur le build existant : PASS, 5 routes, aucune violation.
- Syntaxe `scripts/hp-refresh-stack.sh` : PASS.
- Smoke Chromium Mac : bloqué dans le helper avant mutation, car ce profil CLI ne fournit pas `JWT_SECRET`; assertions SQL Mac PASS.

La stack isolée et ses données temporaires ont été supprimées après test.

## Correctif minimal proposé, non implémenté

Créer un lot/migration séparé et monotone (ne pas réécrire `160000` déjà appliquée) qui exécute explicitement :

1. `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.heat_configs FROM anon, authenticated` (avec compatibilité de version PostgreSQL vérifiée pour `MAINTAIN`);
2. `REVOKE EXECUTE ON FUNCTION public.upsert_heat_config_runtime(text,text[],text[],jsonb,integer,text) FROM anon`;
3. assertions avant/après sur Cloud-like, stack vierge, Mac et Cloud;
4. aucune suppression de policy RLS dans ce correctif minimal.

Rollback ciblé possible par `GRANT` explicite, sans toucher aux données ni aux policies. Les droits `service_role ALL`, les lectures publiques et l'exécution authenticated/service_role de la RPC resteraient inchangés.

## Critère de reprise

La release ne peut être créée qu'après égalité Cloud/Mac des ACL pertinentes et de l'EXECUTE RPC, stamp identique, tests verts et `SCHEMA_SYNC = TRUE`.

Conclusion obligatoire : `DB_ACL_BLOCKED`.
