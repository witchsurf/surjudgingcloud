# P2.5.6i — Planning Safety Preflight + Status Compatibility

## Conclusions obligatoires

- **STATUS_COMPATIBLE_TEMPORARILY**
- **PLANNING_PREFLIGHT_SAFE**

La compatibilité `open` est restaurée sans retirer aucun statut. Le remplacement sécurisé dispose désormais d'un inventaire serveur déterministe et d'une RPC d'écriture qui revalide les blockers dans la même transaction avant tout delete.

H4 appelle uniquement le preflight en lecture et affiche `SAFE`, `BLOCKED` ou `UNKNOWN`. Son bouton de création reste désactivé. P2.5.7 reste bloqué.

## Migration de compatibilité des statuts

Migration : `backend/supabase/migrations/20260808090000_planning_safety_preflight.sql`.

CHECK avant :

```text
waiting, running, paused, finished, closed
```

CHECK temporaire après :

```text
waiting, open, running, paused, finished, closed
```

Aucun statut existant n'est supprimé, aucun backfill n'est exécuté et aucun producteur frontend, timer ou flux Realtime n'est modifié.

Tests PostgreSQL réels : les six valeurs sont acceptées, `invalid` est rejeté, `bulk_upsert_heats` accepte réellement un payload `status=open`, et `activate_heat_on_podium` transforme un heat `waiting` en `open` sans violation du CHECK.

### Rollback du CHECK

Le rollback documenté, à exécuter seulement après canonisation de toutes les lignes `open`, est :

```sql
alter table public.heats drop constraint if exists heats_status_check;
alter table public.heats
  add constraint heats_status_check
  check (status in ('waiting', 'running', 'paused', 'finished', 'closed'));
```

Sans backfill préalable, cette recréation échouera volontairement si des lignes `open` existent ; aucune donnée ne sera convertie silencieusement.

## RPC de preflight

RPC publique de lecture :

```text
check_heat_planning_safety(
  p_event_id bigint,
  p_category text,
  p_proposed_heat_ids text[],
  p_overwrite boolean
)
```

Elle délègue à la fonction SQL interne unique `get_heat_planning_safety_inventory`. Pour chaque heat ciblé, elle retourne :

- `heat_id`, `status`, `is_active` ;
- `score_count`, `override_count`, `interference_count` ;
- `judge_assignment_count`, `timer_count`, `history_count` ;
- `active_pointer_count` ;
- `blocker_reasons[]`.

Le résultat est trié par `heat_id`, donc déterministe.

## Ciblage exact overwrite

La même fonction SQL définit les cibles du preflight et de l'écriture sûre :

- `overwrite=true` : tous les heats dont `event_id=p_event_id` et `division=p_category` ;
- `overwrite=false` : seulement les collisions de ce couple avec `p_proposed_heat_ids`.

Le test réel confirme :

- ID proposé sans collision : zéro cible, donc SAFE ;
- ID proposé en collision : exactement un heat ciblé ;
- overwrite global : les six heats de la catégorie fixture sont inventoriés ;
- événement/catégorie vide : zéro cible, donc SAFE.

La comparaison de catégorie reste volontairement exacte, comme le `.eq('division', category)` historique ; aucune nouvelle normalisation métier n'est inventée.

## Règles de blocage

Un heat est BLOCKED si au moins une condition est vraie :

| Condition | Raison retournée |
|---|---|
| scores présents | `scores` |
| override présent | `score_overrides` |
| interférence présente | `interferences` |
| assignation juge présente | `judge_assignments` |
| timer présent | `timers` |
| historique présent | `history` |
| `is_active=true` | `is_active` |
| pointeur actif vers le heat | `active_pointer` |
| statut running/paused/finished/closed | `status:<statut>` |

`waiting` et `open` ne sont donc SAFE que sans aucune donnée sportive, sans assignation, sans timer/historique, sans pointeur et avec `is_active=false`. Le statut seul ne peut jamais rendre un heat sûr.

