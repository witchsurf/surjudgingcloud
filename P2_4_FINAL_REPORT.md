# Rapport final P2.4 — consommateurs frontend

## Statut

Le périmètre P2.4 demandé est implémenté. `pdfExport` et la partie résultat d'un heat de `ranking.ts` consomment désormais le `HeatResultSnapshot` canonique. Aucun résultat P2 n'est exporté ou classé lorsqu'un panel déterministe 3/5 et une parité shadow exacte ne sont pas disponibles.

P2.5 n'a pas commencé.

## Consommateurs migrés pendant P2.4

- `HeatResults` ;
- `ScoreDisplay` ;
- `DisplayPage` ;
- `OverlayPage` ;
- `ObsOverlay` ;
- `AdminInterface` ;
- `pdfExport` ;
- la partie résultat d'un heat de `ranking.ts`.

Les composants migrés obtiennent moyenne, complétude, deux meilleures vagues, total, rang, pénalités et disqualification depuis le snapshot. La couleur de lycra reste l'identité sportive ; les noms, pays et participants ne sont résolus que pour l'affichage.

## Lot final : pdfExport

### Scorecard d'un heat

`exportHeatScorecardPdf` reçoit un `HeatResultSnapshot` et aucun score brut. Le tableau PDF lit exclusivement :

- `waves[].average` et `waves[].judgeScores` pour l'affichage informatif ;
- `bestWaveNumbers` pour les deux vagues retenues ;
- `total` et `rank` ;
- `interferenceType`, `interferenceCount` et `disqualified`.

Un snapshot absent bloque l'export avec l'erreur explicite `Résultat canonique indisponible : export PDF bloqué.` Il n'existe pas de repli silencieux vers un calcul local.

### Export compétition et classements PDF

Les exports complets construisent une liste de demandes par heat, résolvent les `PanelContext` en batch par le cache commun, puis appellent le shadow service partagé. La génération commence seulement si tous les heats notés concernés possèdent un snapshot canonique valide.

Cette politique est volontairement stricte : un panel inconnu, un conflit de sources, une erreur de lecture ou une divergence shadow bloque proprement l'export concerné plutôt que de produire un document partiellement ambigu.

Les heats sans aucune note ne demandent aucun calcul de résultat et restent des prévisions dans le document.

## Lot final : ranking.ts

`calculateFinalRankings` reçoit maintenant une map `heatId -> HeatResultSnapshot`. Pour chaque heat, il lit le rang, le total et la meilleure moyenne de vague depuis ce snapshot. Il ne reçoit plus les scores bruts, les appels d'interférence ou un nombre de juges et ne peut donc plus déduire un panel ni recalculer un résultat sportif.

Sont volontairement restés dans `ranking.ts`, hors du moteur de résultat d'un heat :

- résolution des participants et placeholders entre rounds ;
- progression et identification des surfeurs avancés ;
- règles de qualification ;
- rang final de compétition ;
- barème de points ;
- classement général/championnat.

L'absence de snapshot exclut le heat du calcul direct. Les chemins PDF publics utilisent en amont `requireCanonicalHeatSnapshots`, qui transforme cette absence en blocage explicite.

## PanelContext, cache et shadow mode

Le nouveau service commun `canonicalHeatSnapshots` :

1. reçoit uniquement des tailles/stations de panel explicitement configurées ;
2. résout tous les panels par `getCachedPanelContexts` en une lecture batch ;
3. applique les interférences avec le nombre canonique de juges ;
4. appelle `resolveConsumerHeatSnapshot` ;
5. ne publie le snapshot que si legacy et P2 sont strictement identiques.

La taille du panel n'est jamais déduite du nombre de notes. Les panels autres que 3 ou 5 restent non supportés et ne sont pas calculés silencieusement.

## Shadow comparisons et divergences

Le shadow service compare toujours le calcul legacy et le moteur P2 avant toute bascule. `legacyScoringFacade` reste le point de rollback et de diagnostic.

Résultats observés :

- aucune divergence sur les fixtures nominales P0/P2 pour panels 3 et 5, trim min/max, égalités min/max, arrondis, vagues incomplètes, deux meilleures vagues, interférences, disqualification, rang et invariant lycra ;
- la divergence volontaire `0` legacy contre minimum officiel `0,1` reste bloquante pour P2 ;
- la fixture volontaire avec égalité exacte `timestamp`/`created_at` détecte le tie-break déterministe par ID, journalise la divergence et bloque P2 ;
- un panel inconnu ou en conflit ne produit aucun snapshot.

## Calculs dupliqués supprimés

Dans `pdfExport.ts` et `ranking.ts`, il ne reste aucun appel à :

- `calculateSurferStats` ;
- `rankSurfers` ;
- `getEffectiveJudgeCount` ;
- `computeEffectiveInterferences` ;
- une moyenne, un trim min/max ou une somme des deux meilleures vagues à partir de scores bruts.

Les usages de `Math.max` restant dans `ranking.ts` appartiennent au classement de compétition (round final, taille de heat, meilleure valeur déjà calculée dans les vagues du snapshot) et non au calcul sportif d'une vague.

## Calculs legacy encore présents

Le code legacy n'est pas supprimé :

- `domain/scoring/legacyFacade.ts` et `utils/scoring.ts` sont conservés pour shadow mode et rollback ;
- `JudgeInterface` conserve ses diagnostics d'interférence côté saisie ;
- `useHeatManager` et `useHeatParticipants` contiennent encore des calculs historiques utilisés par des chemins d'orchestration/progression non inclus dans la migration finale `pdfExport`/`ranking.ts` ;
- les règles de progression, qualification, points et championnat restent intentionnellement dans leurs modules existants.

