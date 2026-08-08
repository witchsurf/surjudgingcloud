# P2.6.3C — Cloud schema compatibility: score override UUID/text

Date : 2026-08-08 (Africa/Dakar)

## Conclusion

**SQL_COMPATIBILITY_FIX_READY**

La cause, les données historiques et le rollback de la tentative ont été caractérisés sans mutation Cloud. La correction minimale compatible avec les deux schémas est :

```sql
override_score.id::text = score_override.score_id
```

Le cast inverse vers UUID est rejeté : le Cloud contient trois `score_id` historiques non-UUID. Aucun fichier de migration candidat n'a été modifié, aucune correction n'a été déployée et aucune migration Cloud n'a été relancée.

## A. Types réels

| Colonne | Cloud | Mac | Nullabilité | Divergence |
|---|---|---|---|---|
| `scores.id` | `uuid` | `text` | NOT NULL | **oui** |
| `score_overrides.id` | `uuid` | `uuid` | NOT NULL | non |
| `score_overrides.score_id` | `text` | `text` | NOT NULL | non |
| `score_overrides.heat_id` | `text` | `text` | NOT NULL | non |

### Contraintes et index pertinents

Cloud et Mac possèdent :

- une PK sur `scores.id` ;
- une PK sur `score_overrides.id` ;
- un index B-tree `idx_score_overrides_score_id` sur `score_overrides.score_id` ;
- un index B-tree `idx_score_overrides_heat_id` sur `(heat_id, created_at desc)` ;
- aucune FK entre `score_overrides.score_id` et `scores.id` ;
- un FK `scores.heat_id -> heats.id ON DELETE CASCADE`.

Le Cloud possède deux CHECK de plage de score ; le Mac en possède un. Cela est hors du problème UUID/texte et n'est pas modifié ici.

## B. Données historiques Cloud

Lecture agrégée uniquement ; aucun identifiant brut n'a été affiché ou conservé.

| Mesure | Résultat |
|---|---:|
| `score_overrides` total | 17 |
| `score_id IS NULL` | 0 |
| chaîne vide | 0 |
| UUID syntaxiquement valide | 14 |
| texte non-UUID | 3 |
| sans score correspondant | 1 |
| `heat_id IS NULL` | 0 |
| scores examinés après pagination complète | 4 307 |

La première lecture REST était plafonnée à 1 000 scores et donnait un nombre d'orphelins incomplet. Le résultat normatif ci-dessus provient d'une pagination complète.

Les 17 overrides sont directement rattachés à un `heat_id` non nul. L'orphelin reste donc détectable par la branche directe, conformément à la sécurité planning validée.

La stack Mac de test contient actuellement zéro override métier ; ses types ont néanmoins été testés avec des fixtures isolées.

## C. Cause historique

La migration initiale `20250916200111_misty_shore.sql` déclare `scores.id text`. La migration de bootstrap `20251104120000_init_judging.sql` fait de même, mais utilise `CREATE TABLE IF NOT EXISTS` : elle ne convertit donc pas une table Cloud préexistante.

La table Cloud historique avait déjà `scores.id uuid`; aucune migration versionnée du dépôt ne convertit cette colonne de texte vers UUID. Le bootstrap local a, lui, créé la table depuis les migrations et conserve `text`.

`score_overrides` a été introduite par `20250918120000_chief_judge_overrides.sql` avec :

- `id uuid` ;
- `score_id text` ;
- aucun FK vers `scores`.

Cette conception volontairement permissive explique la divergence Cloud : un lien historique textuel pointe vers une PK dont le type dépend de l'origine de la base. Les migrations locales de correction `20260523231000` et `20260727123000` avaient déjà reconnu cette différence en utilisant des casts explicites.

## D. Expressions incompatibles

### Package août

Une seule comparaison directe incompatible a été trouvée :

```sql
-- 20260808090000_planning_safety_preflight.sql
where override_score.id = score_override.score_id
```

