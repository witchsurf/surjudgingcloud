# Checkpoint P2.4 — DisplayPage

## Statut

`DisplayPage` est migré vers le moteur partagé P2 sous contrôle du `PanelContext` canonique et du shadow mode. Aucun overlay ni autre consommateur n'a été migré dans ce lot. P2.5 n'a pas commencé.

## Comportement livré

### Résolution explicite du panel

Le direct et l'archive injectent désormais un `PanelContext` obligatoire dans `ScoreDisplay`. La taille du panel n'est plus déduite des scores dans `DisplayPage`.

Les anciens appels à `getEffectiveJudgeCount` et `calculateSurferStats` ont été supprimés des quatre chemins internes de la page :

- affichage du heat direct ou archivé ;
- résolution des rangs servant aux qualifiés ;
- reconstruction des lineups historiques ;
- calcul des meilleures notes de l'événement.

Chaque chemin appelle le moteur P2 uniquement avec un panel canonique 3 ou 5.

### Shadow mode et résultat officiel

Avec un panel déterministe :

1. la façade legacy calcule le résultat ;
2. le moteur P2 calcule le snapshot canonique ;
3. les projections sont comparées strictement ;
4. l'affichage bascule vers P2 uniquement en cas de parité exacte.

En cas de divergence, `[P2 shadow divergence]` est journalisé, aucun résultat P2 n'est affiché et les statistiques legacy restent disponibles dans la façade uniquement pour diagnostic/rollback. Elles ne sont pas présentées comme résultat officiel ambigu dans `DisplayPage`.

### États opérateur

L'alerte de l'écran distingue avec un état structuré :

- `panel_unknown` : configuration explicite absente ou résolution en cours ;
- `panel_conflict` : contradiction entre `heat_configs`, affectations et/ou snapshot runtime ;
- `network_error` : échec de lecture d'une source Supabase ;
- `shadow_issue` : divergence shadow ou note incompatible avec la politique officielle P2.

Lorsque `judgeCount` vaut `null`, le moteur P2 n'est pas exécuté et aucun total calculé n'est présenté.

## Accès Supabase et cache

`fetchPanelContexts` résout plusieurs heats avec exactement deux requêtes groupées pour les éléments non cachés :

- une lecture `.in(...)` de `heat_configs` ;
- une lecture `.in(...)` de `heat_judge_assignments`.

Le cache :

- est indexé par heat et signature du snapshot runtime ;
- déduplique les lectures concurrentes avec une promesse partagée ;
- réutilise le résultat lors des rerenders ;
- charge les historiques en batch et évite le N+1 ;
- ne conserve pas définitivement les erreurs réseau, afin qu'une nouvelle résolution explicite puisse réussir.

Le snapshot `config.judges` déjà chargé est fourni pour le heat live. Les historiques sans snapshot fiable reposent sur les sources canoniques Supabase et ne récupèrent jamais leur taille depuis les notes présentes.

## Tests ajoutés

### Rendu DisplayPage/ScoreDisplay

Huit tests d'intégration couvrent :

- panel 3 déterministe et parité exacte ;
- panel 5 déterministe avec retrait min/max ;
- panel inconnu ;
- conflit entre sources ;
- erreur réseau de lecture ;
- vague à 2 notes avec panel réel 3 : moyenne informative visible, total exclu à `0.00` ;
- vague à 4 notes avec panel réel 5 : moyenne informative visible, total exclu à `0.00` ;
- divergence shadow journalisée, sans résultat officiel ambigu.

### Cache et réseau

Trois tests couvrent :

- déduplication de lectures concurrentes et successives identiques ;
- chargement de plusieurs heats en un seul batch, sans N+1 ;
- erreur réseau transitoire non mise en cache définitivement.

Les douze tests P2.4a de résolution du panel restent également verts.

## Fichiers créés

- `frontend/src/domain/scoring/panelContextCache.ts` ;
- `frontend/src/domain/scoring/__tests__/panelContextCache.test.ts` ;
- `frontend/src/pages/__tests__/DisplayPage.p2.test.tsx` ;
- `P2_4_DISPLAY_REPORT.md`.

## Fichiers modifiés

- `frontend/src/pages/DisplayPage.tsx` ;
- `frontend/src/components/ScoreDisplay.tsx` ;
- `frontend/src/api/modules/panelContext.api.ts` ;
- `frontend/src/api/supabaseClient.ts` ;
- `frontend/src/domain/scoring/panelContext.ts` ;
- `frontend/src/domain/scoring/index.ts` ;
- `frontend/src/domain/scoring/__tests__/panelContext.test.ts`.

Aucun fichier d'overlay, `ObsOverlay`, `AdminInterface`, migration SQL, WAL, timer, flux Cloud ↔ HP, ESP32, `event-box` ou `beach` n'a été modifié.

## Validation

- `npx tsc --noEmit --pretty false` : réussi ;
- suite Vitest finale : **26 fichiers et 139 tests réussis** ;
- build Vite/PWA : réussi, 2 361 modules et 48 entrées précachées ;
- benchmark P2 final : 250 calculs de 360 faits en 294,55 ms, soit environ 1,18 ms par calcul ;
- audit réseau P1 : réussi, aucune violation statique ou runtime ;
- routes `/admin`, `/chief-judge`, `/judge`, `/priority` et `/display` : validées ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

L'avertissement Vitest `listen EPERM` sur le WebSocket HMR 24678 est propre au sandbox et n'affecte pas les résultats.

## Rollback

`legacyScoringFacade` et les statistiques legacy produites par le shadow service restent disponibles. Le rollback consiste à reconnecter explicitement cette façade au consommateur ; aucune règle legacy n'a été supprimée ou modifiée.

## Risques et limites ouverts

- Le cache n'a pas de TTL : un changement serveur du panel qui ne modifie pas le snapshot runtime nécessite un changement de heat/configuration ou un refresh de la page pour relancer la résolution. Les erreurs réseau, elles, restent retryables et ne sont pas figées dans le cache.
- Les calculs historiques sans panel canonique sont ignorés plutôt que calculés silencieusement ; cela peut laisser un qualifié ou une entrée de top notes absent jusqu'à correction de la configuration.
- Le chargement batch considère une erreur de l'une des deux tables comme une erreur réseau pour tous les heats du batch. Ce choix conservateur empêche une validation partielle trompeuse.
- La divergence PostgreSQL sur `0` et deux décimales reste ouverte, sans changement SQL.
- La validation sur le HP réel et le réseau plage reste nécessaire conformément aux réserves terrain de P1.

## Suite conditionnelle

La migration s'arrête ici. `OverlayPage`, `ObsOverlay` et les consommateurs suivants restent en legacy jusqu'à validation explicite de ce checkpoint.
