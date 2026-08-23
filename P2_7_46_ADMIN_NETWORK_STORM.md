# P2.7.46 — Admin network storm audit

## Scope / evidence

Lecture seule. Aucun patch de production, SAVE ou changement DB effectué.

| Famille | Source exacte | Déclencheur | Cadence conçue |
|---|---|---|---|
| `heat_judge_assignments` | `AdminInterface` effect → `panelRepository.listEventAssignments` (vers lignes 642–689) → `fetchEventJudgeAssignments` (`api/modules/heats.api.ts:453`) | `activeEventId`, `selectedPodiumId`, `podiumAssignStatus` | événementielle, pas un timer |
| `active_heat_pointer` | `AdminInterface` effect (vers lignes 728–756) | `activeEventId`, `selectedPodiumId`, `podiumAssignStatus`, `config.heatId` | événementielle, pas un timer |
| `heats` (event metadata) | `AdminInterface` effect (vers lignes 694–726) | `activeEventId`, `config.division`, `config.round`, `config.heatId` | événementielle, pas un timer |

`fetchEventJudgeAssignments` émet d’abord une lecture `heats(id)` puis une lecture
`heat_judge_assignments.in(heat_id, …)`, ce qui explique la corrélation observée.
Les lectures `heats` supplémentaires proviennent notamment de `useHeatParticipants`,
`useEventHeats` et des hooks/repositories de score; elles ne partagent pas toutes le
même appelant.

## Multiplier identifié

Le même état `podiumAssignStatus` est écrit par l’effet d’auto-affectation (vers
2810–2845) puis figure dans les dépendances des trois effets ci-dessus. Chaque
transition `info/success/error` relance donc au minimum les trois lectures. Le
changement de `activePodiumPointers` peut relancer l’auto-affectation, créant une
boucle de ré-exécution entre état de statut, lecture des pointeurs et lecture des
affectations. Ce chemin est le premier multiplicateur commun prouvé statiquement.

Autres cadences : le contrôle de santé Admin est explicitement à 15 s; les fallbacks
Realtime sont 3 s (cloud) ou 30 s (local) dans `useRealtimeSync`, et ne ciblent pas
ces trois tables ensemble. Aucun `setInterval` à 1 s n’a été trouvé dans ce chemin.

## Test ciblé

`frontend/src/components/__tests__/AdminNetworkStorm.contract.test.tsx` monte un
harness minimal de l’effet d’affectations avec fake timers 60 s. Résultat attendu et
observé : 1 lecture au montage, une seconde après la transition de statut, puis aucune
lecture supplémentaire pendant 60 s. Le test ne reproduit donc pas les milliers de
requêtes : il démontre seulement la ré-exécution par changement de statut, pas une
cadence périodique autonome.

## Config / R2H3

Ces trois effets sont des lectures; aucun ne remplace directement `config` ni
n’appelle `loadConfigFromDb`. Sur le graphe statique audité, le storm ne prouve donc
pas une restauration R2H3. Une causalité runtime entre ce storm et un writer de config
reste non démontrée.

**Classification : E — MULTIPLE INDEPENDENT POLLERS / EFFECT RE-RUNS (storm source partiellement prouvée)**

**ROOT CAUSE PROVEN: NO** — le multiplicateur commun est identifié statiquement,
mais l’ampleur continue observée (milliers) n’est pas reproduite par le test isolé.
