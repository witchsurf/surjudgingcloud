# P2.6.6H2 — Heat Closure Lineup Resolution

Date du diagnostic : 2026-08-09  
Release TEST observée : `surfjudging-2026.08.09-p2.6.6-test-63ccc21`  
Environnement observé : `https://test.surfjudging.cloud` / Supabase Cloud  
Mode du diagnostic : **READ ONLY** sur le Cloud ; fixture locale isolée sous transaction suivie de `ROLLBACK`.

## Conclusion

`HEAT_CLOSURE_BLOCKED`

Le scoring du heat est cohérent et intact, mais les deux places réellement occupées du lineup n'ont aucune identité participant canonique. Ce ne sont pas des slots vides. La fermeture normale est donc correctement bloquée par le préflight actuel.

Le workflow moderne testé avec deux participants canoniques ne reproduit pas le défaut : il ferme normalement, sans force et sans perte de score. Le problème est une dette de données historiques propre à l'événement 28. Les résultats nécessaires pour reconstruire automatiquement les deux qualifiées ne sont pas présents dans les heats sources R2 ; une réparation automatique serait donc non fiable.

Aucune fermeture forcée, aucune réparation de donnée, aucune modification applicative, aucune migration et aucun rebuild n'ont été effectués.

## Heat exact

| Champ | Valeur observée |
|---|---|
| `heat.id` | `tonton_paul_trophy_ondine_u16_r3_h1` |
| `event_id` | `28` |
| compétition | `TONTON PAUL TROPHY` |
| division | `ONDINE U16` |
| round | `3` |
| heat number | `1` |
| `heat_size` | `2` |
| `status` | `waiting` |
| `is_active` | `true` |
| podium actif | `A` |
| pointeur A | ce heat |
| panel configuré | `J1`, `J2`, `J3` |
| panel assigné | 3/3 |
| couleurs | `RED`, `WHITE` |
| Realtime/timer observé | `paused`, timer terminé |

Le pointeur du podium B est indépendant et pointe vers `tonton_paul_trophy_ondine_u16_r1_h2`.

## Lineup canonique observé

| Slot | Lycra | Nom affichable | `participant_id` | Mapping | Résolu | Cause exacte |
|---:|---|---|---:|---|---|---|
| 1 | ROUGE / `RED` | `QUALIFIÉ R2-H1 (P1)` | `null` | source R2-H1, position 1 | non | entry présente et colorée, mais identité participant absente |
| 2 | BLANC / `WHITE` | `QUALIFIÉ R2-H2 (P2)` | `null` | source R2-H2, position 2 | non | entry présente et colorée, mais identité participant absente |

Détails physiques :

- `heat_entries.id=5159`, position 1, seed 1, color `RED`, `participant_id=null` ;
- `heat_entries.id=5160`, position 2, seed 2, color `WHITE`, `participant_id=null` ;
- `heat_slot_mappings.id=5935`, placeholder `QUALIFIÉ R2-H1 (P1)` ;
- `heat_slot_mappings.id=5936`, placeholder `QUALIFIÉ R2-H2 (P2)` ;
- `v_heat_lineup` renvoie bien deux lignes, mais `surfer_name=null` et `country=null` pour les deux ;
- `heat_configs.surfers = [ROUGE, BLANC]` et ne contient aucune identité participant.

Il n'existe aucun `surfer_id` distinct dans ces lignes. L'identité sportive utilisée par le scoring est le lycra ; l'identité humaine attendue pour le lineup est `heat_entries.participant_id`.

## Origine exacte du compteur « 2 places non résolues »

Le RPC `fn_get_heat_close_readiness` calcule actuellement :

```sql
greatest(
  heat_size - count(*) filter (where heat_entries.participant_id is not null),
  0
)
```

Pour ce heat : `2 - 0 = 2`.

Le blocker retourné réellement par le Cloud est :

```text
UNRESOLVED_LINEUP = 2
score_count = 12
missing_score_count = 0
expected_judges = 3
assigned_judges = 3
invalid_score_count = 0
orphan_score_count = 0
can_close = false
```

Chemin exact :

1. `AdminInterface.handleCloseHeat` appelle `fetchHeatCloseReadiness(heatId)` ;
2. `scoring.api` appelle le RPC `fn_get_heat_close_readiness` ;
3. le RPC lit `heats`, `heat_entries`, `heat_configs`, `heat_judge_assignments`, les vues de scores et les scores bruts ;
4. `participant_id=null` sur les deux entries produit `UNRESOLVED_LINEUP` ;
5. l'UI affiche le confirm de fermeture forcée ; l'opérateur l'a refusé.

Références :

- `frontend/src/components/AdminInterface.tsx`, `handleCloseHeat` ;
- `frontend/src/api/modules/scoring.api.ts`, `fetchHeatCloseReadiness` ;
- `backend/supabase/migrations/20260727200000_add_strict_heat_close_readiness.sql`, `fn_get_heat_close_readiness`.

## Comparaison avec le scoring

Le scoring ne recherche pas `participant_id` pour rattacher les faits sportifs. Les 12 lignes de score portent :

- `heat_id=tonton_paul_trophy_ondine_u16_r3_h1` ;
- `surfer=ROUGE` ou `surfer=BLANC` ;
- `wave_number=1` ou `2` ;
- `judge_station=J1`, `J2` ou `J3` ;
- une `judge_identity_id` correspondant à chaque affectation.

Résultat de la comparaison :

- 2 lycras × 2 vagues × 3 juges = 12 scores ;
- aucune note manquante ;
- aucun score orphelin par rapport aux couleurs des entries ;
- aucune note invalide ;
- l'identité couleur/lycra est cohérente ;
- l'identité participant nécessaire à la progression sportive est absente.