## `score_overrides` sans FK

Aucune FK n'est ajoutée. L'inventaire recherche explicitement :

- `score_overrides.heat_id = heat.id` ;
- ou `score_overrides.score_id` référençant un score du heat.

Chaque override est compté une seule fois même si les deux conditions correspondent. La dette de modèle reste ouverte : la table peut toujours contenir des références orphelines créées par d'anciens chemins.

## Garantie atomique

Nouvelle RPC :

```text
bulk_upsert_heats_safe(
  p_event_id,
  p_category,
  p_overwrite,
  p_heats,
  p_entries,
  p_mappings,
  p_participants
)
```

Dans une seule transaction, elle :

1. valide que chaque heat du payload appartient exactement à l'événement et à la catégorie annoncés ;
2. dérive les IDs proposés depuis `p_heats` ;
3. prend un verrou advisory par événement/catégorie ;
4. verrouille les lignes heat exactement ciblées avec `FOR UPDATE` ;
5. verrouille les tables de blockers en `SHARE ROW EXCLUSIVE`, y compris `score_overrides` sans FK ;
6. recalcule les cibles et blockers avec la même fonction d'inventaire ;
7. lève `HEAT_PLANNING_BLOCKED` avec l'inventaire JSON en détail si un blocker existe ;
8. appelle seulement alors la RPC historique `bulk_upsert_heats` avec les IDs exacts calculés.

Cette séquence empêche un insert concurrent de score, override, interférence, assignment, timer, historique ou pointeur de se glisser entre la vérification atomique et la suppression. Aucun nouveau retry ou fallback n'est ajouté.

Le test TOCTOU réel exécute : preflight SAFE, ajout d'un score, appel de la RPC sûre avec le même heat. Résultat : exception `HEAT_PLANNING_BLOCKED`, heat toujours présent, score toujours présent.

## Repository

Contrat dédié `PlanningSafetyRepositoryContract` :

- `preflight(request)` ;
- `persistSafePlanning(request)`.

L'implémentation `PlanningSafetyRepository` délègue à l'adaptateur Supabase dédié `planningSafety.api.ts`. Elle ne dépend pas du moteur scoring et n'est pas mélangée au CRUD runtime de `HeatRepository`.

`persistSafePlanning` existe comme frontière testée mais n'est appelé par aucun écran. `HeatPlanningRepository` et la façade legacy restent inchangés dans ce lot.

## H4 SAFE / BLOCKED / UNKNOWN

Après génération du bracket en mémoire, `PlanningImportPanel` appelle uniquement :

```text
planningSafetyRepository.preflight(... overwrite=true)
```

Le choix `overwrite=true` correspond au remplacement complet actuellement envisagé par ce parcours expérimental. Aucune écriture n'est déclenchée.

États affichés :

- `SAFE` : aucun blocker ;
- `BLOCKED` : inventaire par heat avec statut, scores, overrides, interférences, juges, timers, historique, activité/pointeur et raisons ;
- `UNKNOWN` : événement absent/invalide ou erreur réseau/RPC ; jamais converti en SAFE.

Le bouton base reste désactivé avec le texte H4 existant. Les tests architecturaux interdisent toujours Supabase direct, `.from`, `.rpc`, repositories participants/planning, localStorage, IndexedDB, `upsertMany`, `createWithEntries` et `persistSafePlanning` dans le panneau.

## Test Supabase local isolé

Script : `backend/supabase/tests/planning_safety_preflight.sql`.

Le test est exécuté dans une transaction puis `ROLLBACK` :

1. création d'un événement temporaire ;
2. matrice des statuts ;
3. panel et activation `waiting -> open` ;
4. vrai `bulk_upsert_heats` avec `open` ;
5. preflight SAFE du heat open explicitement inactif ;
6. ajout d'un score ;
7. preflight BLOCKED ;
8. tentative `bulk_upsert_heats_safe` rejetée ;
9. vérification que heat et score existent toujours ;
10. inventaire groupé de tous les blockers, dont override sans FK ;
11. ciblage overwrite false/true ;
12. rollback intégral.

