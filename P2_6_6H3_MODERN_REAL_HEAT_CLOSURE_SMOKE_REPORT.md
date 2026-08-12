# P2.6.6H3 — Modern real heat closure smoke

Date : 2026-08-10  
Environnement : `https://test.surfjudging.cloud`  
Release candidate : `surfjudging-2026.08.09-p2.6.6-test-63ccc21`

## Conclusion

`REAL_MODERN_HEAT_CLOSE = PASS`  
`SCORING_REAL_SMOKE = PASS`  
`QR_PHYSICAL_SCAN = PASS`  
`TEST_RELEASE_LINKS_READY = TRUE`  
`DUAL_MODE_TEST_RELEASE_READY`

Le workflow moderne réel est validé jusqu'à la fermeture normale et au refresh. Le scan opérateur physique sur une vraie tablette ouvre `https://test.surfjudging.cloud/...` sans bascule vers la production.

## Protection des données

- L'événement historique `event_id = 28` n'a pas été modifié.
- Aucun participant historique n'a été inventé.
- Aucun score historique n'a été modifié.
- Une fixture Cloud isolée a été créée puis supprimée.
- Vérification finale des résidus : 0 événement H3, 0 juge H3 et 0 utilisateur Auth H3.

## Fixture moderne

- événement temporaire : `P2.6.6H3 REAL CLOSE TEST 1786350881175-f3afec` ;
- `event_id` temporaire : `79` ;
- heat canonique : `p2_6_6h3_real_close_test_1786350881175_f3afec_h3modern_r1_h1` ;
- division : `H3MODERN` ;
- round 1, heat 1, podium A ;
- deux participants canoniques ;
- lineup RED/WHITE avec `participant_id` non nul ;
- panel complet J1/J2/J3 avec trois juges temporaires réels ;
- génération par le workflow Safe v2 ;
- activation par le workflow Cloud-test autorisé.

## Parcours réel exécuté

1. Création de l'événement temporaire par l'UI TEST.
2. Activation Cloud-test par l'UI prévue à cet effet.
3. Création de deux participants et de trois juges temporaires.
4. Génération du heat moderne par `bulk_upsert_heats_safe_v2`.
5. Affectation du panel et activation du heat.
6. Démarrage du timer avec le bouton réel Admin.
7. Ouverture de trois contextes navigateur sur les vraies interfaces J1, J2 et J3.
8. Saisie des douze notes avec les boutons du pavé de notation.
9. Vérification de chaque persistance dans Supabase et refresh des tablettes.
10. Passage du timer à expiration, contrôle de readiness, puis fermeture normale par le bouton Admin, sans force.
11. Refresh Admin et nouvelle lecture des scores/statuts.
12. Suppression complète de la fixture.

## Scoring observé

| Lycra | Vague 1 | Vague 2 | Best 2 | Rang |
| --- | ---: | ---: | ---: | ---: |
| ROUGE | 7,20 | 8,20 | 15,40 | 1 |
| BLANC | 5,20 | 6,20 | 11,40 | 2 |

- 12 lignes physiques de score : 3 juges × 2 lycras × 2 vagues ;
- aucune duplication observée après les refreshs ;
- moyennes conformes aux notes J1/J2/J3 ;
- Best 2 et classement conformes.

## Readiness avant fermeture

Résultat réel de `fn_get_heat_close_readiness` :

- `can_close = true` ;
- `missing_lineup_count = 0` ;
- `missing_score_count = 0` ;
- `expected_judges = 3` ;
- `assigned_judges = 3` ;
- `orphan_score_count = 0` ;
- `invalid_score_count = 0` ;
- aucun blocker.

## Fermeture et refresh

Après fermeture normale :

- `heats.status = closed` ;
- `heats.is_active = false` ;
- `heat_realtime_config.status = closed` ;
- 12 scores toujours présents.

Après refresh :

- heat toujours fermé ;
- `is_active = false` ;
- 12 scores toujours présents ;
- route Admin toujours sur le déploiement TEST.

## Liens du déploiement TEST

Valeurs réellement affichées dans Admin pour la fixture :

- display : `https://test.surfjudging.cloud/display?eventId=79&podium=A` ;
- portail juges : `https://test.surfjudging.cloud/judge?eventId=79&podium=A` ;
- priorité : `https://test.surfjudging.cloud/priority?eventId=79&podium=A`.

Trois images QR `data:image/...` ont été générées dans l'interface. Les tests H1 vérifient déjà la valeur exacte transmise à l'encodeur pour display, judge et priority. Aucun lien de cette fixture n'a basculé vers `surfjudging.cloud`.

## Validation physique finale

- scan d'un QR avec une vraie tablette : PASS ;
- destination `https://test.surfjudging.cloud/...` : PASS ;
- aucune bascule vers `https://surfjudging.cloud/...` : PASS.

Release conservée : `surfjudging-2026.08.09-p2.6.6-test-63ccc21`.  
`CLOUD_PRODUCTION_PAYMENT_READY = FALSE` : Stripe reste ouvert et hors périmètre.

## Changements applicatifs

Aucun. Les ajustements effectués concernaient uniquement un script temporaire hors dépôt utilisé pour piloter Playwright. Aucune migration, règle de scoring, RLS ou donnée historique n'a été modifiée.
