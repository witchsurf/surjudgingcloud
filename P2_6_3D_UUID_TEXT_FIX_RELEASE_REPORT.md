# P2.6.3D — UUID/text compatibility fix and release

Date : 2026-08-08 (Africa/Dakar)

## Conclusion

**DB_COMPATIBILITY_BLOCKED**

Le correctif UUID/texte et la migration canonique `140000` sont validés. Les quatre migrations ont été appliquées avec succès sur le Cloud et la seule migration `140000` a été appliquée sur le Mac après backup.

La parité DB finale échoue cependant sur un critère impératif : le Cloud conserve des privilèges directs `INSERT/UPDATE` pour `authenticated` sur `public.heat_configs`, alors que le Mac ne les possède pas. Aucune correction de privilège non approuvée n'a été improvisée.

Conformément au lot : arrêt avant commit de release, avant construction de l'artefact final et avant tout déploiement frontend.

## A. Patch exact

Fichier modifié : `backend/supabase/migrations/20260808090000_planning_safety_preflight.sql`.

```diff
- where override_score.id = score_override.score_id
+ where override_score.id::text = score_override.score_id
```

Aucune autre règle de la migration `090000` n'a été modifiée.

## B. Migration de réconciliation

Fichier créé :

```text
backend/supabase/migrations/20260808140000_reconcile_planning_safety_uuid_text.sql
```

Elle :

- redéfinit `get_heat_planning_safety_inventory(bigint,text,text[],boolean)` ;
- conserve paramètres, retour, `STABLE`, `SECURITY DEFINER` et `search_path=public` ;
- conserve tous les blockers et les branches `heat_id` / score référencé ;
- utilise la comparaison canonique `override_score.id::text = score_override.score_id` ;
- réapplique le commentaire et le retrait des droits `PUBLIC` de l'inventory ;
- porte le stamp à `20260808140000_reconcile_planning_safety_uuid_text` ;
- ne modifie aucune donnée sportive.

`140000` est la référence canonique finale et ne doit jamais être supprimée.

## C. Tests SQL de compatibilité et planning

Tests réussis sur le Mac avant migration, avec rollback :

- `p2_6_3c_uuid_text_compatibility.sql` ;
- `planning_safety_preflight.sql` — P2.5.6i ;
- `safe_planning_persistence_readiness.sql` — P2.5.6j ;
- `atomic_safe_planning_heat_configs.sql` — P2.5.6k.

Couverture : UUID correspondant, UUID orphelin, texte non-UUID, override direct, override via score, scores, interférences, assignments, timer/history, active pointer, safe v1, safe v2, `heat_configs` atomique et blocage concurrent.

Les quatre mêmes tests ont réussi sur la base vierge après application des 107 migrations.

## D. Stack vierge

Un PostgreSQL Supabase 17.6 isolé a été créé sur un conteneur, un port et un volume dédiés. Le premier harness manuel utilisait l'autocommit et a fait échouer artificiellement la migration historique `20251227120000`, dont une table temporaire est `ON COMMIT DROP`. Le banc a été recréé et chaque fichier a ensuite été appliqué dans une transaction propre, reproduisant la sémantique du runner Supabase.

Résultat normatif :

- 107 migrations appliquées depuis zéro ;
- `090000` corrigée : PASS ;
- `110000` : PASS ;
- `130000` : PASS ;
- `140000` : PASS ;
- stamp : `20260808140000_reconcile_planning_safety_uuid_text` ;
- inventory, preflight, safe v1 et safe v2 présents ;
- signature v2 : `(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb)` ;
- `SECURITY DEFINER` et `search_path=public` vérifiés ;
- `open` accepté dans `heats_status_check` ;
- exécution `authenticated/service_role` vérifiée ;
- aucun privilège direct `INSERT/UPDATE` sur `heat_configs` pour `authenticated` dans la reconstruction ;
- tests SQL : PASS.

Le conteneur et le volume vierges ont été supprimés après validation. Les volumes de l'Event Box n'ont pas été touchés.

## E. Mac Event Box

### Backup préalable

```text
méthode     = pg_dump custom via supabase_admin
taille      = 480801 octets
SHA-256     = 1ded8a2c0ee83e8af2198ddae8c12c480630c552db90cbe79fc78277fa5e7d68
archive list= validée par pg_restore --list
emplacement = /private/tmp/surfjudging-mac-pre-p263d-20260808.dump
```

L'avertissement historique de contraintes circulaires Supabase reste présent. Le dump est non vide et lisible, mais aucune restauration complète n'est déclarée validée ; R15 reste ouvert.

### Migration

L'historique Mac confirmait `090000`, `110000` et `130000` déjà appliquées, avec uniquement `140000` absente. Le runner a appliqué exactement :

```text
20260808140000_reconcile_planning_safety_uuid_text.sql
```

Contrôles post-migration :

