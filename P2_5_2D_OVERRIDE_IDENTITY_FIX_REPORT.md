# P2.5.2d — Préservation de l’identité WAL des overrides

## Conclusion

Le replay `score_overrides` est maintenant idempotent pour l’identité, le lien `score_id` et la chronologie. Il ne repasse plus par `overrideScore`, ne crée aucun score et republie uniquement le log déjà présent dans la WAL.

La frontière score/WAL est **SAFE pour les scénarios A–L validés** : après perte d’ACK, double coordinateur, refresh et retry, la base conserve deux scores physiques — initial et correction — et un seul log. Un ancien override à 6 rejoué après une correction serveur à 9 laisse le LWW officiel à 9.

P2.5.3 n’a pas été commencé.

## Avant / après

Avant P2.5.2d, `scoreWalExecutor` transformait le payload log en nouvelle commande `overrideScore`. Chaque replay pouvait produire un nouveau score, un nouveau log, un nouveau `score_id` et de nouveaux timestamps.

Après P2.5.2d :

- l’exécuteur transmet la mutation `score_overrides` complète et inchangée ;
- `ScoreSyncAdapter` résout strictement son identité et sa chronologie ;
- `ScoreRepository.replayPersistedOverride` appelle uniquement `recordScoreOverrideSecure` ;
- le score WAL précédent reste exclusivement traité par `replayPersistedScore` ;
- aucun fallback du replay log ne crée une nouvelle mutation ou une nouvelle paire WAL.

## Fichiers créés et modifiés

Créés :

- `frontend/src/repositories/internal/persistedOverridePayload.ts`
- `frontend/src/repositories/__tests__/persistedOverridePayload.test.ts`
- `P2_5_2D_OVERRIDE_IDENTITY_FIX_REPORT.md`

Modifiés :

- `frontend/src/repositories/ScoreRepository.ts`
- `frontend/src/repositories/internal/scoreSyncAdapter.ts`
- `frontend/src/stores/scoreWalExecutor.ts`
- `frontend/src/stores/__tests__/scoreWalExecutor.test.ts`
- `frontend/src/repositories/__tests__/realOverrideWalIdempotence.integration.test.ts`

## Contrat et résolution

`PersistedOverridePayload` conserve le payload snake_case existant : `id`, `heat_id`, `score_id`, métadonnées juge, lycra, vague, anciennes/nouvelles notes, motif, commentaire, acteur et `created_at`.

Résolution de l’UUID du log :

1. `payload.id` s’il est valide ;
2. `mutation.id` s’il est valide ;
3. UUID déterministe versionné dérivé de `mutation.id + mutation.timestamp + score_id + heat_id + surfer + wave_number`.

La dérivation utilise l’espace logique `surfjudging-override-wal:v1`, SHA-1 Web Crypto et les bits UUID version 5/RFC.

Résolution de la chronologie :

1. `payload.created_at` ;
2. `mutation.timestamp` ;
3. sinon erreur opérateur explicite.

`score_id` provient exclusivement de `payload.score_id` et doit être un UUID valide. Aucune recherche, génération ou supposition de lien n’est effectuée.

## Méthode repository

`ScoreRepository.replayPersistedOverride(log)` :

- refuse une identité, un `score_id` ou une chronologie absente ;
- appelle `recordScoreOverrideSecure` avec les valeurs originales ;
- conserve la RPC `record_score_override_secure` et son fallback table existant ;
- met à jour le journal local et émet l’événement existant ;
- n’appelle jamais `overrideScore`, `generateId` ou une date courante ;
- ne crée et ne modifie aucun score.

Le chemin nominal `overrideScore` reste inchangé.

## Résultats réels Supabase local

Le test opt-in utilise le vrai chemin :

`offlineSyncCoordinator → scoreWalExecutor → ScoreSyncAdapter → ScoreRepository.replayPersistedOverride → recordScoreOverrideSecure`

L’événement, le heat et le panel sont isolés puis supprimés en fin d’exécution.

### A. Override nominal

- score initial : `8ce20153-4e08-45e2-a596-c71e85d772c2` ;
- score corrigé : `60c3b96e-c64e-4a7a-b811-87840eeb78a9` ;
- log : `119a52c9-5977-4e9d-b0ae-fb9b1a928c2f` ;
- `score_id` du log : score initial ;
- 2 scores, 1 log, WAL vide.

### B/C/G. Commit, ACK perdu et double coordinateur