`20260808110000_safe_planning_inactive_payload.sql` et `20260808130000_atomic_safe_planning_heat_configs.sql` ne refont pas ce join. Elles dépendent cependant respectivement de `bulk_upsert_heats_safe` puis de sa version v2 ; elles restent donc inapplicables tant que la première migration ne compile pas.

Le scan des autres relations utilisées par les trois RPC n'a pas trouvé d'autre comparaison UUID/texte susceptible de constituer l'échec suivant : les identités de heat, mappings, configs et pointeurs sont textuelles dans ces chemins.

### Précédents compatibles

Le dépôt contient déjà les formes explicites suivantes :

- `scores.id = p_score_id::text` pour le schéma Mac ;
- `scores.id::text = trim(p_score_id)` pour une compatibilité transverse ;
- `score_id::text` pour la corrélation d'audit.

## E. Comparaison des stratégies

### Option 1 — caster `scores.id` vers texte

```sql
override_score.id::text = score_override.score_id
```

Avantages :

- compile sur Cloud UUID et Mac texte ;
- n'échoue jamais sur les trois valeurs legacy non-UUID ;
- déterministe ;
- ne modifie aucune donnée ni colonne ;
- conserve les orphelins et la branche directe `heat_id` ;
- même résultat sur Mac, où `text::text` est neutre.

Limite : le cast de la PK UUID empêche probablement l'utilisation directe de son index B-tree pour cette comparaison. Le coût est acceptable ici : 17 overrides pour 4 307 scores, fonction de preflight opérateur et non boucle de scoring temps réel. Un index d'expression ne se justifie pas dans ce correctif minimal.

### Option 2 — caster `score_overrides.score_id` vers UUID

Forme naïve rejetée :

```sql
override_score.id = score_override.score_id::uuid
```

Elle lève une exception sur trois lignes Cloud actuelles. Une forme conditionnelle avec regex/CASE pourrait éviter l'exception et mieux exploiter la PK Cloud, mais elle ne serait pas statiquement compatible avec `scores.id text` sur Mac et complexifierait la règle sans bénéfice démontré.

### Stratégie retenue

**Option 1**, comparaison textuelle. Aucune conversion de colonne historique et aucun nouvel opérateur/cast global PostgreSQL.

## F. Reproduction Cloud-like et Mac-like

Test ajouté : `backend/supabase/tests/p2_6_3c_uuid_text_compatibility.sql`.

Il crée deux schémas isolés dans une base temporaire :

- Cloud-like : `scores.id uuid`, override `score_id text` ;
- Mac-like : `scores.id text`, override `score_id text`.

Fixtures couvertes :

1. UUID valide avec score correspondant ;
2. UUID valide orphelin ;
3. texte non-UUID ;
4. override détecté directement par `heat_id` ;
5. override détecté via le score référencé appartenant à un autre `heat_id` dans le log.

Le cas NULL est non applicable : le schéma réel impose `score_overrides.score_id NOT NULL` sur les deux cibles.

Résultats :

- expression originale sur Cloud-like : échec reproduit `operator does not exist: uuid = text` ;
- expression corrigée Cloud-like : PASS ;
- expression corrigée Mac-like : PASS ;
- détection directe : PASS ;
- détection via score : PASS ;
- orphelin et non-UUID détectés par leur `heat_id` : PASS ;
- transaction de test : ROLLBACK ;
- base temporaire : supprimée.

## G. Sémantique planning préservée

Le prédicat reste exactement :

```text
override.heat_id = heat ciblé
OU
score référencé par override.score_id appartient au heat ciblé
```

Seule la représentation comparée devient textuelle. Aucun blocker n'est supprimé ou assoupli. Un override historique orphelin continue de bloquer son heat via `score_overrides.heat_id`.

## H. Stratégie de versioning proposée

La situation est asymétrique :

- Cloud : `20260808090000` n'est pas appliquée ;
- Mac : `20260808090000`, `110000` et `130000` sont déjà appliquées.

