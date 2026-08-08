# P2.5.2c — Caractérisation réelle de l’idempotence WAL des overrides

## Classification finale

**C. UNSAFE**

Le score WAL autonome est sûr depuis P2.5.2b, mais la mutation `score_overrides` est rejouée comme une nouvelle commande `overrideScore`. Elle crée donc un nouveau score corrigé, un nouveau log, de nouveaux timestamps et un nouveau lien `score_id`. Le chemin peut dupliquer les lignes physiques et changer le résultat LWW officiel.

Aucune correction fonctionnelle n’a été appliquée dans ce sous-lot. P2.5.3 ne doit pas commencer avant validation et correction séparée.

## Périmètre et méthode

Le test opt-in `frontend/src/repositories/__tests__/realOverrideWalIdempotence.integration.test.ts` exécute la chaîne réelle :

`Admin/useScoreManager → ScoreRepository.overrideScore → fallback WAL → offlineSyncCoordinator → scoreWalExecutor → ScoreSyncAdapter → ScoreRepository.overrideScore`

La stack Supabase locale est détectée par `supabase status`. Un événement, un heat et un panel isolés sont créés, puis l’événement est supprimé en `finally`.

La perte d’ACK est injectée après la réussite des deux commits — score corrigé et log — au dernier point client de l’opération, avant son acquittement par `BaseRepository`. Cela exerce les vrais RPC, retries, fallback, WAL et replay. Limite : la rupture est injectée à la frontière post-commit du repository, et non dans le transport HTTP de PostgREST.

## Fonctionnement observé

### A. Override nominal

- score initial : `956e5c75-24ed-4f59-9286-d22e98b772d6` ;
- score corrigé : `ffe07549-7d2f-4d9a-b2c6-66b98a5ac40f` ;
- log : `5b37a18b-4216-465e-8fbf-6fc5cd077b48` ;
- `log.score_id` : `956e5c75-24ed-4f59-9286-d22e98b772d6`, soit le score précédent ;
- score `timestamp` : `2026-08-05T22:43:51.750Z` ;
- score `created_at` : `2026-08-05T22:43:51.713Z`, conservé depuis le score précédent ;
- log `created_at` : `2026-08-05T22:43:51.750Z` ;
- base : 2 scores, 1 log ; WAL vide.

Ce comportement nominal append-only est cohérent avec l’implémentation existante.

### B. Commit serveur puis ACK perdu

Avant replay :

- score initial : `c9eb0881-956d-4131-bad5-6a30bc70d525` ;
- score corrigé : `cd94c742-19f8-49a2-8685-6c706f4a3048` ;
- log : `8a9b8c19-d246-483f-b9d1-90b740b13f1c` ;
- `log.score_id` : `c9eb0881-956d-4131-bad5-6a30bc70d525` ;
- score `timestamp` : `2026-08-05T22:43:51.798Z` ;
- score `created_at` : `2026-08-05T22:43:51.783Z` ;
- log `created_at` : `2026-08-05T22:43:51.798Z` ;
- base : 2 scores, 1 log.

La WAL contient exactement deux mutations FIFO :

1. `scores`, mutation `ba8fe203-55f3-414d-b4fd-1916fa7151f6`, payload score contenant l’UUID et les timestamps ci-dessus ;
2. `score_overrides`, mutation `19f7bd54-647b-4ae0-9d39-ef4ddd96064a`, payload contenant l’UUID du log, son `score_id`, son `created_at` et les métadonnées snake_case.

La structure WAL existante transporte donc déjà les identités nécessaires. Elles sont perdues uniquement par le mapping actuel du replay override.

### C/G. Double coordinateur et duplication du log

Le garde du coordinateur empêche deux replays simultanés de la même file, mais un replay logique suffit à créer :

- nouveau score : `0588d805-62e7-428a-bcf7-e362234fe323` ;
- nouveau log : `870d6869-a763-4271-a663-2d0786c406bb` ;
- nouveau log référant `cd94c742-19f8-49a2-8685-6c706f4a3048`, le score corrigé original.

Après replay : 3 scores et 2 logs au lieu de 2 scores et 1 log. La WAL est vide, car le replay est considéré réussi.

Le score affiché reste 6 dans ce scénario, mais il provient du nouveau fait ayant le timestamp du replay. La duplication n’est donc pas limitée au journal.

### D. Refresh puis retour réseau

Après sérialisation/restauration réelle de la WAL puis replay :

- 3 scores physiques ;
- 2 logs physiques ;
- nouvelles identités générées au replay.

Le refresh ne protège pas l’identité de l’override.

### E. ACK perdu pendant le replay

Avant replay, la paire WAL porte notamment :

- score `bb14e2a9-bbf1-41e1-b2b1-f91d17e62f65` ;
- log `70e0abe2-d4c4-464c-b2f8-d1ebe902d00b`.

Le replay persiste le score original, puis `overrideScore` crée un nouveau score et un nouveau log. Lorsque l’ACK post-commit est perdu, le fallback considère l’opération comme une nouvelle correction offline et remplace la paire traitée par une nouvelle paire WAL :

- score `211f0ee6-3164-4607-b52e-dd92ebb89ddd` ;
- log `9da7a9d2-1d02-44d4-a585-00233baba986` ;
- nouveau timestamp de score et de log : `2026-08-05T22:45:05.332Z` ;
- nouveau `score_id` du log : `bb14e2a9-bbf1-41e1-b2b1-f91d17e62f65`.

