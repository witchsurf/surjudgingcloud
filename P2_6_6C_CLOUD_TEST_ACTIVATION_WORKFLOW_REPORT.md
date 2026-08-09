# P2.6.6C — Cloud Test Activation Workflow

Date : 2026-08-09

## Conclusion

**DUAL_MODE_TEST_RELEASE_BLOCKED**

- `FIELD_READY = TRUE`
- `CLOUD_TEST_READY = TRUE`
- `CLOUD_PRODUCTION_PAYMENT_READY = FALSE`

Le workflow Cloud-test complet est validé, sans falsifier un paiement. Une release de test n'est cependant pas encore qualifiée : la vérification read-only des 13 événements existants avec la vraie session opérateur n'a pas pu être exécutée dans cet environnement. Aucun déploiement ni commit de release n'a été produit.

## Architecture retenue

`DeploymentMode` reste strictement `cloud | field`. L'activation test est une capacité Cloud indépendante :

- `app_deployment_config.cloud_test_activation_enabled` : interrupteur DB, désactivé par défaut ;
- `app_cloud_test_activators` : allowlist explicite d'utilisateurs ;
- `events.test_activated_at` et `events.test_activated_by` : piste distincte du paiement ;
- `get_event_test_activation_capability(eventId)` : visibilité serveur du bouton ;
- `activate_event_for_test(eventId)` : RPC étroite propriétaire + allowlist ;
- `configure_cloud_test_activation(...)` : administration réservée exclusivement à `service_role`.

Le navigateur ne peut modifier ni l'interrupteur, ni l'allowlist, ni directement `events.paid`.

## Paiement réel et activation test

Une activation test conserve :

- `paid=false` ;
- `status='pending'` ;
- `method=null` ;
- aucune ligne Stripe artificielle ;
- aucun `paid_at` ou `payment_ref` inventé.

Le domaine central expose `eventCanRunCompetition` :

- Cloud réel : paiement validé ;
- Cloud test : `test_activated_at` et `test_activated_by` présents ;
- Field : événement local persisté.

Les gardes Participants et GenerateHeats consomment ce même état. Aucun `paid || devMode` n'a été ajouté et `VITE_DEV_MODE` n'intervient pas.

## Sécurité RPC

Refus vérifiés :

- mode Field ;
- appel anonyme ;
- capacité globalement désactivée ;
- utilisateur absent de l'allowlist ;
- utilisateur non propriétaire ;
- événement absent ;
- événement déjà payé ;
- événement déjà activé pour test.

L'autorisation propriétaire repose sur `events.user_id`, disponible dans les reconstructions historiques PG15/PG17. Aucun rôle admin implicite n'a été inventé.

## Migrations additives

- `20260808193000_cloud_test_event_activation.sql`
- `20260808194000_cloud_test_activator_allowlist.sql`
- `20260808195000_manage_cloud_test_activation.sql`
- `20260808196000_cloud_test_activation_pg15_compat.sql`

Elles ont été appliquées au Cloud dans cet ordre. La dernière migration remplace l'accès à `auth.jwt()` par les claims PostgREST standards afin de rester compatible avec l'image PG15 exacte.

Après l'E2E Cloud, `cloud_test_activation_enabled` a été remis à `false` par la RPC `service_role`, l'utilisateur temporaire a été retiré de l'allowlist puis supprimé.

## UI Cloud

La route officielle `/payment` affiche :

- les moyens de paiement existants ;
- `Activer pour test — aucun paiement réel` uniquement si la RPC de capacité renvoie `true`.

Après activation, l'UI relit obligatoirement l'événement depuis la DB. La navigation vers `/participants` n'a lieu que lorsque les deux colonnes d'audit sont confirmées.

Le même contrat a été appliqué à la page de paiement moderne non montée afin d'éviter une divergence future entre les deux routes historiques.

## E2E Cloud réel

Test : `frontend/e2e/p2-6-6c-cloud-test-activation.spec.ts`.

