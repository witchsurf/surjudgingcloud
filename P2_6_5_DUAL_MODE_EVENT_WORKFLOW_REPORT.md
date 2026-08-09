# P2.6.5 — Dual-mode event workflow

Date : 2026-08-09
Conclusion : **DUAL_MODE_EVENT_WORKFLOW_READY**

Cette conclusion signifie « prêt pour revue et smoke tests contrôlés ». Aucun déploiement Cloud, Mac ou Windows n'a été effectué.

## Résultat

Le workflow événement est désormais explicitement séparé par `DeploymentMode = 'cloud' | 'field'`. Le mode ne dépend plus du hostname, de `VITE_DEV_MODE`, d'un paramètre `?mode=` ou d'une ancienne préférence navigateur.

| Propriété | Cloud | Field |
|---|---|---|
| Source de vérité | Supabase Cloud | Supabase local |
| Authentification | vraie session Supabase Cloud | opérateur local, aucune session Cloud requise |
| Identité événement | `events.id` bigint Cloud | `events.id` bigint local |
| Paiement | obligatoire et validé | interdit/inutile |
| Participants | après persistance + paiement | après persistance locale |
| Planning | safe v2, ID canonique et paiement | safe v2 local, ID canonique |
| Sortie | `/admin` | `/admin` |
| Appels WAN | autorisés selon le workflow Cloud | interdits |

## Contrats créés

- `frontend/src/domain/deploymentMode.ts`
  - parse et exige `VITE_DEPLOYMENT_MODE` ;
  - expose les capacités Cloud auth, paiement et sync ;
  - une valeur absente ou différente de `cloud`/`field` arrête explicitement l'application.
- `frontend/src/domain/eventWorkflow.ts`
  - accepte seulement un entier positif canonique ;
  - rejette les pseudo-ID `slug-Date.now()` ;
  - formalise `canProceedToParticipants`, `canPersistHeats` et `assertPlanningAllowed` ;
  - conserve `/admin` comme sortie officielle.
- `frontend/src/components/DeploymentAuthWrapper.tsx`
  - Cloud utilise uniquement l'auth Supabase réelle ;
  - `OfflineAuthWrapper` n'est instancié qu'en Field.

L'ancien `cloudEventWorkflow.ts` local P2.6.4 a été remplacé par les deux contrats neutres ci-dessus.

## Changements de comportement ciblés

### Création

`CreateEvent.tsx` écrit obligatoirement dans la base du déploiement et attend le bigint retourné. Une erreur DB arrête le workflow dans les deux modes. Il n'existe plus de fallback vers un événement inventé dans `localStorage`.

- Cloud : session réelle requise, puis `/payment`.
- Field : aucune session Cloud, écriture Supabase locale, puis `/participants`.

`createEventRecord` accepte une identité propriétaire nullable pour Field, sans inventer d'utilisateur Cloud. En Cloud, `user_id` et `owner_id` reçoivent l'identité authentifiée.

### Paiement

- Cloud : le paiement transmet l'ID canonique, le provider et les URLs de retour à la fonction existante. Le bouton legacy « mode test » qui écrivait `paid=true` a été supprimé des deux pages de paiement.
- Field : la page ne rend aucun moyen de paiement et redirige vers les participants si l'ID local est valide, sinon vers `my-events`.

### Participants et planning

- Cloud non payé : accès/persistance bloqués.
- Cloud payé : participants et safe planning autorisés.
- Field persisté : participants et safe planning autorisés immédiatement.
- La résolution par nom d'événement a été supprimée du chemin de persistance des heats : l'ID DB vérifié doit correspondre à l'état chargé.
- Google Sheets est masqué et bloqué en Field ; les fichiers locaux CSV/XLSX restent disponibles.

### Mes événements

- Cloud : filtre `user_id OR owner_id` sur l'utilisateur Supabase réel.
- Field : lecture de tous les événements de la DB locale.
- Le cache d'événements Cloud n'est plus utilisé comme fallback de la liste.
- La synchronisation Cloud et son auto-sync sont désactivés/masqués en Field.

### Backend Supabase sélectionné

Le build fixe désormais le backend logique :

- Cloud force le mode Supabase Cloud et ignore les anciennes bascules locales ;
- Field force le mode Supabase local et n'utilise jamais l'URL Supabase générique/Cloud comme fallback ;
- une URL override n'est acceptée en Field que si elle est locale/privée.

## Fichiers créés

- `frontend/src/domain/deploymentMode.ts`
- `frontend/src/domain/eventWorkflow.ts`
- `frontend/src/domain/__tests__/dualModeEventWorkflow.test.ts`
- `frontend/src/components/DeploymentAuthWrapper.tsx`
- `frontend/scripts/build-deployment.mjs`
- `frontend/dist-cloud/` (artefact local de revue, non déployé)
- `frontend/dist-field/` (artefact local de revue, non déployé)
- `P2_6_5_DUAL_MODE_EVENT_WORKFLOW_REPORT.md`

