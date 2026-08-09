# P2.6.6D — Operator Events Visibility + Test Release Freeze

Date : 2026-08-09

## Conclusion

**DUAL_MODE_TEST_RELEASE_BLOCKED**

- `EVENTS_VISIBILITY = NOT_EXECUTED`
- `FIELD_READY = TRUE`
- `CLOUD_TEST_READY = TRUE`
- `CLOUD_PRODUCTION_PAYMENT_READY = FALSE`

Le contrôle des 13 événements n'a pas pu être exécuté avec la vraie session Cloud de l'opérateur. Conformément à la décision opérateur, le freeze release a été stoppé avant commit, RELEASE_ID, artefacts ou hashes.

Une tentative de capture manuelle a ensuite démontré que l'identité affichée par le Cloud déployé n'est pas une session Supabase opérateur exploitable : le frontend terrain affiche `Mode Développement Actif`, présente l'adresse opérateur, mais ne contient aucun état d'authentification Supabase Cloud.

## Tentative de session manuelle

Le navigateur Playwright visible a ouvert `https://surfjudging.cloud/my-events` et affiché :

- `Bienvenue, rplaraise@gmail.com` ;
- `Mes événements` ;
- zéro événement ;
- la bannière `Mode Développement Actif`.

Le storageState a ensuite été inspecté uniquement au niveau des noms de clés, sans afficher aucune valeur. Résultat :

- aucun cookie d'authentification ;
- aucune clé `surfjudging-cloud-auth-token` ;
- aucune clé Supabase `auth-token` ;
- uniquement deux clés locales techniques sans session utilisateur.

La validation en contexte neuf a donc refusé cet état avec `OPERATOR_SESSION_USER_NOT_FOUND`. L'adresse affichée provient du mode développement/offline du frontend actuellement déployé, pas d'une vraie session Supabase réutilisable.

Conséquence : la liste vide observée ne constitue pas encore une preuve RLS/PostgREST sur les 13 événements. Le contrôle a été stoppé avant toute requête d'ownership.

## Recherche de la session opérateur

Recherche read-only effectuée uniquement dans les emplacements projet légitimes :

- fichiers d'état Playwright (`storageState`, auth state) ;
- configuration E2E du dépôt ;
- variables d'environnement nommées pour une session ou des identifiants opérateur ;
- rapports et fichiers du dépôt référençant l'adresse opérateur connue ;
- états de test locaux déjà produits.

Résultat :

- aucun `storageState` opérateur ;
- aucun jeton opérateur réutilisable ;
- aucun couple d'identifiants opérateur configuré ;
- aucune session navigateur automatisable disponible.

La tentative manuelle confirme en plus que le frontend Cloud actuellement servi empêche l'accès à l'écran magic-link attendu en activant son comportement développement.

Les seules capacités Cloud automatisées disponibles utilisent `service_role` ou des utilisateurs temporaires. Elles ont été explicitement exclues par la spécification et n'ont pas été utilisées comme substitut.

Aucun secret, jeton ou mot de passe n'a été affiché ou extrait.

## Contrôle des 13 événements

Non exécuté faute de session opérateur réelle :

- comparaison ownership DB / repository / PostgREST / UI : non exécutée ;
- événements `user_id` visibles : non prouvé ;
- événements `owner_id` visibles : non prouvé ;
- événement `owner_id`-only visible : non prouvé ;
- absence d'événement étranger : non prouvée ;
- refresh navigateur : non exécuté ;
- fermeture/réouverture de session : non exécutée ;
- retour My Events sans cache : non exécuté.

Le contrôle n'a pas été remplacé par une requête `service_role`, car celle-ci contournerait les règles RLS précisément visées par cette validation.

## Non-mutation

Pendant P2.6.6D :

- aucun événement existant modifié ;
- aucun participant modifié ;
- aucun heat modifié ;
- aucun score modifié ;
- aucun paiement modifié ;
- aucune migration appliquée ;
- aucun code applicatif modifié.

Seul ce rapport de blocage a été ajouté.

## État du freeze

Le HEAD courant avant freeze est :

`42371c906a590eadedf43fb8e9091b2868cafa67`

Branche :

`agent/multi-podium-readiness`

Ce SHA n'est **pas** un commit release P2.6.6D. Le worktree contient encore les changements approuvés des lots précédents et n'est pas un arbre release propre.

- commit final P2.6.6D : **NON CRÉÉ** ;
- RELEASE_ID : **NON CRÉÉ** ;
- Cloud TEST artifact : **NON CRÉÉ** ;
- Field TEST artifact : **NON CRÉÉ** ;
- hash Cloud : **NON CALCULÉ** ;
- hash Field : **NON CALCULÉ** ;
- manifests release : **NON CRÉÉS**.

Les dossiers de build de travail existants ne sont pas reconnus comme artefacts de release P2.6.6D.

## État technique hérité de P2.6.6C

Les validations approuvées restent valables :

- Field E2E : PASS ;
- Cloud create : PASS ;
- Cloud test activation : PASS ;
- Cloud post-activation Competition X 62 participants / 7 catégories : PASS ;
- Cloud non-paid block : PASS ;
- PG15 exact : PASS ;
- PG17 : PASS ;
- suite complète : 397 PASS, 7 tests opt-in skipped ;
- builds de travail Cloud et Field : PASS ;
- audit réseau Field : PASS.

Elles ne suffisent pas à qualifier une release de test sans `EVENTS_VISIBILITY = PASS`.

## Stripe production

`CLOUD_PRODUCTION_PAYMENT_READY = FALSE` reste inchangé.

Anomalies ouvertes :

- 50 000 XOF transmis, 5 000 000 F CFA affichés ;
- `stripe-webhook` avec `verify_jwt=true` ;
- callback non confirmé ;
- `events.paid` jamais passé à `true` par Stripe réel.

P2.6.6D n'a apporté aucune correction Stripe.

## Action nécessaire pour débloquer

Il faut d'abord rendre accessible un frontend Cloud qui n'active pas le mode développement, afin que la vraie frontière Supabase affiche l'écran magic-link. Le code de build Cloud déjà validé force `VITE_DEV_MODE=false`, mais ce comportement n'est manifestement pas celui du frontend actuellement servi sur `surfjudging.cloud`.

Aucun déploiement correctif n'a été tenté dans P2.6.6D. Une décision opérateur distincte est requise pour rendre disponible le frontend Cloud TEST correct ou un environnement de validation équivalent pointant vers le même Supabase Cloud.

Une fois cet écran disponible, l'opérateur pourra établir une vraie session Cloud dans un contexte contrôlable par le test, par exemple un `storageState` Playwright temporaire produit après le login magic-link. Ce fichier devra rester hors Git et ne devra pas exposer ses jetons dans le rapport.

Une fois la session disponible, reprendre strictement :

1. My Events en lecture seule ;
2. inventaire des 13 événements selon `user_id` et `owner_id` ;
3. comparaison repository/PostgREST/UI ;
4. refresh ;
5. fermeture/réouverture ;
6. validation `EVENTS_VISIBILITY = PASS` ;
7. seulement ensuite commit final et freeze des artefacts Cloud TEST / Field TEST.

Aucun déploiement n'est autorisé avant nouvelle validation explicite.

## Hygiène de la tentative

Après le diagnostic, les fichiers temporaires suivants ont été supprimés :

- storageState incomplet ;
- helper de capture ;
- helper d'audit ;
- helper d'inspection des seuls noms de clés ;
- éventuel résultat temporaire.

Ils sont tous hors dépôt, non trackés par Git, et aucun token n'a été journalisé.