Ces présences ne sont pas appelées par `pdfExport` ou par la partie résultat de heat de `ranking.ts`. Elles devront être inventoriées séparément avant toute suppression de la façade legacy.

## Fichiers du lot final

### Créés

- `frontend/src/domain/scoring/canonicalHeatSnapshots.ts` ;
- `frontend/src/utils/__tests__/pdfExport.p2.test.ts` ;
- `frontend/src/utils/__tests__/p2NoDuplicateHeatScoring.test.ts` ;
- `P2_4_FINAL_REPORT.md`.

### Modifiés

- `frontend/src/domain/scoring/index.ts` ;
- `frontend/src/domain/scoring/overlaySnapshot.ts` ;
- `frontend/src/utils/pdfExport.ts` ;
- `frontend/src/utils/ranking.ts` ;
- `frontend/src/utils/__tests__/ranking.test.ts` ;
- `frontend/src/components/ScoreDisplay.tsx` : transmet le snapshot canonique au scorecard ;
- `frontend/src/components/AdminInterface.tsx` : transmet le snapshot canonique et attend les exports asynchrones.

Aucune migration SQL, WAL, logique timer, synchronisation Cloud ↔ HP, ESP32, route P1, `event-box` ou `beach` n'a été modifiée.

## Tests

Les nouveaux tests couvrent :

- export panel 3 ;
- export panel 5 ;
- vague incomplète visible et exclue du total canonique ;
- interférence ;
- disqualification ;
- ex æquo canonique ;
- blocage sans snapshot à la suite d'un panel inconnu, conflit ou divergence shadow ;
- consommation du rang, total et meilleure vague canoniques par `ranking.ts` ;
- absence de classement sans snapshot ;
- contrôle statique de l'absence de recalcul dupliqué dans les deux fichiers ;
- maintien des responsabilités progression/qualification/points hors moteur de heat.

Validation finale du dépôt frontend :

- `npx tsc --noEmit --pretty false` : réussi ;
- Vitest : **30 fichiers, 175 tests réussis** ;
- tests ciblés du lot final : **3 fichiers, 15 tests réussis** ;
- `npm run build` : réussi, 2 365 modules transformés et 48 entrées PWA précachées ;
- audit réseau P1 : réussi, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` vers `/admin`, `/judge`, `/priority`, `/display` ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

L'avertissement Vitest `listen EPERM` sur le WebSocket HMR 24678 provient du sandbox ; les tests s'exécutent et réussissent. L'audit P1 a été exécuté hors de cette restriction de port local et est vert.

## Performance

Le benchmark final mesure **250 calculs de 360 faits en 280,97 ms**, soit environ **1,12 ms par calcul P2** sur cette machine. Le shadow mode double volontairement le chemin de calcul tant que la façade legacy est active.

Pour les exports multi-heats, la résolution de panel est batchée et réutilise le cache partagé : aucune lecture Supabase par ligne, vague ou compétiteur n'est ajoutée. La génération PDF reste réalisée après résolution complète afin d'éviter un export partiel.

## Rollback

- `legacyScoringFacade` est conservée et appelée par le shadow service ;
- aucun calcul legacy n'a été supprimé de `utils/scoring.ts` ;
- chaque bascule UI reste conditionnée par `source === 'p2'`, `parity === true` et la présence d'un snapshot ;
- les exports échouent avant création du document si la condition n'est pas satisfaite.

Le rollback technique consiste à désactiver le consommateur canonique et à reconnecter explicitement la façade legacy. Il n'existe volontairement aucun rollback automatique silencieux dans un document officiel.

## Risques ouverts

- Les événements historiques sans `heat_configs`, affectations de juges ou snapshot runtime explicite ne sont pas exportables comme résultats officiels avant correction de leur métadonnée de panel.
- Le cache de panel reste sans TTL ; une modification serveur hors du flux normal peut nécessiter un changement de heat ou un refresh.
- Une erreur réseau pendant la résolution canonique bloque tout l'export multi-heats ; ce choix évite un document partiel mais devra être validé en ergonomie terrain.
- PostgreSQL accepte encore temporairement `0` et deux décimales, contrairement à la politique P2 `0,1–10,0` à une décimale.
- Les logs shadow restent principalement dans la console et ne sont pas persistés dans un journal opérateur durable.
- Les calculs historiques dans les hooks d'orchestration cités plus haut restent à auditer avant suppression future du legacy.
- Le risque R15 de restauration Supabase complète reste ouvert.
- Le smoke test sur le véritable HP, l'événement actif et le réseau Realtime plage reste requis.

## Critères de clôture P2.4

- [x] Tous les consommateurs explicitement listés pour P2.4 utilisent le snapshot canonique pour le résultat d'un heat.
- [x] `pdfExport` ne recalcule aucune règle sportive.
- [x] La partie résultat de heat de `ranking.ts` ne reçoit plus de scores bruts.
- [x] Aucun panel n'est déduit des notes reçues.
- [x] Panel inconnu, conflit, erreur réseau ou divergence empêchent un résultat P2 officiel.
- [x] Shadow mode et rollback legacy restent disponibles.
- [x] Tests P0, P1 et P2, typecheck, build et audit réseau sont verts.
- [ ] Smoke test sur le HP réel et validation Realtime sur le réseau plage.
- [ ] Validation explicite du présent rapport avant toute P2.5.

P2.4 peut être clôturée côté code sous réserve des deux validations terrain déjà ouvertes et de l'approbation de ce rapport. P2.5 n'est pas commencé.
