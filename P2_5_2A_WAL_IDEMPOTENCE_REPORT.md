# P2.5.2a — Real WAL Idempotence Characterization

## Conclusion exécutive

**C. UNSAFE**

Le vrai chemin frontend n'est pas idempotent après épuisement de la fenêtre de retry :

- le commit initial utilise l'UUID présent ensuite dans le payload WAL ;
- `scoreWalExecutor` ne retransmet pas cet UUID ;
- `ScoreRepository.saveScore` génère un nouvel UUID et de nouveaux timestamps au replay ;
- PostgreSQL accepte les deux lignes physiques ;
- le LWW masque le doublon lorsque les valeurs sont identiques ;
- un replay obsolète peut toutefois devenir artificiellement plus récent et remplacer une correction serveur réellement plus récente dans le résultat LWW.

Aucun correctif fonctionnel n'est appliqué dans ce sous-lot. P2.5.3 ne doit pas commencer avant décision et correction de ce risque.

## Test ajouté

Fichier :

`frontend/src/repositories/__tests__/realWalIdempotence.integration.test.ts`

Commande explicite :

```bash
RUN_REAL_WAL_INTEGRATION=1 npx vitest run \
  src/repositories/__tests__/realWalIdempotence.integration.test.ts \
  --reporter=verbose
```

Le test est désactivé dans la suite ordinaire et activé uniquement avec `RUN_REAL_WAL_INTEGRATION=1`, car il requiert la stack Supabase locale. Il crée un événement, un heat, un panel et un état realtime isolés, puis les supprime en fin d'exécution.

Le test appelle réellement :

```text
ScoreRepository.saveScore
  -> upsert_score_secure
  -> perte d'ACK simulée après commit
  -> retries BaseRepository
  -> fallback IDB + useOfflineStore.registerMutation
  -> offlineSyncCoordinator.replayOfflineQueues
  -> offlineStore.processSyncQueue
  -> scoreWalExecutor.replayScoreWalMutation
  -> ScoreSyncAdapter.replayScore
  -> ScoreRepository.saveScore
  -> upsert_score_secure
```

La RPC n'est jamais appelée directement par le test pour rejouer la mutation. La seule insertion SQL auxiliaire de scores sert à créer les notes J2/J3 et une correction externe plus récente afin d'observer le moteur LWW.

## Simulation exacte de perte d'ACK

Le proxy de test appelle d'abord le vrai client Supabase et attend un retour serveur sans erreur. Il remplace ensuite uniquement la réponse reçue par une erreur réseau synthétique.

Le serveur a donc déjà commité la ligne lorsque le client voit `NETWORK_ERROR`.

### Effet du retry

Une seule perte d'ACK n'atteint pas la WAL : `BaseRepository.execute` retente l'opération avec le même objet `newScore`, donc le même UUID. Le second upsert met à jour la même ligne et retourne normalement.

Pour reproduire une mutation restant réellement dans la WAL, le test perd les ACK des quatre tentatives : tentative initiale plus trois retries. Les quatre appels serveur utilisent toujours le même UUID et ne créent qu'une ligne physique. Après épuisement des retries, le fallback existant place ce même objet score dans la WAL.

Ce comportement réel n'était pas représenté par l'ancien scénario P0.

## Scénario A — ACK normal

Résultat observé :

- UUID initial : `07c9aa18-496b-45ae-90fb-55c415e3d2ad` sur l'exécution finale ;
- ligne physique : 1 ;
- mutation WAL : 0 ;
- replay : aucun.

Le chemin nominal est sûr.

## Scénario B — serveur écrit, ACK perdu

Après quatre commits identiques dont les ACK sont perdus :

- UUID première écriture/retour fallback : `35419c5e-d2b7-4ec6-884d-90878bc537a9` ;
- UUID dans `mutation.payload.id` : `35419c5e-d2b7-4ec6-884d-90878bc537a9` ;
- lignes physiques avant replay pour J1 : 1 ;
- mutation WAL : 1.

