# P2.6.4 — Cloud Event Workflow Regression Triage

Date : 2026-08-09

## Conclusion

`CLOUD_EVENT_WORKFLOW_FIX_READY`

La régression est caractérisée et un correctif local, non déployé, est prêt à être revu. Aucun événement Cloud n'a été créé, modifié, supprimé ou restauré pendant ce lot.

Classification principale : `EVENTS_UI_NOT_VISIBLE`.

Les 13 événements du backup Cloud pré-migrations sont toujours présents aujourd'hui. Le Cloud actuellement servi reste fonctionnellement défaillant jusqu'à validation puis création explicite d'une nouvelle release : aucun rebuild ou redéploiement n'a été effectué dans P2.6.4.

## Protection des données

- Cloud interrogé exclusivement en lecture seule via PostgREST anon et dump de schéma lié;
- aucune écriture Cloud;
- aucune restauration;
- aucun événement de test créé;
- aucune modification SQL/ACL;
- validation terrain P2.6.3 arrêtée;
- `caffeinate` du test terrain arrêté.

## Inventaire réel de public.events

`public.events` contient 13 lignes. La table ne possède pas de colonne `updated_at`; cette valeur est donc `N/A`, pas `NULL`.

| ID | Nom | Dates | Status | Paid | Méthode | Created at |
|---:|---|---|---|---:|---|---|
| 12 | CHAMIONNATS DU SENEGAL 2026 | 2026-01-03 → 2026-01-04 | pending | non | — | 2026-01-03 |
| 13 | CHAMPIONNATS DU SENEGAL 2026 | 2026-01-03 → 2026-01-04 | pending | non | — | 2026-01-03 |
| 16 | test off line | 2026-02-05 | pending | non | — | 2026-02-05 |
| 17 | LIGUE PRO #1 | 2026-02-26 → 2026-02-27 | pending | non | — | 2026-02-26 |
| 19 | LIGUE PRO ##1 | 2026-02-28 | pending | non | — | 2026-02-28 |
| 20 | TEST OFF NET | 2026-03-19 | pending | non | — | 2026-03-19 |
| 21 | 20 | 2026-03-26 | pending | non | — | 2026-03-26 |
| 24 | TEST DER | 2026-04-16 | pending | non | — | 2026-04-16 |
| 25 | LAST TEST FIELD | 2026-04-17 | pending | non | — | 2026-04-17 |
| 27 | SANDY CUP | 2026-04-18 | pending | non | — | 2026-04-18 |
| 28 | TONTON PAUL TROPHY | 2026-05-23 → 2026-05-24 | pending | non | — | 2026-05-23 |
| 33 | 1ère COUPE du SENEGAL 2026 | 2026-07-26 | pending | non | — | 2026-07-24 |
| 34 | COUPE du SENEGAL 1ere Etape YOFF | 2026-07-26 | pending | non | — | 2026-07-25 |

Ownership anonymisé :

- 12 événements : `user_id` et `owner_id` présents et identiques;
- événement 21 : `owner_id` présent, `user_id` absent;
- aucun événement payé;
- aucun événement `active`.

## Données associées visibles

Lecture limitée aux `event_id`, sans identité participant/juge :

| Table | Lignes visibles | Événements principaux |
|---|---:|---|
| heats | 332 | 12–34, plus références historiques 4/30/31/32 et 3 NULL |
| participants | 503 | 12,13,16,17,19,20,24,25,27,28,33,34 |
| scores | au moins 1000, limite REST atteinte | principalement 13,16,17,19,20,21,24,25, plus NULL |
| payments | 0 | — |

Les références de heats vers 4/30/31/32 sont orphelines par rapport à la table `events` actuelle, mais elles ne constituent pas une disparition récente démontrée.

## Comparaison backup Cloud

Backup comparé : `backups/p2_6_3i_cloud_pre170_data.sql`.

| Résultat | Nombre |
|---|---:|
| événements dans le backup | 13 |
| événements aujourd'hui | 13 |
| présents avant et maintenant | 13 |
| présents avant, absents maintenant | 0 |
| nouveaux depuis le backup | 0 |