Avant replay :

- score corrigé : `316dbce2-c237-400a-b2a4-3c5caf53bb31` ;
- log : `f5ae0e70-e3a4-4f6e-b2e1-632848d31735` ;
- `score_id` : `9c68f5f0-f083-4183-82e3-b390ed64a9e5` ;
- `created_at` du log : `2026-08-05T22:53:15.701Z`.

Après le double appel du coordinateur :

- mêmes UUID ;
- même `score_id` ;
- même `created_at` ;
- 2 scores physiques ;
- 1 log physique ;
- WAL vide.

### D. Refresh et retour réseau

Après sérialisation/restauration de la WAL puis replay : 2 scores, 1 log, aucune nouvelle identité.

### E. ACK perdu pendant le replay

La paire initiale contenait :

- score `eec90a8e-494c-4c64-a6c3-660d12b2f456` ;
- log `072c06f7-7191-4db8-9235-2505d3ae0849` ;
- `score_id` `c7bb69bf-bf45-4920-b07b-2c9257046e19` ;
- `created_at` `2026-08-05T22:54:10.800Z`.

Après perte de tous les ACK du replay log :

- la mutation score, déjà rejouée avec succès, est retirée ;
- la mutation override originale reste seule en WAL, strictement inchangée ;
- aucune nouvelle paire WAL n’est créée ;
- la base reste à 2 scores et 1 log ;
- le retry suivant utilise le même UUID, le même `score_id` et le même timestamp, puis vide la WAL.

### F. Ancien 6 après correction serveur 9

- score ancien override : `7187fbf1-f6e5-4017-8e54-ca6bf60d7fe0` ;
- correction serveur 9 : `e05b10bd-9f88-41d5-9f56-4a23efaa773f` ;
- après replay : 3 scores physiques, correspondant uniquement aux trois faits légitimes, et 1 log ;
- LWW final : **9**, UUID `e05b10bd-9f88-41d5-9f56-4a23efaa773f`.

Le replay du journal ne peut plus rendre l’ancien 6 artificiellement récent.

### H/I/J. Compatibilité anciennes WAL

- H, `payload.id` valide : log `f5860f31-3f66-46c4-a249-825d108f7128` conservé.
- I, `payload.id` absent et `mutation.id` valide : log `d275ea2e-f756-4567-9c45-f9769ee4c4ac`.
- J, aucun UUID source valide : UUID déterministe `7d69ae23-784c-5dea-8cac-3cc92cba94df`, identique sur deux replays, avec une seule ligne physique.
- Aucun de ces replays ne crée de score.

### K/L. Payloads non récupérables

- K, `score_id` absent : mutation conservée, `syncError` explicite, zéro score et zéro log créés.
- L, `created_at` et `mutation.timestamp` invalides : mutation conservée, erreur de chronologie explicite, zéro score et zéro log créés.
- Aucune date courante n’est injectée.

## WAL avant / après

La structure, les clés, le stockage et l’ordre FIFO n’ont pas changé. La seule modification est la consommation technique de la mutation override : elle est maintenant transmise entière au résolveur au lieu d’être convertie en commande métier.

## Rollback

Le rollback consiste à remettre `ScoreSyncAdapter.replayOverride` vers `overrideScore` et l’ancien mapping de `scoreWalExecutor`. Aucun rollback SQL ou de données n’est nécessaire. Ce rollback réintroduirait toutefois immédiatement le risque critique P2.5.2c et ne doit pas être utilisé hors urgence.

## Validations

- Intégration réelle Supabase locale A–L : **1 test réussi**, 157,56 s.
- Tests du résolveur : **6 réussis**.
- Tests de frontière executor : **2 réussis**.
- Typecheck : **réussi**.
- Suite complète : **197 tests réussis**, 2 intégrations réelles opt-in ignorées par défaut.
- Build Vite/PWA : **réussi**, 48 entrées précachées.
- Syntaxe `hp-refresh-stack.sh` : **réussie**.
- Audit réseau P1 : **réussi**, aucune violation et routes terrain inchangées.
- `git diff --check` : **réussi**.

Le refus WebSocket Vitest sur `0.0.0.0:24678` dans le bac à sable reste non bloquant.

## Contraintes respectées

Aucun changement SQL, scoring, timer, Cloud ↔ HP, ESP32, route, structure WAL, ordre WAL, `event-box` ou `beach`.