Une nouvelle migration postérieure seule ne peut pas débloquer le Cloud, puisque le runner doit d'abord compiler `20260808090000`. Une migration préalable qui ajouterait un opérateur global `uuid = text` serait disproportionnée et risquée. Convertir la colonne historique est exclu par les données non-UUID.

Approche contrôlée recommandée :

1. corriger explicitement le fichier candidat `20260808090000` avec `override_score.id::text = score_override.score_id`, puisque ce fichier n'est pas appliqué sur le Cloud ;
2. ajouter une nouvelle migration de réconciliation, par exemple `20260808140000_reconcile_planning_safety_uuid_text.sql`, qui redéfinit `get_heat_planning_safety_inventory` avec la même expression canonique ;
3. tester une reconstruction Cloud-like : migrations corrigées `090000 -> 110000 -> 130000 -> 140000` ;
4. appliquer `140000` au Mac déjà migré, ce qui matérialise et trace la définition canonique sans modifier ses données ;
5. appliquer au Cloud le package corrigé complet, où `140000` rend l'état final identique au Mac ;
6. générer une nouvelle release, car le contenu versionné du package SQL change ;
7. ne reprendre le frontend qu'après parité DB Cloud/Mac prouvée.

Cette approche implique une modification **déclarée** d'un fichier déjà appliqué au Mac, compensée par une migration de réconciliation nouvelle. Elle ne doit être mise en œuvre qu'après approbation explicite du présent rapport.

## I. Rollback de la tentative Cloud vérifié

Les preuves après échec sont :

- aucune entrée `20260808090000` dans `supabase_migrations.schema_migrations` ;
- aucune fonction `get_heat_planning_safety_inventory` ;
- aucune fonction `check_heat_planning_safety` ;
- aucune fonction `bulk_upsert_heats_safe` ou `bulk_upsert_heats_safe_v2` ;
- aucune contrainte `heats_status_check` dans le dump Cloud post-échec ;
- schéma `heats.status` revenu à son état antérieur sans CHECK ;
- les seuls statements précédant l'échec étaient le remplacement de la contrainte dans le même `BEGIN`; leur absence confirme le rollback DDL ;
- aucun statement DML de données métier ne précédait l'échec ;
- les trois migrations restent toutes absentes de l'historique distant.

Le rollback n'est donc pas seulement supposé transactionnel : ses effets DDL attendus ont été contrôlés dans un dump post-échec, et le fichier n'avait exécuté aucune mutation de données avant l'erreur.

## J. Backup

```text
CLOUD_BACKUP_METHOD = SUPABASE_CLI_LOGICAL_DUMP
CLOUD_BACKUP_VERIFIED = TRUE
```

Le backup opérateur comprend `schema.sql`, `data.sql`, `roles.sql` et des checksums SHA-256 validés. L'absence de Dashboard Backup/PITR sur le plan Free n'est pas considérée comme un blocker supplémentaire. Aucune restauration n'a été tentée.

## K. Impact release et reprise

Une correction modifierait le package SQL versionné et impose donc :

- nouveau commit ;
- nouveau RELEASE_ID ;
- nouvel artefact frontend construit depuis ce commit, même si le code frontend ne change pas ;
- parité Cloud/Mac sur `20260808140000` ;
- mise à jour de la matrice `CODE_SYNC / SCHEMA_SYNC / CLOUD_MAC_RELEASE_MATCH`.

Procédure de reprise proposée après approbation :

1. appliquer localement le patch de comparaison et créer la migration de réconciliation ;
2. exécuter les tests SQL Cloud-like et Mac-like, plus les tests planning P2.5.6i/k/l ;
3. construire une stack vierge jusqu'au dernier schéma ;
4. créer la nouvelle release et revérifier les checksums ;
5. appliquer la réconciliation au Mac ;
6. appliquer explicitement les quatre migrations Cloud dans l'ordre, avec arrêt sur erreur ;
7. vérifier stamp, deux RPC safe, signature, grants, absence de droits directs sur `heat_configs` et compatibilité temporaire `open` ;
8. seulement alors reprendre l'alignement frontend.