Aucune restauration n'est nécessaire ou autorisée. Les événements 4/30/31/32 étaient déjà absents du backup récent; leur éventuelle histoire exige un audit séparé sur des backups plus anciens avant toute action.

## Pourquoi l'UI affiche zéro événement

Chaîne réelle :

1. l'artefact immuable déployé contient `VITE_DEV_MODE:"true"` et une identité de développement;
2. `OfflineAuthWrapper` court-circuite alors la session Supabase réelle et fournit une identité locale/dev;
3. `MyEvents.loadEvents()` filtre Cloud uniquement sur `user_id = identité courante`;
4. la requête retourne zéro ligne lorsque cette identité ne correspond pas à l'owner réel;
5. le fallback cache est vide, donc « Vous n'avez pas encore créé d'événement ».

Une seconde divergence existe : la propriété canonique introduite par les policies est `owner_id`, alors que plusieurs lectures frontend utilisaient uniquement `user_id`. L'événement 21 en est un exemple concret.

Le correctif local :

- interdit le mode dev sur un hostname Cloud même si une variable locale a été incorporée au bundle;
- conserve le mode dev sur un build Vite dev ou un hostname LAN/local;
- filtre les événements possédés par `user_id OR owner_id`, sans rendre visibles ceux d'un autre utilisateur.

## Origine de virage-surf-open-1786272802012

Chaîne exacte :

```text
MyEvents
→ /create-event
→ components/CreateEvent.handleSubmit
→ slug(name) + Date.now()
→ tentative INSERT public.events
→ erreur RLS/auth ou contrat, seulement journalisée puis avalée
→ localStorage eventData/eventId = pseudo-ID textuel
→ /payment
→ mode test legacy sans UPDATE DB
→ /participants sans ID canonique
→ preview locale autorisée
→ /generate-heats
→ parse/résolution numérique impossible
→ « ID d'événement invalide (virage-surf-open-1786272802012) »
```

La fonction génératrice était directement dans `CreateEvent.tsx` : normalisation du nom puis suffixe `Date.now()`. Le pseudo-ID n'a jamais été inséré dans `public.events.id` et aucun événement Virage Surf Open n'existe dans la DB Cloud.

## Contrat events.id

| table.colonne | Cloud | Mac runtime | Types générés/contrats TS | Écart |
|---|---|---|---|---|
| events.id | bigint auto-incrémenté | bigint | number | aucun |
| heats.event_id | bigint nullable | bigint nullable | number \| null | aucun |
| participants.event_id | bigint nullable | bigint nullable | number \| null | aucun |
| scores.event_id | bigint nullable | bigint nullable | number \| null | aucun |
| payments.event_id | bigint nullable | bigint nullable | number \| null | aucun |
| active_heat_pointer.event_id | bigint nullable | bigint nullable | number \| null | aucun |
| heat_judge_assignments.event_id | bigint nullable | bigint nullable | number \| null | aucun |
| heat_configs | pas de event_id; relation par heat_id text | identique | heatId string | aucun |
| heat_slot_mappings | pas de event_id; relation par heat_id text | identique | heatId string | aucun |
| score_overrides | pas de event_id; lien score_id/heat_id | identique | IDs string | aucun |

Le mismatch était exclusivement créé par le composant legacy : `string slug-timestamp` utilisé comme identité active malgré un contrat DB/TS unanimement numérique.

## Historique de la régression

Trois causes distinctes :

1. commit racine `17c979a` : introduction du pseudo-ID et du comportement « erreur INSERT avalée puis continuer »;
2. commit `9706a12` : renforcement du filtre de liste exclusivement sur `user_id`; `9c3182f` a ensuite supprimé ce filtre seulement en mode local, pas Cloud;
3. contamination de build : `frontend/.env.local`, ignoré par Git, contient le mode dev. Vite charge `.env.local` aussi pendant un build production. L'artefact actuel contient donc le bypass dev.

Comparaison demandée :

