# P2.7.1 — SURF PLANNING BUSINESS RULES REGRESSION AUDIT

## A — WORKFLOW HISTORIQUE

Le workflow historique a été retrouvé dans :
- **Composant UI** : `frontend/src/components/GenerateHeatsPage.tsx`
- **Moteur de génération** : `frontend/src/utils/heatGeneration.ts`
- **Fonctionnalité** : Regroupement automatique par catégorie (`groupedParticipants`), génération de la preview globale pour toutes les catégories via `generatePreviewHeats`, puis boucle de persistance complète dans `handleConfirm`.

## B — WORKFLOW ACTUEL

Le workflow P2.7 actuel se trouve dans `frontend/src/components/PlanningImportPanel.tsx` :
- Parsing sécurisé XLSX/CSV.
- Regroupement des participants mais sélection manuelle d'une **unique catégorie** dans l'UI.
- Preview générée uniquement pour cette catégorie via `frontend/src/utils/bracket.ts`.
- Preflight `Safe v2` exécuté ciblant uniquement cette catégorie.
- Persistance atomique via `persistPlanningImportSafely`.

**Pourquoi catégorie par catégorie ?**
L'architecture Safe v2 a été conçue pour garantir l'atomicité et vérifier de manière stricte les conflits de données sportives existantes (scores, timers). Restreindre l'action à une catégorie simplifiait l'UI du preflight et réduisait le risque transactionnel lors de l'import de gros fichiers.

## C & D — CAS DE RÉFÉRENCE : 13 CADETS

**Ancienne logique métier (`heatGeneration.ts`) :**
Le générateur calculait la taille de chaque série dynamiquement en fonction du nombre de qualifiés, garantissant des heats équilibrés (ex: 4 par heat).
- 13 participants
- Round 1 : 4 heats (4 + 3 + 3 + 3) -> top 2 -> 8 qualifiés
- Round 2 : 2 heats (4 + 4) -> top 2 -> 4 qualifiés
- Finale : 4 surfeurs

**Nouvelle logique métier (`bracket.ts`) :**
Le nouveau générateur hardcode la taille du Round 2 à 3 participants (`const r2HeatSize = 3;` dans la variante V1 de `buildSingleElimNextRounds`).
- 13 participants
- Round 1 : 4 heats (4 + 3 + 3 + 3) -> top 2 -> 8 qualifiés
- Round 2 : 8 qualifiés répartis dans des heats de 3 -> `Math.ceil(8/3)` = 3 heats (3 + 3 + 2+BYE).
- Finale : Le top 2 de 3 heats donne 6 finalistes.

## E — BYE

Le concept de BYE provient du nouveau moteur `bracket.ts`. Ce moteur fonctionne comme un générateur de bracket "single elimination" générique. Lorsqu'il force des heats de taille 3, un groupe de 8 surfeurs laisse 1 place vide (3x3 = 9 slots). Le slot vide (`ref.sourceRound === 0`) est automatiquement comblé par un BYE, ce qui n'a pas de sens dans les règles historiques du surf où la taille des heats est flexible.

## F — ARCHITECTURE CIBLE À ÉVALUER

L'architecture Safe v2 (preflight + persistance atomique) est purement défensive et découplée du moteur mathématique de génération des heats. Il est tout à fait possible de :
1. Réutiliser `heatGeneration.ts` au lieu de `bracket.ts` pour générer le `ComputeResult` (en mappant son output vers l'interface requise).
2. Restaurer la boucle multi-catégories de `GenerateHeatsPage.tsx` tout en exécutant le `planningSafetyRepository.preflight` et la persistance sur l'ensemble des catégories détectées, sans perdre la protection des données.

## G — LANDING PAGE

Une ancienne landing page existe toujours : `frontend/src/components/LandingPage.tsx` accessible sur la route `/`.
**Pourquoi ne s'affiche-t-elle plus en mode Field ?**
Le script de démarrage Mac (`scripts/start-surfjudging-field-mac.sh`) indique aux opérateurs de cliquer sur `http://IP:8080/admin`. Le composant `FieldEventContextGuard` intercepte cette route (car aucun événement n'est actif au premier lancement) et redirige brutalement l'utilisateur vers `/my-events`. La route `/` n'est simplement pas le point d'entrée promu par le script.

## I — RAPPORT FINAL

HISTORICAL_WORKFLOW_FOUND = frontend/src/components/GenerateHeatsPage.tsx
HISTORICAL_HEAT_ENGINE_FOUND = frontend/src/utils/heatGeneration.ts
REGRESSION_COMMIT = 36dba46
CURRENT_ENGINE = frontend/src/utils/bracket.ts
CAUSE_13_PARTICIPANTS = Hardcoded r2HeatSize = 3 in bracket.ts (buildSingleElimNextRounds V1)
OLD_13_STRUCTURE = 13 -> 4/3/3/3 -> 8 -> 4/4 -> 4 -> finale (4)
CURRENT_13_STRUCTURE = 13 -> 4/3/3/3 -> 8 -> 3/3/2+BYE -> 6 -> finale (6)
OLD_MULTI_CATEGORY_FLOW = Boucle globale générant toutes les previews avant validation unique
CURRENT_CATEGORY_BY_CATEGORY_FLOW = Sélection unitaire via UI pour isoler le diagnostic Safe v2
OLD_LANDING_FOUND = YES (frontend/src/components/LandingPage.tsx)
SAFE_V2_REUSABLE = YES (Preflight et repository sont découplés de l'algorithme)
RECOMMENDED_RESTORATION_STRATEGY = Restaurer heatGeneration.ts avec l'interface de bracket.ts et réactiver l'import multi-catégories en bouclant le Preflight Safe v2.

RESTORE_OLD_BUSINESS_RULES_WITH_NEW_SAFE_INFRA = YES