## Fichiers modifiés

- `frontend/src/components/CreateEvent.tsx`
- `frontend/src/components/PaymentPage.tsx`
- `frontend/src/pages/PaymentPage.tsx`
- `frontend/src/components/ParticipantsPage.tsx`
- `frontend/src/components/GenerateHeatsPage.tsx`
- `frontend/src/pages/MyEvents.tsx`
- `frontend/src/components/OfflineAuthWrapper.tsx`
- `frontend/src/events/api.ts`
- `frontend/src/lib/offlineAuth.ts`
- `frontend/src/lib/supabase.ts`
- `frontend/src/main.tsx`
- `frontend/package.json`
- `frontend/vite.config.ts`
- `scripts/p1-field-build-audit.mjs` (support d'un répertoire d'artefact explicite ; politique inchangée)

## Tests

### Tests P2.6.5

`npx vitest run src/domain/__tests__/dualModeEventWorkflow.test.ts`

- 19 tests réussis ;
- Cloud : ID DB, blocage non payé, autorisation payé, planning, `/admin`, reload owner/user ;
- Field : mode explicite, ID local, aucun paiement, participants immédiats, nom Competition X neutre, planning local, `/admin`, reconstruction après reload ;
- négatifs : aucun bypass Cloud via `VITE_DEV_MODE`, aucune capacité paiement/sync Field, pseudo-ID refusés, événement non persisté bloqué, configuration implicite refusée.

### Suite complète

`npx vitest run`

- 67 fichiers réussis ;
- 389 tests réussis ;
- 7 tests opt-in ignorés ;
- aucun échec.

Le message `listen EPERM 0.0.0.0:24678` du serveur WebSocket Vitest reste un bruit connu du sandbox ; Vitest termine avec le code 0 et les tests réussissent.

### Typecheck

`npx tsc --noEmit` : réussi.

### Audit réseau Field P1

Exécuté sur le dernier `dist-field` :

- résultat `ok: true` ;
- `/admin` : 200 ;
- `/chief-judge` : 200, route finale `/admin` ;
- `/judge` : 200 ;
- `/priority` : 200 ;
- `/display` : 200 ;
- aucune requête runtime interdite ;
- aucun marqueur public interdit dans les assets statiques inspectés.

La politique interdit Supabase Cloud, Google/Google Sheets, Stripe, Unsplash et tout domaine public non autorisé.

## Builds explicites

Commandes reproductibles :

```bash
npm --prefix frontend run build:cloud
npm --prefix frontend run build:field
```

Chaque build contient `deployment-manifest.json`.

| Artefact | Mode | Révision déclarée | Hash composite SHA-256 du contenu |
|---|---|---|---|
| `frontend/dist-cloud` | `cloud` | `42371c906a590eadedf43fb8e9091b2868cafa67` | `85aa935703a403f77069b37a9e1d69600b31655863afc112c76bff617cc202a9` |
| `frontend/dist-field` | `field` | `42371c906a590eadedf43fb8e9091b2868cafa67` | `c9a8d66e7e9fae3c8ae4d9dcc70b7079d7a929fda0a4269d33a5fb72073b0f23` |

Les hashes diffèrent volontairement parce que le mode métier est compilé explicitement. Les deux builds ont été générés successivement depuis le même arbre de travail et déclarent le même HEAD de base. Les changements P2.6.5 ne sont pas encore commités : ces artefacts sont des artefacts de revue, pas une release immuable.

```text
SAME_CODE_REVISION = TRUE
SCHEMA_COMPATIBLE = TRUE
MODE_CONFIG_EXPLICIT = TRUE
```

Aucune migration SQL n'a été ajoutée ou modifiée par P2.6.5.

## Limites et validations restantes avant déploiement

- Aucun test destructif ou création d'événement n'a été exécuté sur l'Event Box active.
- La CLI locale cible un conteneur historique absent (`supabase_db_judging_2`) alors que plusieurs conteneurs Supabase actifs existent ; leur caractère isolé n'est pas suffisamment établi pour y injecter un événement temporaire sans validation opérateur.
- Le callback réel du fournisseur de paiement Cloud doit être smoke-testé avec un événement temporaire avant production.
- Le scénario Field complet doit être smoke-testé sur une base explicitement isolée : création, import réel Competition X, safe v2, refresh/restart, puis nettoyage.
- Les installations Windows et Mac partagent désormais le même code et le même contrat ; le packaging Windows reste hors de ce lot.
- Aucun déploiement, push, migration, modification scoring/WAL/timer/Realtime/ESP32, `event-box` ou `beach` n'a été effectué.

Ces validations terrain conditionnent le déploiement, mais ne remettent pas en cause la séparation architecturale et les garde-fous de code soumis à revue.
