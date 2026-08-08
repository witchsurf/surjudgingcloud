# P2.5.2b — Préservation de l’identité des scores WAL

## Conclusion

La correction rend le chemin réel de replay des scores idempotent : une mutation WAL rejoue désormais le fait initial avec son UUID et sa chronologie d’origine. Les scénarios exécutés sur la stack Supabase locale isolée produisent une seule ligne physique pour un même fait rejoué, y compris après perte d’ACK pendant le replay.

Ce lot ne modifie ni l’override, ni la structure, les clés, l’ordre ou le stockage de la WAL, ni le SQL, le scoring, le timer, Cloud ↔ HP, l’ESP32 ou les routes.

## Avant / après

Avant P2.5.2b, `scoreWalExecutor` reconstruisait une requête nominale et appelait `saveScore`. Ce chemin générait un nouvel UUID et de nouveaux timestamps à chaque replay. Une perte d’ACK pouvait donc créer plusieurs lignes physiques et rendre un ancien score artificiellement plus récent dans le LWW.

Après P2.5.2b :

- `scoreWalExecutor` transmet la mutation WAL complète au `ScoreSyncAdapter` ;
- le type guard strict valide le payload snake_case existant ;
- l’identité et la chronologie sont résolues une seule fois ;
- `ScoreRepository.replayPersistedScore` persiste le fait existant sans appeler `generateId` ni produire de date courante ;
- le chemin nominal `saveScore` reste inchangé et continue à créer un nouvel UUID et de nouveaux timestamps pour une nouvelle saisie.

## Fichiers créés et modifiés

Créés :

- `frontend/src/repositories/internal/persistedScorePayload.ts`
- `frontend/src/repositories/__tests__/persistedScorePayload.test.ts`

Modifiés :

- `frontend/src/repositories/ScoreRepository.ts`
- `frontend/src/repositories/internal/scoreSyncAdapter.ts`
- `frontend/src/stores/scoreWalExecutor.ts`
- `frontend/src/stores/__tests__/scoreWalExecutor.test.ts`
- `frontend/src/repositories/__tests__/realWalIdempotence.integration.test.ts`

## Chemin de persistance corrigé

`Judge/useScoreManager → ScoreRepository.saveScore → WAL → offlineSyncCoordinator → scoreWalExecutor → ScoreSyncAdapter → ScoreRepository.replayPersistedScore`

`replayPersistedScore` réutilise :

- `ensureHeatRowsExist` ;
- la RPC `upsert_score_secure` ;
- le fallback table déjà encapsulé par `upsertScoreSecure` lorsque la RPC est indisponible ;
- `saveScoreIDB` avec `synced = true` ;
- l’événement local `localScoresUpdated`.

Le replay ne possède pas de fallback créant une nouvelle mutation WAL : en cas d’échec ou de nouvelle perte d’ACK, la mutation originale reste dans la file.

## Résolution des anciennes WAL

Identité, par ordre de priorité :

1. `payload.id` lorsqu’il s’agit d’un UUID valide ;
2. `mutation.id` lorsqu’il s’agit d’un UUID valide ;
3. UUID déterministe versionné dérivé de `mutation.id + mutation.timestamp + heat_id + surfer + wave_number + judge_station`.

La dérivation utilise SHA-1 Web Crypto, un espace de nom logique `surfjudging-score-wal:v1`, puis applique les bits UUID version 5 et variant RFC. Deux replays de la même ancienne mutation obtiennent donc le même UUID.

Chronologie, par ordre de priorité :

- `timestamp` : `payload.timestamp`, puis `payload.created_at`, puis `mutation.timestamp` ;
- `created_at` : `payload.created_at`, puis `payload.timestamp`, puis `mutation.timestamp`.

Aucune valeur courante n’est créée silencieusement. Un payload ou une chronologie inexploitable produit `InvalidPersistedScoreMutationError`; la mutation reste en WAL et `syncError` fournit l’état opérateur.

## Résultats réels sur Supabase local