Le fallback conserve donc correctement l'UUID initial dans le payload persisté.

## Scénario C — double appel du coordinateur

Deux appels concurrents réels sont lancés :

```text
replayOfflineQueues('p252a-double-1')
replayOfflineQueues('p252a-double-2')
```

Le verrou `replayInProgress` fonctionne : une seule exécution de la WAL a lieu.

Mais cet unique replay produit :

- UUID initial/payload : `35419c5e-d2b7-4ec6-884d-90878bc537a9` ;
- UUID réellement utilisé au replay : `cbe81b27-4eff-4b4d-a8a5-fad440933798` ;
- lignes physiques J1 pour le même fait : 2 ;
- faits métier distincts `heat + lycra + vague + station` : 1 ;
- WAL après replay : 0.

Le double coordinateur n'ajoute pas une troisième ligne. Il ne protège cependant pas contre le nouvel UUID créé par `saveScore`.

## Résultat LWW avec valeur identique

Pour une vague complète à trois juges :

- J1 possède deux lignes physiques à 7,5 ;
- J2 et J3 possèdent une ligne chacun à 7,5 ;
- `canonicalizeScores` conserve trois faits juge ;
- l'UUID J1 sélectionné est celui du replay ;
- moyenne affichée par le moteur : 7,5.

Dans ce cas précis, la situation correspondrait à `DUPLICATE_PHYSICAL_BUT_SAFE_RESULT`. Ce résultat ne suffit néanmoins pas à classer le système comme sûr, car le timestamp a également été régénéré.

## Scénarios D et E — refresh puis retour réseau

Une nouvelle perte d'ACK est provoquée, puis la WAL est sérialisée et restaurée comme après rechargement du store persisté.

Résultat final :

- UUID initial/payload : `7de94332-9bdd-4e87-acd4-21e098901978` ;
- UUID replay : `2f39262b-ea85-4495-ab4a-15c2bfcce78d` ;
- coordinateur appelé hors ligne : mutation conservée ;
- retour réseau : replay exécuté ;
- lignes physiques : 2 ;
- UUID physiques distincts : 2 ;
- WAL après replay : 0.

Le refresh ne perd pas la mutation, mais ne préserve pas son identité lors du replay.

Limite : dans l'environnement Vitest/jsdom, IndexedDB est indisponible et le store utilise son fallback localStorage. Le test sérialise/restaure exactement la forme persistée du slice `mutations`; il ne valide pas le moteur IndexedDB natif d'un navigateur réel.

## Preuve d'un résultat non fiable

Un scénario supplémentaire démontre que le doublon n'est pas seulement physique :

1. score 6 commité, ACK perdu, mutation 6 dans la WAL ;
2. une correction serveur plus récente écrit 9 avec un autre UUID ;
3. la WAL obsolète est rejouée ;
4. `saveScore` lui donne un troisième UUID et de nouveaux timestamps ;
5. LWW considère le replay obsolète comme le plus récent.

Résultat de l'exécution finale :

- UUID initial 6 : `3c168e64-4dd4-4aed-82f0-91cf9a802cb0` ;
- UUID correction 9 : `7e95846a-6fc6-4a2d-b3c3-809492686e71` ;
- UUID replay 6 : `26c20036-12e2-4bd2-8080-31231f282d23` ;
- lignes physiques : 3 ;
- score attendu avant replay : 9 ;
- score sélectionné par LWW après replay : **6** ;
- WAL après replay : 0.

Le système peut donc présenter un résultat sportif obsolète comme dernier résultat. Cela impose la classification `UNSAFE`.

## Comparaison avec l'ancien test P0

