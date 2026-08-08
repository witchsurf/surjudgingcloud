# Checkpoint P2.4 — AdminInterface

## Statut

`AdminInterface` est migré vers le `HeatResultSnapshot` canonique pour le résultat du heat actif et pour le fallback client de propagation des qualifiés. Ses responsabilités d'orchestration restent dans le composant.

`pdfExport` et `ranking.ts` n'ont pas été migrés. P2.5 n'a pas commencé.

## Résultat du heat actif

`AdminInterface` résout désormais le panel du heat avec :

1. `PanelContext` ;
2. `panelContextCache` ;
3. le snapshot runtime des juges configurés ;
4. le shadow service commun.

Les scores bruts du heat sont transmis au shadow service afin que le moteur P2 conserve lui-même le last-write-wins `timestamp`, `created_at`, puis ID stable. Le tableau de correction legacy `mergedScores` reste séparé pour les actions opérateur et n'est pas utilisé comme source du snapshot officiel.

Les interférences sont chargées avec l'API existante, résolues avec le panel canonique, puis injectées dans le moteur. Leur état est associé à `heatId::judgeCount` pour empêcher l'application transitoire d'une pénalité provenant d'un autre heat ou panel.

## Présentation canonique

Le nouveau `AdminHeatResultSnapshotPanel` consomme uniquement le snapshot et affiche :

- moyenne de chaque vague ;
- état complet/incomplet ;
- numéros et valeurs des deux meilleures vagues ;
- total ;
- rang ;
- interférence et nombre de pénalités ;
- disqualification.

Le composant de présentation ne reçoit aucun score brut et n'effectue aucun calcul sportif. Les recherches de vagues par numéro servent uniquement à afficher les valeurs déjà désignées par `bestWaveNumbers`.

## États opérateur

Sans résultat canonique non ambigu, le panneau affiche un état structuré et aucune ligne officielle :

- `panel_unknown` ;
- `panel_conflict` ;
- `panel_invalid` ;
- `network_error` ;
- `shadow_divergence` ;
- `invalid_official_score`.

Une divergence continue d'être journalisée par `[P2 shadow divergence]`.

## Propagation des qualifiés

La propagation reste orchestrée par `AdminInterface` : lecture de la séquence, mappings, entries, mises à jour et actions opérateur n'ont pas été déplacées.

Seul son calcul de résultat a changé :

- tous les panels des heats de la séquence sont préchargés en batch via le cache partagé ;
- aucune taille de panel n'est déduite des juges présents dans les scores ;
- chaque source utilise le shadow service ;
- les rangs sont lus depuis `snapshot.competitors` ;
- sans panel ou sans parité, aucun qualifié n'est fabriqué ;
- le comportement existant de nettoyage d'un slot obsolète est conservé.

## Fermeture du heat

Un ancien fallback mort de `canCloseHeat` déduisait un panel depuis les juges observés, mais se trouvait après un retour inconditionnel et n'était jamais exécuté. Il a été supprimé sans changement de comportement : la fermeture reste autorisée dès qu'une note positive existe, tandis que les diagnostics dédiés de close-readiness gardent la responsabilité de contrôler la complétude.

L'activation, la fermeture, le timer et les actions opérateur ne sont pas entrés dans le moteur.

## Rollback

`calculateShadowHeatResult` appelle maintenant explicitement `legacyScoringFacade.calculateSurferStats`. Le rollback est donc centralisé et réactivable pour Admin, Display et overlays sans réintroduire de calcul dans les composants.

## Tests ajoutés

Douze tests Admin couvrent :

- panel 3 ;
- panel 5 avec trim min/max ;
- vague incomplète exclue du total ;
- interférence ;
- disqualification ;
- ex æquo actuel ;
- override de participant sans déplacement des scores attachés au lycra ;
- panel inconnu ;
- conflit de panel ;
- erreur réseau de lecture du panel ;
- divergence shadow journalisée ;
- absence de recalcul dupliqué dans la source `AdminInterface`.

## Fichiers créés

- `frontend/src/components/AdminHeatResultSnapshotPanel.tsx` ;
- `frontend/src/components/__tests__/AdminInterface.p2.test.tsx` ;
- `P2_4_ADMIN_REPORT.md`.

## Fichiers modifiés

- `frontend/src/components/AdminInterface.tsx` ;
- `frontend/src/domain/scoring/overlaySnapshot.ts` : ajout du nom générique `resolveConsumerHeatSnapshot`, alias overlay conservé ;
- `frontend/src/domain/scoring/shadow.ts` : branchement explicite sur `legacyScoringFacade`.

Aucune migration SQL, WAL, logique timer, priorité, override, Cloud ↔ HP, ESP32, route P1, `event-box` ou `beach` n'a été modifiée. Les actions de lineup existantes restent inchangées.

## Validation finale

- `npx tsc --noEmit --pretty false` : réussi ;
- Vitest : **28 fichiers, 161 tests réussis** ;
- tests Admin ciblés : **12/12 réussis** ;
- build Vite/PWA : réussi, 2 364 modules et 48 entrées précachées ;
- benchmark P2 final : 250 calculs de 360 faits en 314,59 ms, soit environ 1,26 ms par calcul ;
- audit réseau P1 : réussi, aucune violation statique ou runtime ;
- routes terrain P1 : validées ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

L'avertissement Vitest `listen EPERM` sur le WebSocket HMR 24678 est propre au sandbox et n'affecte pas les tests.

## Responsabilités explicitement conservées dans AdminInterface

- activation et fermeture des heats ;
- gestion et affectation du panel ;
- timer ;
- priorité ;
- overrides de scores et lineup ;
- propagation des qualifiés ;
- navigation ;
- exports et actions opérateur.

## Risques et limites ouverts

- Le cache de panel reste sans TTL ; un changement serveur non reflété dans le snapshot runtime demande un changement de heat/configuration ou un refresh.
- Une erreur de lecture des interférences conserve le repli historique sans interférence et est journalisée ; elle n'a pas encore d'état opérateur bloquant dédié.
- Le fallback client de propagation reste une voie de secours après la RPC Supabase. Une divergence ou un panel absent laisse volontairement le slot sans qualifié plutôt que d'inventer un résultat.
- Les exports PDF et le classement général utilisent encore leurs chemins legacy ; ils sont hors de ce lot conformément à la contrainte.
- La divergence PostgreSQL sur `0` et deux décimales demeure ouverte sans migration SQL.
- Le smoke test sur le HP réel et le réseau plage reste requis.

## Suite conditionnelle

La migration s'arrête ici. `pdfExport` et la partie résultat de heat de `ranking.ts` ne doivent commencer qu'après validation explicite de ce rapport.
