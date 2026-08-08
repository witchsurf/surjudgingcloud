# Checkpoint P2.4 — OverlayPage et ObsOverlay

## Statut

`OverlayPage` et `ObsOverlay` sont migrés vers le résultat canonique P2. Ce lot s'arrête aux overlays : `AdminInterface` n'a pas été migré et P2.5 n'a pas commencé.

## Architecture livrée

### OverlayPage

`OverlayPage` orchestre désormais :

1. la résolution du heat affiché ;
2. le `PanelContext` canonique via `getCachedPanelContexts` ;
3. les interférences effectives du heat ;
4. le calcul legacy et P2 en shadow mode ;
5. la transmission du `HeatResultSnapshot` uniquement après parité exacte.

La valeur historique `DEFAULT_CONFIG.judges = ['J1', 'J2', 'J3']` reste nécessaire à la forme du config visuel, mais elle n'est plus une source métier implicite. Le fallback `runtime_snapshot` est fourni seulement quand un tableau `judges` existe réellement dans l'URL, localStorage ou le snapshot realtime. Avec un heat Supabase actif, `heat_configs` et `heat_judge_assignments` restent les sources prioritaires.

### Garde partagé overlay

`resolveOverlaySnapshot` encapsule le garde commun :

- `judgeCount: null` : aucun appel au moteur, snapshot nul et état opérateur explicite ;
- panel 3 ou 5 : exécution de `calculateShadowHeatResult` ;
- parité exacte : exposition du snapshot P2 ;
- divergence ou note officielle invalide : snapshot nul et message opérateur.

Le shadow service conserve le résultat legacy pour diagnostic et rollback. Une divergence continue d'être journalisée avec `[P2 shadow divergence]`.

### ObsOverlay

`ObsOverlay` est devenu un composant de présentation du `HeatResultSnapshot`. Il ne reçoit plus les scores bruts et ne calcule plus :

- moyenne de vague ;
- trim min/max ;
- deux meilleures vagues ;
- total ;
- rang ;
- pénalités.

Il lit directement :

- `competitor.total` ;
- `competitor.rank` ;
- `competitor.bestWaveNumbers` ;
- `wave.average` ;
- `competitor.interferenceType`.

Le besoin de score reste une projection d'affichage future calculée depuis le snapshot officiel ; il ne modifie ni le résultat du heat ni son classement.

## Panel et réseau

Les overlays réutilisent exactement le cache P2.4a/P2.4 DisplayPage :

- cache par heat et signature du snapshot runtime ;
- déduplication des promesses concurrentes ;
- lectures Supabase batch de `heat_configs` et `heat_judge_assignments` ;
- aucune déduction depuis le nombre de scores ;
- erreurs réseau non figées définitivement dans le cache.

Un rerender, le polling localStorage OBS ou deux résolutions concurrentes ne déclenchent pas de lectures supplémentaires lorsque le heat et le snapshot sont identiques.

## Interférences

Les votes sont chargés avec l'API existante, transformés une seule fois en interférences effectives avec le panel canonique, puis injectés dans le shadow service. `ObsOverlay` reçoit seulement la pénalité déjà intégrée au snapshot.

L'état des interférences est indexé par `heatId::judgeCount`. Une valeur chargée pour un ancien heat ou un ancien panel ne peut donc pas être appliquée transitoirement au heat courant.

## États opérateur

L'overlay présente une alerte structurée pour :

- panel inconnu ;
- conflit de panel ;
- panel invalide ;
- erreur réseau de lecture du panel ;
- divergence shadow ;
- note incompatible avec la politique officielle P2.

Dans tous ces cas, aucune ligne de résultat P2 n'est présentée comme officielle.

## Tests ajoutés

Neuf tests spécifiques couvrent :

- overlay panel 3 ;
- overlay panel 5 avec trim min/max ;
- panel inconnu ;
- conflit entre sources ;
- divergence shadow journalisée ;
- vague incomplète visible dans le snapshot mais totalisée à zéro ;
- interférence `INT1` déjà appliquée au total canonique ;
- ex æquo conservant le classement actuel ;
- cache partagé sans N+1.

Le contrat de route ajoute également `/overlay` à la vérification automatisée des routes existantes.

## Fichiers créés

- `frontend/src/domain/scoring/overlaySnapshot.ts` ;
- `frontend/src/pages/__tests__/Overlays.p2.test.tsx` ;
- `P2_4_OVERLAYS_REPORT.md`.

## Fichiers modifiés

- `frontend/src/pages/OverlayPage.tsx` ;
- `frontend/src/components/ObsOverlay.tsx` ;
- `frontend/src/domain/scoring/index.ts` ;
- `frontend/src/api/modules/panelContext.api.ts` : fallback runtime uniquement lorsque Supabase est réellement configuré ;
- `frontend/src/__tests__/fieldRoutes.test.ts` : protection de la route `/overlay`.

`AdminInterface`, les migrations SQL, la WAL, le timer métier, Cloud ↔ HP, l'ESP32, `event-box` et `beach` n'ont pas été modifiés.

## Validation finale

- TypeScript `tsc --noEmit` : réussi ;
- Vitest : **27 fichiers, 149 tests réussis** ;
- tests overlays ciblés : **9/9 réussis** ;
- build Vite/PWA : réussi, 2 362 modules et 48 entrées précachées ;
- benchmark P2 : 250 calculs de 360 faits en 180,83 ms, soit environ 0,72 ms par calcul ;
- audit réseau P1 : réussi, aucune violation statique ou runtime ;
- contrat de route `/overlay` : réussi ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

L'avertissement Vitest `listen EPERM` sur le WebSocket HMR 24678 provient du sandbox et n'affecte aucun test.

## Rollback

`legacyScoringFacade` reste intacte derrière `calculateShadowHeatResult`. Aucun calcul legacy n'a été supprimé. Le rollback reste une reconnexion explicite de cette façade au consommateur overlay.

## Risques et limites ouverts

- Le cache de panel reste sans TTL : un changement serveur non reflété dans le snapshot runtime nécessite un changement de heat/configuration ou un refresh.
- En mode OBS purement local, un config historique sans champ `judges` explicite produit maintenant volontairement `panel_unknown` au lieu d'inventer trois juges.
- Une erreur de lecture des interférences conserve le comportement existant de repli sans interférence et est journalisée. Un état opérateur dédié aux interférences pourrait être ajouté dans un lot séparé si ce risque doit devenir bloquant.
- L'audit runtime P1 visite les routes terrain officielles mais pas `/overlay`; la présence de `/overlay` est protégée par le test de route et le build. Un smoke test OBS réel reste nécessaire.
- La divergence PostgreSQL sur `0` et deux décimales demeure ouverte, sans changement SQL.

## Suite conditionnelle

La migration s'arrête ici. `AdminInterface` ne doit commencer qu'après validation explicite de ce rapport.
