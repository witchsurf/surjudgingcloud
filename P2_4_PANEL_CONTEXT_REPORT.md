# Rapport P2.4a — résolution canonique du panel

## Statut

P2.4a est terminée. Un `PanelContext` pur et déterministe est disponible pour les futurs consommateurs de résultats. `DisplayPage` n'a pas été migré et P2.5 n'a pas commencé.

## Contrat créé

```ts
interface PanelContext {
  judgeCount: 3 | 5 | null;
  source: 'heat_config' | 'assignments' | 'runtime_snapshot' | 'unknown';
  message?: string;
}
```

Le champ `message` porte l'état opérateur lorsque le panel est absent, invalide ou contradictoire.

## Résolution

Les sources sont évaluées dans cet ordre :

1. `heat_configs.judges` ;
2. `heat_judge_assignments` du heat ;
3. snapshot de juges déjà chargé par le contexte d'exécution ;
4. `unknown` si aucune source explicite et cohérente n'est disponible.

Une source est cohérente uniquement si elle décrit exactement 3 ou 5 stations uniques. Les affectations doivent aussi avoir un juge et une station non vide pour chaque ligne.

Quand plusieurs sources cohérentes donnent le même nombre, la source de priorité la plus haute est retournée. Dès que deux sources se contredisent, aucune priorité silencieuse n'est appliquée : la divergence est journalisée avec le préfixe `[P2 panel context conflict]` et le résultat devient `judgeCount: null`, `source: 'unknown'`.

Une source présente mais invalide produit également un état `unknown` et un log `[P2 panel context invalid]`. Les panels 1, 2, 4 ou supérieurs à 5 ne sont jamais calculés.

`observedScoreCount` est accepté uniquement pour les diagnostics et est volontairement ignoré par l'algorithme. Le nombre de notes reçues ne peut donc jamais faire deviner un panel.

## Lecture Supabase

`fetchPanelContext(heatId, runtimeSnapshotJudges)` lit en parallèle :

- `heat_configs.judges` pour le heat demandé ;
- `heat_judge_assignments.station` et `judge_id` pour ce même heat.

Les erreurs de lecture sont journalisées localement. Le résolveur pur reçoit ensuite les sources disponibles et le snapshot d'exécution. Aucun appel Internet, changement de schéma, migration SQL ou écriture en base n'a été ajouté.

L'adaptateur n'est encore branché sur aucun écran : il prépare la reprise contrôlée de P2.4 sans modifier le comportement UI actuel.

## Fichiers créés

- `frontend/src/domain/scoring/panelContext.ts` : contrat, validation et résolution pure ;
- `frontend/src/api/modules/panelContext.api.ts` : lecture Supabase typée et non destructive ;
- `frontend/src/domain/scoring/__tests__/panelContext.test.ts` : tests de caractérisation P2.4a ;
- `P2_4_PANEL_CONTEXT_REPORT.md` : présent rapport.

## Fichiers modifiés

- `frontend/src/domain/scoring/index.ts` : export du contrat et du résolveur ;
- `frontend/src/api/supabaseClient.ts` : export de l'adaptateur et des types.

Aucune migration SQL, WAL, timer, synchronisation Cloud ↔ HP, route P1, logique ESP32, règle de scoring, ni fichier `event-box` ou `beach` n'a été modifié.

## Tests ajoutés

Douze tests couvrent :

- panel 3 issu de `heat_configs` ;
- panel 5 issu de `heat_judge_assignments` ;
- priorité de `heat_configs` lorsque les trois sources concordent ;
- conflit entre sources, journalisé puis retourné `unknown` ;
- absence de toute source ;
- historique avec 2 notes observées mais panel réel 3 ;
- historique avec 4 notes observées mais panel réel 5 ;
- fallback vers le snapshot d'exécution ;
- rejet explicite des panels 1, 2, 4 et 6.

## Résultats de validation

- `npx tsc --noEmit --pretty false` : réussi ;
- suite Vitest complète : **24 fichiers, 128 tests réussis** ;
- tests P2.4a ciblés : **12 tests réussis** ;
- build Vite/PWA : réussi, 2 360 modules transformés et 48 entrées précachées ;
- audit réseau P1 statique et runtime : réussi, aucune violation ;
- routes validées par l'audit : `/admin`, `/chief-judge` vers `/admin`, `/judge`, `/priority`, `/display` ;
- `bash -n scripts/hp-refresh-stack.sh` : réussi ;
- `git diff --check` : réussi.

Vitest affiche dans le sandbox un avertissement WebSocket `listen EPERM` sur le port HMR 24678. Il n'affecte ni l'exécution ni le résultat des 128 tests.

## Performance

Le benchmark existant du moteur P2 reste vert : 250 calculs de 360 faits en 209,54 ms, soit environ 0,84 ms par calcul. La résolution du panel est linéaire sur les quelques stations du heat et n'ajoute aucun calcul de score.

## Limites et risques ouverts

- Une panne de lecture d'une source la rend indisponible ; elle est journalisée, puis une source de priorité inférieure peut être utilisée. L'UI devra rendre visibles les erreurs réseau séparément du `PanelContext` avant la bascule de `DisplayPage`.
- Une ligne d'affectation partielle ou une configuration de taille non supportée bloque volontairement le calcul P2, même si une autre source est valide.
- Le résolveur valide la taille et l'unicité des stations, pas l'identité détaillée de chaque juge entre les sources. Le contrat demandé porte sur `judgeCount` ; une comparaison d'identités serait une extension distincte.
- L'adaptateur effectue deux lectures par heat. Avant de migrer les vues affichant plusieurs heats, il faudra privilégier le snapshot déjà chargé ou une lecture groupée afin d'éviter un N+1.
- `DisplayPage` reste en legacy tant que son appelant n'injecte pas un `PanelContext` déterministe et que le shadow mode n'a pas démontré la parité.
- La divergence PostgreSQL sur les notes `0` et deux décimales demeure documentée et inchangée.

## Condition de reprise de P2.4

La prochaine bascule peut reprendre par `DisplayPage` uniquement après branchement explicite de ce contexte, affichage de l'état `unknown`, et preuve en shadow mode qu'aucun résultat P2 n'est calculé sans panel 3/5 déterministe. `legacyScoringFacade` reste le rollback actif pendant cette étape.
