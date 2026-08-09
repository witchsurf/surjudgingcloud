# P2.6.6B — Authoritative DB Deployment Mode + PG15 + Cloud Payment E2E

Date : 2026-08-09

## Conclusion

**DUAL_MODE_RELEASE_BLOCKED**

La frontière de sécurité Cloud/Field est désormais autoritative côté base et les reconstructions PostgreSQL 15 et 17 sont validées. La création d'événement Cloud authentifiée et le workflow Field sont fonctionnels.

La release reste bloquée : le paiement Stripe sandbox n'a pas atteint un retour confirmé par le workflow, `events.paid` n'est jamais passé à `true`, et les validations post-paiement ne peuvent donc pas être déclarées réussies. Aucun contournement ni `UPDATE paid=true` manuel n'a été utilisé.

## 1. Mode de déploiement autoritatif

### Mécanisme retenu

La migration additive `20260808192000_authoritative_deployment_mode.sql` introduit :

- le singleton `public.app_deployment_config` ;
- une contrainte limitant `deployment_mode` à `cloud | field` ;
- un accès en écriture révoqué pour `public`, `anon` et `authenticated` ;
- la fonction `get_authoritative_deployment_mode()` en `SECURITY DEFINER`, limitée à la lecture du mode ;
- une définition finale de `create_event_secure` qui consulte uniquement ce singleton ;
- une politique de lecture Field des événements reposant sur le même mode autoritatif.

La migration installe par défaut `cloud` et ne transforme jamais automatiquement une installation officielle en Field. Une valeur absente ou invalide provoque un refus fermé.

### Suppression de Host comme frontière de sécurité

La définition finale ne consulte plus `Host`, `X-Forwarded-Host`, une variable Vite, un paramètre HTTP, `localStorage` ou les métadonnées utilisateur pour décider du mode.

Le test SQL `p2_6_6b_authoritative_deployment_mode.sql` vérifie qu'en mode Cloud un appel anonyme reste refusé avec `CLOUD_AUTH_REQUIRED` malgré :

- un Host privé ;
- localhost ;
- un Host Docker/Kong ;
- un Host arbitraire ;
- un `X-Forwarded-Host` local ;
- des combinaisons de headers forgés.

En mode Field, la création locale fonctionne sans Host particulier. `observed Host` n'est plus une donnée de décision.

La fonction historique temporaire introduite par `191000` reste présente pour compatibilité de reconstruction, mais elle n'est plus appelée par la frontière finale.

## 2. Migration additive et Cloud réel

La migration `20260808192000_authoritative_deployment_mode.sql` a été appliquée sur le Cloud avec succès, sans réécrire les migrations `190000` ou `191000` déjà enregistrées.

État vérifié après application :

- mode Cloud réel : `cloud` ;
- création anonyme : refusée ;
- création authentifiée : réussie ;
- identifiant événement : `bigint` ;
- événement initialement non payé : `paid=false`.

La fixture de caractérisation Cloud a été supprimée après usage.

## 3. Provisioning Field Mac et Windows

Le provisioning Field est une opération d'installation, jamais une action du navigateur.

Fichiers ajoutés ou adaptés :

- `backend/sql/PROVISION_FIELD_DEPLOYMENT_MODE.sql` : bascule administrative explicite vers `field`, puis vérification ;
- `scripts/hp-refresh-stack.sh` : exécute ce provisioning après les migrations locales ;
- `docs/field-deployment-mode-provisioning.md` : commandes Mac/Linux et Windows PowerShell, contrôles et règles de sécurité.

Les rôles `anon` et `authenticated` ne peuvent ni insérer, ni modifier, ni supprimer la configuration. Le Cloud reste `cloud` tant qu'un opérateur base autorisé ne le provisionne pas autrement ; aucune UI ne possède ce pouvoir.

## 4. PostgreSQL 15

Une reconstruction vierge a été exécutée avec l'image exacte :

`supabase/postgres:15.1.0.147`

Le script `scripts/test-pg15-authoritative-mode.sh` :

- crée une instance éphémère isolée ;
- applique toutes les migrations dans l'ordre, jusqu'à `192000` incluse, avec arrêt sur erreur ;
- exécute les tests du mode autoritatif ;
- provisionne explicitement Field ;
- vérifie le contrat de planning atomique safe v2 ;
- supprime le conteneur temporaire à la fin.

Résultat :

`PG15 authoritative deployment mode reconstruction: PASS (version=150001, mode=field)`

La reconstruction DB PG15 et les contrats RPC sont validés. Le navigateur Field complet n'a toutefois pas été exécuté contre ce conteneur PostgreSQL brut, qui ne fournit pas à lui seul toute la passerelle Supabase/PostgREST. Cette limite demeure un critère non intégralement satisfait de la spécification Field PG15.

## 5. PostgreSQL 17

Une reconstruction vierge via la stack Supabase locale PostgreSQL 17 a appliqué toutes les migrations jusqu'à `192000`.

Résultats :

- reset complet : PASS ;
- tests SQL du mode Cloud : PASS ;
- refus anonyme Cloud et spoofing des headers : PASS ;
- provisioning Field explicite : PASS ;
- création Field sans dépendance Host : PASS ;
- safe planning v2 : PASS.

Aucune divergence de contrat Cloud/Field n'a été observée entre PG15 et PG17 au niveau DB/RPC.

## 6. Field final et WAN off

Le parcours navigateur Field a été rejoué sur la stack Supabase locale isolée PG17, avec le build Field et l'audit réseau :

