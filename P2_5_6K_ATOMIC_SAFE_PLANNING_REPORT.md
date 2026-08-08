# P2.5.6k — Atomic Safe Planning + Heat Configs

Date : 2026-08-08
Périmètre : persistance atomique du planning sûr et de `heat_configs`. P2.5.7 non commencé. H4 reste désactivé et déconnecté.

## Conclusion

**ATOMIC_SAFE_PLANNING_READY**

La création/remplacement du bracket et l'upsert de ses `heat_configs` sont désormais exécutés dans une transaction PostgreSQL unique. Une erreur de configuration provoquée après le bulk annule bien les heats, entries, mappings, realtime config et configs de la transaction. Le rôle terrain `authenticated` utilise uniquement le droit `EXECUTE` de la RPC ; aucun droit direct `INSERT/UPDATE` sur `heat_configs` n'a été ajouté.

Cette conclusion valide la frontière technique P2.5.6k. Elle n'autorise ni le branchement du bouton H4, ni P2.5.7, ni un déploiement frontend avant la migration DB.

## RPC avant/après

Avant :

```text
participants upsert client
→ bulk_upsert_heats_safe (transaction bracket)
→ COMMIT
→ heat_configs upsert client
→ succès ou état partiel
```

Après :

```text
participants upsert client
→ bulk_upsert_heats_safe_v2(
    event, category, overwrite,
    heats, entries, mappings, participants, heat_configs
  )
→ validation identité configs/heats
→ bulk_upsert_heats_safe v1 dans la transaction appelante
→ heat_configs upsert serveur
→ COMMIT unique ou ROLLBACK complet
```

La RPC v1 est conservée intacte pour rollback et compatibilité. Le nouveau frontend ne l'utilise pas et ne possède aucun fallback vers v1 ou `bulk_upsert_heats`.

Migration : `backend/supabase/migrations/20260808130000_atomic_safe_planning_heat_configs.sql`.

## Payload `heat_configs`

Inventaire du payload réellement produit historiquement par `createHeatsWithEntries` :

| Champ | Valeur/comportement conservé |
|---|---|
| `heat_id` | ID déterministe du heat généré |
| `judges` | `defaultJudges`, sinon `['J1','J2','J3']` |
| `surfers` | couleurs localisées dérivées du `color_order`, dans le même ordre |
| `judge_names` | objet JSON vide `{}` |
| `waves` | `15` |
| `tournament_type` | valeur historique normalisée, défaut `elimination` |

`judge_identities`, `surfer_names` et `surfer_countries` sont utilisés par d'autres chemins runtime, mais ne sont ni des colonnes de la table locale reconstruite ni des champs produits par le planning historique. P2.5.6k ne les invente donc pas et ne modifie pas leurs chemins légitimes.

La RPC v2 exige que la liste triée des `heat_id` de configs corresponde exactement à celle des heats proposés. Toute config supplémentaire, absente ou sans `heat_id` est refusée avant écriture.

## Sécurité et privilèges

État observé après migration locale :

- owner : `postgres` ;
- `SECURITY DEFINER = true` ;
- `search_path = public` explicite ;
- `EXECUTE` : `postgres`, `authenticated`, `service_role` ;
- `PUBLIC` révoqué ;
- `authenticated` conserve `INSERT=false`, `UPDATE=false` sur `heat_configs`.

La validation `event_id`, `category` et `is_active=false`, les verrous, le recalcul des blockers et la sélection des cibles restent assurés par la RPC sûre v1 appelée dans la même transaction. La v2 ajoute la validation exacte des identités heat/config. RLS n'est pas contournée par un grant table au client : seule la fonction durcie possède l'autorité serveur nécessaire.

## Frontend et repositories

Chemin moderne :

```text
createHeatsWithEntries
→ HeatPlanningRepository
→ PlanningSafetyRepository.persistSafePlanning
→ persistSafePlanningRpc
→ bulk_upsert_heats_safe_v2
```

Modifications limitées au planning sûr :

- `SafePlanningPersistenceRequest` transporte maintenant `heatConfigs` ;
- `createHeatsWithEntries` transmet le payload à la frontière sûre ;
- l'upsert client post-RPC de `heat_configs` est supprimé de ce chemin ;
- `saveConfiguration`, Admin, `configStore` et les autres écritures runtime ne sont pas modifiés ;
- `persistPlanningImportSafely` utilise indirectement la même frontière et n'est toujours importé par aucun composant H4.

Audit statique : aucun workflow moderne de planning n'appelle directement `bulk_upsert_heats`; l'unique appel applicatif de persistance planning est `bulk_upsert_heats_safe_v2`. Les exports legacy restent disponibles hors du nouveau chemin.

## Preuve d'atomicité

Test : `backend/supabase/tests/atomic_safe_planning_heat_configs.sql`, transaction temporaire suivie de `ROLLBACK`.

### Succès