| Élément | Ancien P0 `lost_ack_replay` | Nouveau test réel |
|---|---|---|
| Écriture initiale | appel direct PostgreSQL/RPC helper | `ScoreRepository.saveScore` |
| Perte d'ACK | simulée conceptuellement | réponse remplacée après vrai commit |
| Retries frontend | non | oui, quatre tentatives |
| Création WAL frontend | fichier JSON de test | vrai `useOfflineStore.registerMutation` |
| Coordinateur | non | vrai `offlineSyncCoordinator` |
| Exécuteur WAL | non | vrai `scoreWalExecutor` |
| Adaptateur | non | vrai `ScoreSyncAdapter` |
| Replay | UUID forcé identique | appel `saveScore` sans UUID |
| Lignes physiques | 1 | 2, ou 3 avec correction intermédiaire |
| Résultat LWW | non testé dans ce conflit | peut sélectionner la mutation obsolète |

L'ancien test démontrait correctement l'idempotence de `upsert_score_secure` à UUID identique. Il ne démontrait pas que le frontend réutilisait cet UUID.

## Contraintes et index PostgreSQL

Contraintes observées sur la base locale :

- clé primaire unique : `scores_pkey (id)` ;
- FK `event_id -> events(id)` ;
- FK `heat_id -> heats(id)` ;
- check score `0 <= score <= 10`.

Il n'existe aucune contrainte unique sur :

```text
heat_id + upper(trim(surfer)) + wave_number + judge_station
```

Il existe des index non uniques, notamment :

- `idx_scores_heat_station (heat_id, judge_station)` ;
- `idx_scores_event_heat_wave_surfer_judge` ;
- `idx_scores_heat_id_created_at`.

Aucun de ces index n'empêche le doublon. Aucune modification SQL n'est proposée dans P2.5.2a.

## Cause racine

Le payload WAL contient déjà :

- `id` ;
- `timestamp` ;
- `created_at` ;
- tous les champs snake_case du score.

Mais `scoreWalExecutor` reconstruit une request partielle et ignore :

- `payload.id` ;
- `payload.timestamp` ;
- `payload.created_at`.

`ScoreRepository.saveScore` exécute alors :

```text
id = generateId()
timestamp = now()
created_at = now()
```

Le replay perd donc à la fois l'identité idempotente et l'ordre métier d'origine.

## Proposition de correction minimale — non implémentée

### Option recommandée : méthode interne de replay persistant

Ajouter à la frontière technique, pas au contrat public métier :

```ts
interface ScoreSyncAdapter {
  replayPersistedScore(
    mutation: OfflineMutation,
    payload: PersistedScorePayload,
  ): Promise<void>;
}
```

Cette méthode appellerait une nouvelle méthode interne de `ScoreRepository`, par exemple :

```ts
replayPersistedScore(score: Score): Promise<void>
```

Elle réutiliserait les opérations existantes :

1. `ensureHeatRowsExist` ;
2. `upsertScoreSecure` ;
3. sauvegarde IDB/mark synced ;
4. événement local existant.

Elle ne construirait pas un nouveau fait et conserverait exactement :

- `payload.id` ;
- `payload.timestamp` ;
- `payload.created_at` ;
- `payload.surfer` ;
- station/identité juge ;
- score et métadonnées.

Le payload snake_case actuel resterait inchangé.

### Pourquoi ne pas simplement rappeler saveScore

Ajouter des champs optionnels `id`, `timestamp`, `createdAt` à la request publique de `saveScore` serait possible, mais mélangerait création interactive et replay technique. Une méthode interne dédiée rend l'intention explicite et réduit le risque qu'un composant fournisse arbitrairement un UUID ou des timestamps.

### Impact sur saveScore

Avec l'option recommandée : aucun changement du chemin nominal `saveScore`. Il continue à générer UUID/timestamps pour une nouvelle saisie.

Le code commun de persistance peut être extrait en helper privé, mais la séquence RPC/fallback/heat parent/IDB doit rester caractérisée.

### Impact sur BaseRepository.generateId

Aucun changement. `generateId` reste utilisé pour les nouvelles saisies et nouveaux overrides. Il n'est simplement pas appelé lors du replay d'un score déjà identifié.

### WAL déjà persistées

La majorité des mutations actuelles créées par le fallback contiennent déjà un `payload.id` UUID et les deux timestamps. Elles peuvent être rejouées telles quelles sans migration de structure.