- création d'événement locale : PASS ;
- ID `bigint` : PASS ;
- participants : PASS ;
- import réel `Competition X.xlsx` : PASS, 62 participants et 7 catégories ;
- preview/preflight/safe v2 : PASS ;
- persistance des heats : PASS ;
- `/admin` : PASS ;
- refresh et relecture : PASS ;
- aucune route paiement : PASS ;
- audit réseau terrain : PASS, zéro domaine public non autorisé ;
- cleanup de la fixture : PASS.

Les routes `/admin`, `/chief-judge`, `/judge`, `/priority` et `/display` répondent correctement dans le build terrain.

Limite : ce parcours navigateur complet a utilisé la stack PG17. PG15 a été validé par reconstruction complète et tests SQL/RPC, mais pas par un E2E navigateur complet avec tous les services Supabase.

## 7. Paiement Cloud réel en sandbox

### Parcours atteint

Le test opt-in `frontend/e2e/p2-6-6b-cloud-payment.spec.ts` utilise le Cloud réel :

1. création d'un utilisateur temporaire authentifié ;
2. création par `create_event_secure` ;
3. contrôle `bigint` et `paid=false` ;
4. appel de la fonction de paiement ;
5. obtention d'une URL Checkout Stripe officielle en sandbox, avec un identifiant `cs_test_` ;
6. saisie des données de test Stripe officielles ;
7. attente du retour fournisseur et de la relecture DB ;
8. cleanup en bloc `finally`.

### Résultat observé

Le Checkout Stripe reste sur l'état `Processing`, y compris avec une attente prolongée. Aucun retour applicatif confirmé n'est reçu et `events.paid` ne devient pas `true`.

Deux indices doivent être investigués avant release :

- la session Checkout affiche **5 000 000 F CFA** alors que le montant transmis par le frontend est **50 000 XOF**, ce qui suggère une conversion en unité mineure incorrecte ou doublée dans le workflow ;
- la fonction `stripe-webhook` est déployée avec `verify_jwt=true`, alors qu'un webhook Stripe n'envoie normalement pas un JWT Supabase. Le callback peut donc être refusé avant son traitement.

Ces observations sont des pistes causales, pas encore une correction validée. Aucun changement de configuration fournisseur, aucune nouvelle migration et aucune mise à jour manuelle de `paid` n'ont été effectués dans ce lot.

### Conséquences

- callback réellement reçu : **FAIL / non prouvé** ;
- `paid=true` obtenu par le workflow : **FAIL** ;
- `/participants` autorisé après paiement : **non exécutable** ;
- Competition X, preview, safe v2, heats, `/admin` et refresh post-paiement : **non exécutables** ;
- fixture non payée avec tous les blocages de persistance vérifiés en E2E Cloud : **non finalisé**.

## 8. Événements Cloud existants

La vérification read-only des 13 événements existants avec la vraie session opérateur n'a pas été exécutée, faute de session utilisateur opérateur disponible dans l'environnement automatisé.

Une clé de service n'a pas été utilisée comme substitut, car elle contournerait précisément les politiques de visibilité à vérifier. Aucun événement existant n'a été modifié.

Ce critère reste ouvert :

- événements liés à `user_id` visibles ;
- événements `owner_id`-only visibles ;
- événements étrangers non exposés.

## 9. Tests et validations techniques

Résultats du lot :

- test SQL authoritative mode/spoofing : PASS ;
- reconstruction complète PostgreSQL 15 exacte : PASS ;
- reconstruction complète PostgreSQL 17 : PASS ;
- tests create event dual-mode : PASS ;
- E2E Cloud create authentifié : PASS ;
- E2E Field : PASS ;
- Competition X : 5/5 PASS ;
- safe planning v2 : PASS ;
- typecheck : PASS ;
- Vitest complet : 392 PASS, 7 scénarios opt-in ignorés par défaut ;
- build Cloud : PASS ;
- build Field : PASS ;
- audit réseau P1 Field : PASS ;
- syntaxe `scripts/hp-refresh-stack.sh` : PASS ;
- `git diff --check` : une ligne blanche terminale préexistante signalée dans le type généré, sans incidence fonctionnelle.

Les suites existantes couvrant notamment scoring, WAL et timer restent vertes. Aucune règle de scoring, structure WAL, logique timer ou planning safe n'a été modifiée.

## 10. Cleanup

Les fixtures Cloud temporaires créées pendant les tentatives paiement ont été supprimées : dernière vérification de nettoyage, 2 événements et 2 utilisateurs temporaires retirés. Les fixtures Field et les conteneurs PostgreSQL éphémères ont également été supprimés.

Aucune donnée des 13 événements existants n'a été écrite ou supprimée.

## 11. Risques et critères restant ouverts

Bloquants avant une release :

1. corriger et prouver le callback Stripe sandbox jusqu'à `paid=true` sans intervention DB manuelle ;
2. vérifier l'unité monétaire XOF et expliquer/corriger l'écart 50 000 / 5 000 000 ;
3. vérifier la politique d'authentification effective de `stripe-webhook` ;
4. exécuter le parcours Cloud post-paiement complet ;
5. exécuter le blocage Cloud non payé complet ;
6. vérifier read-only les 13 événements avec la vraie session opérateur ;
7. si exigé littéralement, fournir une stack Supabase complète PG15 et y rejouer le navigateur Field/restart, au-delà du test DB/RPC PG15 déjà réussi.

## 12. Release et déploiement

Aucun commit de release, aucun artefact de release et aucun déploiement n'ont été créés pour P2.6.6B.

Les conditions `CLOUD PAYMENT CALLBACK = PASS`, `CLOUD POST-PAYMENT = PASS` et `EXISTING EVENTS = PASS` ne sont pas réunies. Une nouvelle validation explicite est requise avant tout déploiement.