- événement temporaire ;
- heat, entry, mapping, realtime config et heat config créés ;
- `is_active=false` ;
- payload judges/surfers/judge_names/waves/tournament_type vérifié.

### Échec config après bulk

Une config avec `judges=null` déclenche la contrainte `NOT NULL` lors de l'upsert situé après le bulk. Après interception de l'erreur :

- heats : 0 ;
- entries : 0 ;
- mappings : 0 ;
- realtime config : 0 ;
- heat configs : 0.

Le test démontre donc le rollback serveur de la transaction complète, et pas seulement une validation frontend préalable.

## Blockers P2.5.6i

La v2 réutilise la v1 sans réduire sa protection. Les tests SQL réels rejouent :

- score ;
- score override ;
- interférence ;
- affectation juge ;
- timer ;
- historique ;
- pointeur actif ;
- `is_active=true` ;
- statuts `running`, `paused`, `finished`, `closed`.

Chaque tentative retourne `HEAT_PLANNING_BLOCKED` et les données existantes restent intactes. Les tests antérieurs couvrant collisions propres, `overwrite`, activation lifecycle et statuts restent également verts.

## Participants : atomicité résiduelle acceptée

L'ordre historique reste :

```text
participants upsert client
→ résolution des IDs
→ RPC planning atomique
```

Une RPC ensuite refusée peut laisser des participants upsertés. Ce résidu ne supprime aucune donnée sportive, reste réversible et n'est pas masqué. L'intégration des participants à la transaction élargirait le périmètre et n'est pas réalisée ici.

## Competition X

Le fichier terrain inchangé a été utilisé en opt-in :

- parsing entièrement hors ligne ;
- 62 participants ;
- 7 catégories ;
- preview inchangée ;
- une catégorie réelle calculée puis persistée via `persistPlanningImportSafely` et la vraie RPC v2 ;
- tous les heats créés inactifs ;
- une config par heat ;
- événement et données temporaires nettoyés.

Le bouton H4 n'a jamais été branché pendant ce test.

## Tests et validations

- tests ciblés P2.5.6k : **30/30 passés** ;
- test SQL atomique réel : **passé**, rollback final ;
- test repository réel + Competition X : **2/2 passés** ;
- suite frontend complète : **354 passés, 6 opt-in ignorés** ;
- `tsc --noEmit` : passé ;
- types Supabase régénérés depuis la stack locale ;
- build Vite/PWA : passé, 2453 modules ;
- DB lint local niveau error : aucun résultat ;
- audit réseau P1 : passé, aucune violation ;
- routes : `/admin`, alias `/chief-judge`, `/judge`, `/priority`, `/display` validées ;
- contrôle nettoyage : aucun événement temporaire P2.5.6k.

L'avertissement de bind WebSocket Vitest dans le sandbox n'affecte pas les résultats. L'audit runtime P1 a été exécuté avec bind local autorisé.

## Matrice versions mixtes

| Frontend | DB | Résultat |
|---|---|---|
| nouveau P2.5.6k | ancienne sans v2 | **FAIL CLOSED** `PGRST202`, aucun fallback |
| ancien P2.5.6j | nouvelle avec v2 | continue d'appeler v1 puis l'upsert client ; sur la stack reconstruite sans grants, état partiel possible et config en erreur |
| nouveau P2.5.6k | nouvelle avec v2 | transaction atomique validée |

La coexistence ancien frontend/nouvelle DB ne doit pas être considérée sûre pour la persistance planning. Il faut éviter une fenêtre où un ancien bundle reste utilisé pour générer des heats.

## Ordre de déploiement

1. migrations de compatibilité statuts et safety déjà validées ;
2. migration `20260808130000_atomic_safe_planning_heat_configs.sql` ;
3. test SQL atomique réel sur une base HP isolée ;
4. déploiement du frontend P2.5.6k ;
5. invalidation/contrôle du cache PWA afin d'éviter un ancien bundle ;
6. smoke test HP avec événement temporaire sans données sportives ;
7. seulement dans une phase approuvée ultérieure : décision d'activation H4.

## Rollback

- La RPC v1 et `bulk_upsert_heats` restent inchangées.
- Le rollback DB peut supprimer uniquement la fonction v2 après retour préalable du frontend.
- Le rollback frontend vers P2.5.6j restaure le risque d'état partiel et ne doit pas servir de chemin opérateur normal.
- Aucun grant table, backfill ou changement de défaut `is_active` n'est à annuler.
- Aucun format persistant historique n'a changé.

## Risques ouverts

1. participants hors transaction serveur, résidu réversible documenté ;
2. ancien bundle PWA pouvant encore utiliser la frontière v1 pendant un déploiement mixte ;
3. smoke test sur le véritable HP et validation Realtime plage toujours ouverts ;
4. H4 reste preview-only et nécessite une validation explicite ultérieure avant branchement ;
5. P2.5.7 reste bloqué.