Le test `realWalIdempotence.integration.test.ts`, activé par `RUN_REAL_WAL_INTEGRATION=1`, utilise le vrai `scoreWalExecutor`, le coordinateur, la WAL et le repository. Les données sont créées sous un événement isolé puis supprimées en fin d’exécution.

Observations de l’exécution du 5 août 2026 :

| Scénario | UUID / résultat observé | Lignes physiques | WAL finale |
|---|---|---:|---:|
| A. ACK normal | `ffdc0af4-0aeb-433f-b73e-ed46f67db52a` | 1 | 0 |
| B/C. ACK perdu + double coordinateur | initial, WAL et replay : `17a9667c-98cd-42a9-b669-3d13545f0b4e` | 1 | 0 |
| D/J. Refresh, retour réseau et ACK perdu pendant replay | initial, WAL et retries : `8ad5831c-0a8d-4573-992d-94a6c4b8558a` | 1 | 0 après succès |
| E. Ancien 6 puis correction 9 | ancien : `0e4276f2-f62c-428e-aa7d-e43dc5b75b61`; correction : `60fbb45b-897a-4e71-88f9-95152aa3aa79` | 2 faits distincts | 0 |

Dans le scénario E, le replay conserve les timestamps du score 6. Le LWW sélectionne toujours la correction 9 (`60fbb45b-897a-4e71-88f9-95152aa3aa79`) : le fait ancien ne devient pas artificiellement plus récent.

La base locale ne possède pas de contrainte métier unique sur `heat_id + lycra + wave_number + judge_station`; seule la clé primaire `id` empêche le doublon du fait rejoué. Préserver cet ID est donc indispensable.

## Couverture des tests obligatoires

- A : ACK normal, une ligne.
- B : serveur écrit, ACK perdu, replay avec le même UUID et une ligne.
- C : deux appels du coordinateur, une ligne et file vide.
- D : état WAL persisté rechargé puis retour réseau, même UUID.
- E : correction plus récente à 9, replay ancien à 6, LWW reste à 9.
- F : ancienne WAL avec `payload.id` valide.
- G : ancienne WAL sans `payload.id`, mais avec `mutation.id` valide.
- H : ancienne WAL sans UUID valide, UUID déterministe stable sur deux résolutions.
- I : payload invalide conservé dans la WAL avec erreur explicite.
- J : perte d’ACK lors du replay, même UUID à chaque retry et une seule ligne physique.

## Validations

- Intégration réelle Supabase locale : **1/1 réussi**, 87,5 s.
- TypeScript `tsc --noEmit` : **réussi**.
- Suite complète : **191 tests réussis**, 1 test réel ignoré par défaut car opt-in.
- Build Vite/PWA : **réussi**, 48 entrées précachées.
- Vérification shell `hp-refresh-stack.sh` : **réussie**.
- Audit réseau P1 : **réussi**, aucune violation statique ou runtime; routes `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display` validées.
- `git diff --check` : **réussi**.

Vitest signale dans le bac à sable un refus non bloquant d’écoute WebSocket sur `0.0.0.0:24678`; tous les tests terminent néanmoins avec succès.

## Rollback

Le rollback consiste à remettre le branchement score de `scoreWalExecutor` vers l’ancien appel nominal `saveScore` et à retirer `replayPersistedScore` ainsi que le résolveur technique. Il est mécaniquement simple, mais réintroduit le risque critique P2.5.2a et ne doit être utilisé qu’en dernier recours. Aucun rollback de données ou de schéma n’est nécessaire.

## Risques ouverts

- Le chemin `score_overrides` n’a volontairement pas été modifié ni caractérisé dans ce lot. Son identité, ses timestamps et son comportement sous perte d’ACK doivent faire l’objet d’un sous-lot réel séparé avant toute conclusion d’idempotence.
- Les anciennes mutations sans chronologie exploitable restent bloquées avec une erreur opérateur au lieu d’être datées artificiellement. Une procédure d’intervention pourra être définie si de tels payloads sont observés sur le terrain.
- Le test réel reste opt-in afin de ne jamais viser involontairement une base distante; son environnement doit rester explicitement configuré sur la stack locale isolée.

P2.5.3 n’est pas commencé.
