# Plan de Refonte Backend / Architecture (SurfJudging)

## Objectif
Résoudre le couplage lourd du frontend avec la base de données en scindant le monolithe `supabaseClient.ts` (1500+ lignes) en modules logiques, et améliorer les performances/la consistance des données en déportant les calculs lourds (génération de heat, synchro) vers des RPC Supabase (Remote Procedure Call) en SQL.

## Stratégie d'exécution
Exécution étape par étape, chaque tâche ne devant pas dépasser 2-5 minutes. Validation par tests ou compilation TypeScript avant chaque commit git.

---

### Tâche 1 : Découpage de `supabaseClient.ts` (Module Events)
1. Créer le dossier `frontend/src/api/modules/`.
2. Extraire toutes les fonctions liées aux événements (`fetchEvents`, `fetchLatestEventConfig`, `updateEventConfiguration`, etc.) vers `frontend/src/api/modules/events.api.ts`.
3. Assurer la compilation TypeScript (`npm run lint` / `tsc`).

### Tâche 2 : Découpage de `supabaseClient.ts` (Module Participants & Heats)
1. Extraire les fonctions liées aux participants (`fetchParticipants`, `upsertParticipants`) vers `frontend/src/api/modules/participants.api.ts`.
2. Extraire les requêtes des heats (`fetchHeatConfig`, `updateHeatConfig`, `deletePlannedHeats`) vers `frontend/src/api/modules/heats.api.ts`.
3. Corriger les imports dans tout le frontend (grep sur `supabaseClient.ts`).

### Tâche 3 : Découpage de `supabaseClient.ts` (Module Scoring & Temps réel)
1. Extraire la logique de score (`fetchJudgeWorkCount`, `fetchHeatScores`, Interférences) vers `frontend/src/api/modules/scoring.api.ts`.
2. Supprimer/Nettoyer le fichier `supabaseClient.ts` pour qu'il ne serve que d'entrée (export central) ou l'éliminer totalement.
3. Commit des modifications Frontend.

### Tâche 4 : Migration de logique métier vers RPC (SQL)
1. Identifier la fonction `createHeatsWithEntries` (très complexe en TS, génère presque 250 lignes de code et de multiples requêtes `await`).
2. Créer une nouvelle migration `backend/supabase/migrations/TIMESTAMP_create_heats_rpc.sql` contenant une fonction native PostgreSQL `generate_heats(event_id, config)`.
3. Modifier l'API Frontend `heats.api.ts` pour appeler cette RPC avec `supabase.rpc('generate_heats', { ... })` au lieu de boucles for.

### Tâche 5 : Tests de régression et Nettoyage
1. Vérifier la compilation globale (`npm run lint`).
2. S'assurer que le mode "Offline Local" mock toujours bien ces nouvelles API modulaires.
3. Commit et documentation.