Stratégie proposée :

1. si `payload.id` est un UUID valide, l'utiliser ;
2. sinon, si `mutation.id` est un UUID valide, l'utiliser comme ID stable de score ;
3. sinon, dériver un UUID déterministe à partir de l'identité stable de la mutation (`mutation.id`, timestamp WAL, heat, lycra, vague, station), toujours avec le même namespace/version ;
4. utiliser `payload.timestamp`, puis `payload.created_at`, puis `mutation.timestamp` comme ordre original ;
5. si aucune identité/chronologie exploitable n'existe, ne pas générer silencieusement un ID différent à chaque replay : placer la mutation en erreur opérateur explicite ou appliquer une migration-on-read validée séparément.

La dérivation doit être testée avec les anciennes mutations dont `registerMutation` utilisait le fallback non-UUID de `Math.random`.

### Compatibilité snake_case

Aucune clé du payload ne doit changer. L'adaptateur lit directement :

- `id` ;
- `event_id` ;
- `heat_id` ;
- `judge_station` ;
- `judge_identity_id` ;
- `surfer` ;
- `wave_number` ;
- `timestamp` ;
- `created_at`.

Le format persistant reste compatible avec toutes les WAL actuelles.

### Impact override

Les overrides ne doivent pas être corrigés implicitement avec le score simple. Leur payload actuel provient de `ScoreOverrideLog` et `scoreWalExecutor` attend aussi des champs de contexte qui peuvent être absents (`competition`, `division`, `round`). En outre, `overrideScore` génère un nouvel UUID de score et un nouvel UUID de log.

Avant correction, un test réel séparé doit caractériser :

- ID du score corrigé ;
- ID du log ;
- `score_id` référencé ;
- contexte manquant dans les anciennes WAL ;
- ordre LWW ;
- duplication du log.

La correction score proposée ne doit pas modifier le chemin override tant que cette caractérisation n'est pas approuvée.

### Rollback

Le correctif proposé serait réversible par retour de `ScoreSyncAdapter.replayPersistedScore` vers l'appel actuel `saveScore`. Aucun SQL ou changement de payload ne serait requis.

Avant activation, conserver :

- l'ancien exécuteur derrière une façade interne ;
- tests comparatifs des payloads ;
- fixture avec UUID valide ;
- fixture ancienne sans UUID valide ;
- fixture ACK perdu puis correction externe.

## Validations du sous-lot de caractérisation

- intégration réelle locale : **1/1 réussie**, cinq scénarios obligatoires plus conflit correction ;
- durée finale : 57,07 s ;
- typecheck : réussi ;
- suite ordinaire : **185 tests réussis**, test réel explicitement skipped sans variable ;
- build Vite/PWA : réussi, 2 368 modules et 48 entrées précachées ;
- audit réseau P1 : réussi, aucune violation ;
- routes terrain : validées ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

Les données de fixture ont été supprimées dans le `finally` du test. La stack Supabase locale uniquement a été utilisée.

## Fichiers créés

- `frontend/src/repositories/__tests__/realWalIdempotence.integration.test.ts` ;
- `P2_5_2A_WAL_IDEMPOTENCE_REPORT.md`.

Aucun fichier fonctionnel n'a été modifié dans P2.5.2a. Aucun SQL, scoring, timer, Cloud ↔ HP, ESP32, route, structure/ordre WAL, `event-box` ou `beach` n'a été changé.

## Décision requise

La correction de préservation de l'UUID **et des timestamps d'origine** doit être approuvée et implémentée avant P2.5.3. Préserver uniquement l'UUID empêcherait le doublon de la même mutation, mais préserver également la chronologie est nécessaire pour empêcher une mutation obsolète de gagner le LWW.

## Conclusion formelle

**C. UNSAFE : le replay réel peut créer plusieurs lignes physiques et peut rendre une mutation obsolète gagnante dans le résultat LWW. Une correction est requise avant P2.5.3.**
