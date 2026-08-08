# Compte rendu des tests de caractérisation P0

Date : 5 août 2026.

## Périmètre

Cette intervention ajoute uniquement des tests. Aucun module métier, schéma Supabase, flux terrain, dépendance ou règle de calcul n'a été modifié. Electron, SQLite et le remplacement de Supabase restent hors périmètre.

## Fichiers de tests

- `frontend/src/utils/__tests__/scoring.test.ts` : 10 tests de caractérisation ajoutés.
- `frontend/src/lib/__tests__/offlineSyncCoordinator.test.ts` : 2 tests ajoutés.
- `frontend/src/hooks/__tests__/useCompetitionTimer.test.tsx` : 3 tests ajoutés.

La suite passe de 40 à 55 tests.

## Comportements figés

### Scoring

- À 3 juges, les trois notes 6, 7 et 8 donnent une vague complète à 7.
- À 5 juges, les notes 2, 5, 6, 7 et 10 perdent 2 et 10, puis donnent 6.
- En cas d'égalité au minimum ou au maximum, une seule occurrence de chaque extrême est retirée :
  - `2, 2, 5, 7, 9` donne 4,67 ;
  - `2, 5, 8, 9, 9` donne 7,33 ;
  - `2, 2, 5, 9, 9` donne 5,33.
- Les moyennes sont arrondies à deux décimales avant le total. Les vagues 6,17, 8,17 et 7,17 produisent un total des deux meilleures de 15,34.
- Une vague à 2/3 ou 4/5 notes est marquée incomplète et ne contribue pas au total.
- Une correction est résolue par timestamp : la dernière note du même juge, lycra et numéro de vague gagne, indépendamment de l'ordre du tableau reçu.
- Modifier le nom de participant associé à `ROUGE` ne change ni les notes, ni les vagues, ni le total : la clé sportive reste la couleur de lycra.

### Files hors ligne

- Le coordinateur rejoue toujours la file legacy heats/config/timer avant la WAL scores/overrides.
- Deux demandes de rejeu concurrentes ne lancent qu'un seul traitement : une exécution legacy et une exécution WAL.

Ce test caractérise l'idempotence du **coordinateur pendant un rejeu en cours**. Il ne prouve pas encore l'idempotence de chaque RPC réseau après une interruption entre écriture serveur et acquittement client ; ce scénario nécessitera un test d'intégration avec Supabase local.

### Chronomètre

- Start passe à `running`, mémorise l'heure courante et publie le démarrage.
- Après cinq minutes d'un timer de vingt minutes, pause conserve quinze minutes et publie cette durée.
- Un nouveau start reprend avec ces quinze minutes restantes et une nouvelle heure de départ.
- Reset revient à vingt minutes, efface l'heure de départ, repasse le heat en `waiting` et publie le reset.
- À expiration, le timer devient `{isRunning: false, startTime: null, duration: 0}`, le heat passe à `paused` et une pause à zéro est publiée.
- Lors d'un démontage/remontage assimilé à un refresh, une valeur obsolète `surfJudgingTimer` présente dans localStorage n'écrase pas l'état du store, conformément au choix de la source Supabase/HP.

## Divergences et limites observées

1. Une vague incomplète conserve une moyenne calculée dans son objet d'affichage, mais `isComplete=false` l'exclut du classement et des deux meilleures vagues. Ce comportement est désormais figé ; la visibilité exacte dans chaque écran reste à tester en intégration UI.
2. L'expiration du chronomètre produit `paused` à zéro et ne produit ni `finished` ni fermeture du heat. C'est cohérent avec le commentaire métier actuel autorisant les notes tardives, mais différent de la machine d'état cible de la spécification.
3. Le refresh ne réhydrate volontairement pas le timer depuis localStorage. La reprise dépend donc de l'état Supabase local correctement rechargé par les autres hooks.
4. L'idempotence validée est celle du verrou en mémoire du coordinateur. Les doublons après redémarrage de tablette ou perte d'accusé serveur restent un risque d'intégration.
5. L'invariant lycra est testé au niveau du moteur de calcul. La RPC d'override de lineup et PostgreSQL devront également être couverts lors d'un test d'intégration non destructif sur une base locale isolée.

## Résultats de vérification

- `npm --prefix frontend run test -- --run` : **15 fichiers, 55 tests, tous passés**.
- `npm --prefix frontend run build` : **réussi**, 2 354 modules transformés, bundle PWA généré.
- `git diff --check` : **réussi**.

Vitest affiche dans le sandbox un avertissement non bloquant `EPERM` lors de la tentative d'ouverture du WebSocket HMR sur `0.0.0.0:24678`. Le processus termine néanmoins avec le code 0. Les avertissements IndexedDB de jsdom sont attendus : l'environnement de test utilise le repli localStorage.