Résultat final : **PASS (21,2 s)**.

Parcours validé :

1. création d'un utilisateur Cloud temporaire ;
2. allowlist par `service_role` ;
3. login réel ;
4. création par `create_event_secure` ;
5. `paid=false` ;
6. bouton test visible pour cet utilisateur uniquement ;
7. activation RPC ;
8. relecture DB ;
9. piste test présente, état de paiement inchangé ;
10. accès `/participants` ;
11. import du vrai `Competition X.xlsx` ;
12. 62 participants, 7 catégories ;
13. preview et preflight `SAFE` pour les 7 catégories ;
14. safe v2 et persistance des heats pour les 7 catégories ;
15. vérification DB des 62 participants et de heats persistés ;
16. `/admin` ;
17. refresh ;
18. création d'un second événement ni payé ni activé ;
19. garde opérateur visible et bouton de génération des heats désactivé ;
20. cleanup strict de toutes les fixtures.

Le test final fait échouer le scénario si une suppression de paiement, heat, participant, événement, allowlist ou utilisateur retourne une erreur.

## Field

Le Field n'a reçu aucune règle de paiement ou d'activation test :

- création locale immédiate ;
- aucune route paiement fonctionnelle ;
- aucune activation Cloud-test visible ;
- audit réseau Field : PASS, zéro requête publique ;
- routes `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display` : HTTP 200.

Le Field E2E déjà validé reste vert.

## PostgreSQL

### PG15 exact

Image : `supabase/postgres:15.1.0.147`.

Reconstruction complète finale incluant les migrations 193000 à 196000 et le test Cloud-test :

`PG15 authoritative deployment mode reconstruction: PASS (version=150001, mode=field)`

Le harness simule les deux formes de claims requises par les générations PostgREST : `request.jwt.claims` et le GUC historique `request.jwt.claim.sub`.

### PG17

Reconstruction Supabase locale complète, migration et test SQL : PASS.

## Tests et builds

- test SQL `p2_6_6c_cloud_test_activation.sql` : PASS ;
- tests frontend ciblés activation/domain : 27 PASS ;
- typecheck : PASS ;
- Vitest complet final : 397 PASS, 7 opt-in skipped ;
- build Cloud final : PASS ;
- build Field final : PASS ;
- audit réseau Field final : PASS ;
- `git diff --check` : PASS ;
- PG15 exact final : PASS ;
- E2E Cloud-test final : PASS.

Scoring, WAL, timer, lifecycle heat, planning safe, Cloud↔HP, ESP32 et routes P1 n'ont pas été modifiés.

## Événements existants

La session opérateur réelle permettant de vérifier read-only les 13 événements n'était pas disponible dans l'environnement automatisé.

Les tests avec utilisateurs temporaires prouvent l'isolation propriétaire du nouveau mécanisme, mais ne remplacent pas la vérification demandée de ces 13 événements :

- événements `user_id` visibles ;
- événements `owner_id`-only visibles ;
- aucun événement étranger exposé.

Aucun des 13 événements n'a été modifié.

## Stripe reste ouvert

`CLOUD_PRODUCTION_PAYMENT_READY = FALSE`.

Anomalies conservées :

1. 50 000 XOF transmis, 5 000 000 F CFA affichés par Checkout ;
2. `stripe-webhook` avec `verify_jwt=true` ;
3. callback non confirmé ;
4. `events.paid` jamais passé à `true` par le workflow réel.

L'activation test ne masque ni ne corrige ces anomalies. Un sous-lot Stripe séparé reste nécessaire.

## Critère restant avant release de test

Le seul critère de qualification non démontré dans ce lot est `EVENTS_VISIBILITY = PASS` avec la vraie session opérateur. Tant qu'il reste ouvert, la conclusion demeure `DUAL_MODE_TEST_RELEASE_BLOCKED`.

Aucun déploiement automatique n'est autorisé avant revue explicite.