- stamp `140000` : PASS ;
- comparaison canonique présente : PASS ;
- quatre RPC présentes : PASS ;
- signatures : PASS ;
- status check incluant `open` : PASS ;
- exécution `authenticated/service_role` : PASS ;
- `authenticated` sans `INSERT/UPDATE` direct sur `heat_configs` : PASS.

Aucun ancien fichier août n'a été rejoué sur le Mac.

## F. Cloud

Backup préalable déclaré et vérifié par l'opérateur :

```text
CLOUD_BACKUP_METHOD = SUPABASE_CLI_LOGICAL_DUMP
CLOUD_BACKUP_VERIFIED = TRUE
```

Le dry-run final proposait exactement, dans cet ordre :

1. `20260808090000_planning_safety_preflight.sql` corrigée ;
2. `20260808110000_safe_planning_inactive_payload.sql` ;
3. `20260808130000_atomic_safe_planning_heat_configs.sql` ;
4. `20260808140000_reconcile_planning_safety_uuid_text.sql`.

Les quatre migrations ont réussi. Un avertissement non bloquant a suivi l'application : le cache local `pg-delta` de la CLI n'a pas trouvé son fichier CA temporaire. L'historique distant et le dump post-migration confirment néanmoins l'application des quatre versions.

Contrôles Cloud post-migration :

- quatre migrations enregistrées : PASS ;
- stamp `140000` : PASS ;
- inventory canonique avec cast texte : PASS ;
- preflight, safe v1 et safe v2 : présents ;
- signature v2 : correcte ;
- `SECURITY DEFINER` / `search_path=public` : corrects ;
- exécution `authenticated/service_role` : présente ;
- `heats_status_check` inclut temporairement `open` : PASS ;
- scores : 4 307 avant et après ;
- overrides : 17 avant et après ;
- aucun DML sportif dans les quatre migrations ; seul le singleton de version runtime est mis à jour par `140000`.

### Anomalie bloquante

Le dump Cloud post-migration contient :

```sql
GRANT ALL ON TABLE public.heat_configs TO authenticated;
```

Il accorde donc directement `INSERT` et `UPDATE`, contrairement au critère impératif et contrairement au Mac/rebuild vierge. La migration `130000` protège l'écriture atomique via RPC mais ne révoque pas les grants historiques explicites du Cloud.

Une migration additive dédiée devra au minimum retirer les privilèges directs d'écriture de `authenticated` sur `heat_configs`, avec caractérisation préalable des droits nécessaires à `anon` et `service_role`, tests RLS/RPC, migration Mac no-op compatible et nouveau stamp. Cette correction n'était pas autorisée dans P2.6.3D.

## G. Matrice de parité DB

| Élément | Cloud | Mac | Match |
|---|---|---|---:|
| Stamp | `20260808140000...` | `20260808140000...` | oui |
| Inventory canonique | cast `id::text` | cast `id::text` | oui |
| Preflight RPC | présente | présente | oui |
| Safe v1 | présente | présente | oui |
| Safe v2 | présente | présente | oui |
| Signature v2 | 8 paramètres attendus | identique | oui |
| `SECURITY DEFINER` / search path | conforme | conforme | oui |
| EXECUTE authenticated/service_role | oui | oui | oui |
| Status check avec `open` | oui | oui | oui |
| authenticated INSERT heat_configs | **oui** | non | **non** |
| authenticated UPDATE heat_configs | **oui** | non | **non** |

```text
SCHEMA_SYNC = FALSE
```

## H. Release et artefact

La création de release était conditionnée à la parité DB complète. Elle n'a donc pas été effectuée.

| Élément | État |
|---|---|
| Nouveau commit | NON |
| Nouveau SHA | NON ATTRIBUÉ |
| Nouveau RELEASE_ID | NON ATTRIBUÉ |
| Build final portant ce RELEASE_ID | NON |
| Archive unique Cloud/Mac | NON |
| Hashes artefact | NON CALCULÉS |
| Déploiement frontend Cloud | NON |
| Déploiement frontend Mac | NON |

Les tests frontend complets, WAL, Competition X, build/PWA, audit réseau et offline smoke seront rejoués sur le futur commit de release après correction et validation du blocker de privilèges. Aucun ancien RELEASE_ID n'a été réutilisé.

## I. Immutabilité et reprise

- Le fichier `090000` est corrigé après son application historique sur le Mac.
- Le Mac a reçu `140000` pour réconcilier son état final.
- Le Cloud a exécuté directement `090000` corrigée, puis `110000`, `130000`, `140000`.
- `140000` reste la référence canonique finale de la compatibilité UUID/texte.
- Aucune donnée métier n'a été convertie ou supprimée.

Pour reprendre : proposer et faire approuver un sous-lot SQL étroit consacré aux privilèges historiques de `heat_configs`. Ne pas relancer les quatre migrations, déjà appliquées. Ne pas créer ou déployer le frontend avant `SCHEMA_SYNC = TRUE`.