La taille reste deux mutations, mais les identités et la chronologie changent. Un retry ultérieur peut répéter ce cycle.

### F. Ancien override rejoué après une correction serveur plus récente

- override ancien 6 : `0e355438-326a-4f6e-9182-8864021e5355` ;
- correction serveur plus récente 9 : `ba41e7c1-fe34-439c-8119-392cc985bb4b` ;
- score recréé par le replay : `fdf860cf-60dc-4119-8bf9-96c8c08536d2` ;
- base après replay : 4 scores, 2 logs ;
- résultat LWW officiel `timestamp → created_at → id` : **6**, UUID `fdf860cf-60dc-4119-8bf9-96c8c08536d2`.

Le résultat 9 est donc écrasé sportivement par un ancien override rendu artificiellement récent. Cette observation impose la classification UNSAFE.

### H. Ancienne WAL à contexte partiel

Une mutation sans UUID de log, sans `score_id`, sans nom de juge et sans commentaire est acceptée par le mapping actuel. Elle crée :

- score `521b856a-3e19-4bd5-85ff-42fcfaa74b0e` ;
- log `3dcd1e65-125c-456a-b624-438461aaab63` ;
- `log.score_id` égal au nouveau score ;
- WAL supprimée après replay.

Le chemin invente donc silencieusement l’identité et la chronologie manquantes.

## Contraintes de base vérifiées

La base locale possède une clé primaire sur `scores.id` et une sur `score_overrides.id`. Elle ne possède pas de contrainte d’unicité métier empêchant plusieurs scores ou plusieurs logs pour une même station, couleur et vague. Aucun garde SQL ne compense les nouvelles identités générées par le replay.

## Proposition de correction minimale — non appliquée

### Principe

Ajouter un chemin technique dédié, par exemple :

`ScoreRepository.replayPersistedOverride(log: ScoreOverrideLog): Promise<void>`

Ce chemin doit uniquement republier le log déjà créé. Il ne doit jamais appeler `overrideScore`, créer un score, appeler `generateId` ou produire une date courante. La mutation `scores` précédente dans la WAL continue d’être traitée par `replayPersistedScore`, désormais sûr.

### Impacts exacts

- **Score UUID** : aucun score supplémentaire. L’UUID du score corrigé reste celui du payload `scores` précédent.
- **Override log UUID** : conserver `payload.id`; sinon `mutation.id` s’il est exploitable; sinon UUID déterministe versionné.
- **`score_id`** : conserver exactement `payload.score_id`. Il désigne actuellement le score précédent dans le flux nominal et cette sémantique ne doit pas être changée dans ce correctif.
- **Timestamps score** : aucun changement; ils sont préservés par P2.5.2b.
- **Timestamp log** : conserver `payload.created_at`, sinon `mutation.timestamp`; jamais `now()` silencieux.
- **Payload legacy** : garder le snake_case et toutes les clés actuelles. Ajouter un type guard interne strict, sans changer la structure WAL.
- **Persistance** : réutiliser `recordScoreOverrideSecure`, donc la même RPC et le même fallback table existant, avec l’UUID et le timestamp résolus.
- **Événements/stockage local** : conserver le log local et les événements existants sans réenregistrer une nouvelle mutation WAL lors du replay.

### Anciennes WAL

- `payload.id`, `payload.score_id` et `payload.created_at` valides : replay direct et idempotent.
- log sans UUID mais avec `score_id` : UUID déterministe stable dérivé de la mutation et des dimensions métier.
- log sans `score_id` : ne pas inventer un lien ni créer un score. Conserver la mutation avec un état opérateur explicite. Une récupération déterministe ne serait acceptable qu’après preuve d’un score WAL adjacent unique; elle doit être caractérisée séparément.
- chronologie inexploitable : conserver la mutation en erreur, sans date courante.

### Rollback

Le rollback remettrait `ScoreSyncAdapter.replayOverride` vers `overrideScore`. Il est simple au niveau du code et ne nécessite aucun rollback SQL, mais réintroduirait immédiatement les duplications et le risque LWW documentés ici.

## Tests et validations

- Test réel Supabase local P2.5.2c : **1 réussi**, 93,65 s.
- Scénarios A à H couverts dans le vrai coordinateur/exécuteur/repository.
- Typecheck : **réussi**.
- Suite complète : **191 réussis**, 2 intégrations réelles opt-in ignorées par défaut.
- Build Vite/PWA : **réussi**.
- Audit réseau P1 : **réussi**, aucune violation et routes terrain inchangées.
- `git diff --check` : **réussi**.

Le refus WebSocket Vitest `0.0.0.0:24678` observé dans le bac à sable reste non bloquant.

## Fichiers ajoutés

- `frontend/src/repositories/__tests__/realOverrideWalIdempotence.integration.test.ts`
- `P2_5_2C_OVERRIDE_WAL_IDEMPOTENCE_REPORT.md`

Aucun fichier fonctionnel n’a été modifié pour P2.5.2c. Aucun SQL, scoring, timer, flux Cloud ↔ HP, ESP32, route, structure ou ordre WAL n’a changé.