Les constats opérateur restent validés :

- `THREE_JUDGE_COMPLETE_WAVE = PASS`
- `AVERAGE_CALCULATION = PASS`
- `BEST2 = PASS`
- `LIVE_RANKING = PASS`

Les scores n'ont pas été modifiés et ne doivent pas servir à inventer les identités humaines.

## Événement historique et cause

Les participants et le bracket initial datent du 23 mai 2026. Les entries R1 possèdent encore des `participant_id` valides. En revanche :

- toutes les entries R2-H1 et R2-H2 sont des placeholders avec `participant_id=null` ;
- leurs mappings de qualification sont présents ;
- aucun score n'existe sur R2-H1 ou R2-H2 ;
- les entries R3-H1 héritent de ces placeholders non résolus ;
- la ligne du heat R3-H1 a été recréée/actualisée le 9 août, mais ses entries et mappings restent les données historiques du 23 mai.

Classification : **données historiques incomplètes**, propagées jusqu'au heat testé. Ce n'est ni un faux positif sur des slots vides, ni un bug global du nouveau planning. Le préflight révèle une absence réelle d'identité canonique.

## Slots vides

Le heat a une capacité de 2 et contient exactement 2 entries colorées avec 2 mappings qualificatifs. Il ne contient donc aucun slot réellement vide.

La règle souhaitée « un slot vide ne bloque pas ; un slot occupé doit être résolu » n'est pas mise en cause par ce cas. Une éventuelle amélioration future du RPC devra distinguer explicitement slot absent/vide et entry occupée, mais elle ne rendrait pas ce heat fermable : ses deux slots sont occupés par des placeholders qualificatifs non résolus.

## Effet de la fermeture forcée — non exécutée

Si l'opérateur validait la fermeture forcée avec un motif :

1. `close_heat_on_podium_strict` écrirait un audit `HEAT_CLOSE_FORCED` contenant le motif et le readiness complet ;
2. le heat passerait à `status=closed`, `is_active=false`, avec `closed_at` ;
3. `heat_realtime_config` passerait à `closed` et son timer serait arrêté ;
4. la propagation des qualifiés puis le rebuild de division seraient exécutés ;
5. un prochain heat serait activé uniquement si `p_next_heat_id` était fourni ;
6. le pointeur actif n'est pas supprimé automatiquement lorsque aucun prochain heat n'est fourni ;
7. les scores ne seraient pas supprimés.

Risque : la propagation/reconstruction travaillerait avec deux identités participantes non résolues. La fermeture forcée masquerait donc un vrai défaut de progression. Elle demeure interdite sans décision opérateur explicite.

## Fixture moderne isolée

Une fixture locale a été créée dans une transaction PostgreSQL puis intégralement annulée :

1. événement temporaire ;
2. deux participants canoniques ;
3. planning par `bulk_upsert_heats_safe_v2` ;
4. deux entries `RED/WHITE` avec `participant_id` ;
5. panel J1-J3 ;
6. activation par `activate_heat_on_podium` ;
7. timer démarré ;
8. 12 scores pour deux vagues complètes ;
9. readiness ;
10. fermeture non forcée par `close_heat_on_podium_strict` ;
11. vérification du statut et des scores ;
12. `ROLLBACK`.

Résultats :

- `can_close=true` ;
- `missing_lineup_count=0` ;
- `missing_score_count=0` ;
- panel 3/3 ;
- fermeture normale réussie ;
- statut `closed`, `is_active=false` dans la transaction ;
- 12 scores encore présents après fermeture ;
- 0 ligne temporaire persistante après `ROLLBACK` (`events=0`, `heats=0`, `scores=0`).

Cela distingue un défaut historique de l'événement 28 d'un défaut global du workflow moderne.

## Proposition de réparation historique — preview uniquement

La réparation minimale serait de renseigner **uniquement** `heat_entries.participant_id` pour les deux entries existantes, sans changer :

- `heat_id` ;
- position ;
- seed ;
- couleur/lycra ;
- mappings ;
- scores ;
- configuration ;
- statut ;
- pointeur actif.

Preview conceptuelle :

| Entry | Avant | Après requis |
|---|---|---|
| `5159` / ROUGE | `participant_id=null` | ID confirmé de la qualifiée R2-H1/P1 |
| `5160` / BLANC | `participant_id=null` | ID confirmé de la qualifiée R2-H2/P2 |

Cette preview ne peut pas encore contenir les IDs après : les deux heats R2 sources n'ont aucun score et leurs propres entries sont non résolues. Les participants R1 sont connus, mais les données ne permettent pas d'établir les résultats R2. Déduire les deux noms serait une invention sportive.

Prérequis avant toute réparation :

1. le chef juge fournit/valide explicitement les deux qualifiées historiques ;
2. produire une requête READ ONLY montrant les deux participantes candidates ;
3. produire le diff exact des deux lignes ;
4. sauvegarder les lignes avant mutation ;
5. appliquer uniquement après autorisation distincte ;
6. relancer le readiness et vérifier que les scores restent rattachés à ROUGE/BLANC.

## Impact release

- Aucun changement de code nécessaire pour expliquer ou corriger globalement ce cas.
- La release `63ccc21` est conservée ; aucun nouvel artefact ni hash.
- Le correctif H1 des URLs n'a pas été modifié.
- `TEST_RELEASE_LINKS_READY` ne peut pas encore être déclaré, car la fermeture normale du heat opérateur n'est pas prouvée.
- Le blocker restant est une décision/réparation explicite des deux identités historiques de l'événement 28.