Résultat de la dernière exécution : `P2.5.6i SQL integration passed for temporary event 24`, puis `ROLLBACK`. Vérification post-test : zéro événement ou fixture P2.5.6i restant.

La migration a été appliquée uniquement à la stack locale isolée. Aucune compétition existante n'a été modifiée.

## Tests et validations

- tests ciblés repository/API/UI/architecture : 26 réussis ;
- suite frontend complète avec le vrai `Competition X.xlsx` : **350 réussis, 3 opt-in ignorés** ;
- typecheck `tsc --noEmit` : réussi ;
- build Vite/PWA : réussi, 2 453 modules ;
- chunk XLSX toujours séparé : 99,89 kB brut / 35,66 kB gzip ;
- PWA : 47 entrées, 3 161,84 KiB ;
- `supabase db lint --local --level error` : aucune erreur ;
- migration locale appliquée avec succès ;
- intégration SQL transactionnelle : réussie ;
- audit réseau P1 : réussi, aucune violation sur `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display`.

## Fichiers

Créés :

- `backend/supabase/migrations/20260808090000_planning_safety_preflight.sql` ;
- `backend/supabase/tests/planning_safety_preflight.sql` ;
- `frontend/src/repositories/contracts/planningSafety.ts` ;
- `frontend/src/api/modules/planningSafety.api.ts` ;
- `frontend/src/repositories/PlanningSafetyRepository.ts` ;
- tests API/repository associés ;
- `P2_5_6I_PLANNING_SAFETY_PREFLIGHT_REPORT.md`.

Modifiés :

- exports contracts/repositories et `RepositoryRegistry` ;
- `PlanningImportPanel` pour le preflight lecture ;
- `ParticipantsPage` pour transmettre l'event ID de la route ;
- tests H4/architecture.

## Rollback fonctionnel

Frontend : retirer l'appel et le rendu preflight de `PlanningImportPanel`, puis retirer `PlanningSafetyRepository` de ses exports. H4 redevient sa preview locale pure ; aucune donnée n'est à restaurer.

SQL :

1. révoquer puis supprimer `bulk_upsert_heats_safe` ;
2. révoquer puis supprimer `check_heat_planning_safety` ;
3. supprimer `get_heat_planning_safety_inventory` ;
4. seulement après traitement explicite des lignes `open`, recréer l'ancien CHECK sans `open`.

La RPC historique `bulk_upsert_heats` n'a pas été remplacée ou modifiée, ce qui rend le rollback immédiat possible.

## Risques ouverts

1. `open` est une compatibilité temporaire, pas le statut canonique final ; aucun backfill n'est réalisé.
2. `score_overrides` reste sans FK.
3. Le défaut historique de `heats.is_active` est encore `true`. Le preflight le bloque conservativement ; le test SAFE crée explicitement un heat inactif. Modifier ce défaut ou le payload du planning nécessite une décision séparée.
4. Les anciens consommateurs peuvent encore appeler directement `bulk_upsert_heats`; la persistance H4 reste donc désactivée jusqu'à migration explicite du chemin autorisé vers la RPC sûre.
5. Les verrous de l'écriture sûre sont volontairement forts et globaux sur les tables de blockers pendant une transaction planning ; le coût de contention devra être observé avant usage Cloud/terrain.
6. La migration n'a été appliquée qu'à Supabase local ; le déploiement Cloud/HP reste une opération contrôlée distincte.

**STATUS_COMPATIBLE_TEMPORARILY — PLANNING_PREFLIGHT_SAFE**

La sécurité serveur nécessaire existe et est testée, mais elle n'autorise pas encore la persistance H4 et ne débloque pas P2.5.7.