- `CreateEvent.tsx` est identique sur ce point dans la release P2.5.7 `36dba46` et la release actuelle `30705d1`;
- le backup du frontend Mac P2.5.7 contenait déjà `VITE_DEV_MODE:"true"`;
- la régression n'a donc pas été introduite par un commit P2.5.7/P2.6.3 unique; le déploiement immuable a reproduit un défaut latent et une configuration de build non versionnée.

## Workflow avant/après

### Avant

```text
CREATE local pseudo-ID
→ INSERT DB best effort
→ erreur ignorée
→ paiement/test local non persisté
→ participants locaux
→ preview et bouton write visibles
→ échec tardif sur ID
```

### Correctif local proposé

```text
auth Cloud réelle
→ INSERT event obligatoire
→ récupérer events.id bigint retourné
→ stocker persisted=true + ID canonique
→ paiement ou UPDATE contrôlé mode test
→ relire événement et activation
→ participants/preview
→ safe v2 seulement si persisted && activated
→ succès
→ /admin
```

Un preview local reste possible techniquement sans événement, mais aucun bouton d'écriture ou de génération persistante ne reçoit alors d'ID.

## Correctif local préparé

Fichiers fonctionnels :

- `frontend/src/domain/cloudEventWorkflow.ts` : contrat pur ID/persistance/activation;
- `frontend/src/lib/offlineAuth.ts` : dev mode impossible sur Cloud production;
- `frontend/src/events/api.ts` et `frontend/src/pages/MyEvents.tsx` : ownership `user_id OR owner_id`;
- `frontend/src/components/CreateEvent.tsx` : création Cloud stricte, ID retourné obligatoire, erreur bloquante;
- `frontend/src/components/PaymentPage.tsx` : mode test réellement persisté avant navigation;
- `frontend/src/components/ParticipantsPage.tsx` : état événement affiché et génération bloquée sans activation;
- `frontend/src/components/GenerateHeatsPage.tsx` : écriture désactivée sans événement persistant/activé et redirection officielle `/admin`.

Aucun fichier SQL, scoring, WAL, timer, planning safe v2, ESP32 ou Event Box schema n'a été modifié.

## Tests

Nouveau contrat : `frontend/src/domain/__tests__/cloudEventWorkflow.test.ts`.

Les 10 scénarios couvrent :

1. ID DB canonique;
2. stabilité après sérialisation/reload;
3. visibilité owner_id/user_id;
4. écriture interdite pour pseudo-ID;
5. événement persistant non activé bloqué;
6. mode test autorisant le workflow;
7. événement payé reconnu;
8. preview possible mais persistance gardée;
9. redirection `/admin`;
10. mode dev incorporé mais inactif sur Cloud production.

Résultats :

- TypeScript `tsc --noEmit` : PASS;
- tests ciblés : 10/10 PASS;
- suite complète : 380 PASS, 7 opt-in ignorés;
- warning Vitest WebSocket `EPERM 0.0.0.0:24678` : non bloquant, suite terminée avec code 0;
- build : volontairement NON EXÉCUTÉ conformément à l'interdiction de rebuild.

Limite : ces tests valident les contrats et gardes partagés; un E2E Cloud authentifié complet doit être ajouté/exécuté sur une fixture isolée après revue, avant déploiement.

## Impact données existantes

- 13/13 événements préexistants intacts;
- aucun événement Virage créé en DB;
- aucun heat/participant/score/config Cloud modifié;
- les pseudo-IDs restent uniquement dans le stockage navigateur concerné et devront être remplacés par sélection/création canonique après déploiement;
- aucune restauration automatique recommandée;
- orphelins historiques 4/30/31/32 laissés intacts.

## Décision requise avant déploiement

Le correctif local peut être revu. Pour le rendre effectif, il faudra ensuite autoriser explicitement :

1. un build production propre garantissant dev mode Cloud désactivé;
2. une nouvelle release/artefact immuable;
3. un E2E Cloud isolé création → activation test → participants → safe v2 → admin;
4. un déploiement Cloud/Mac décidé séparément.

Conclusion obligatoire : `CLOUD_EVENT_WORKFLOW_FIX_READY`.
