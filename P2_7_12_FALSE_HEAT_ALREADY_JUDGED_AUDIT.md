# SURFJUDGING — P2.7.12 — FALSE "HEAT ALREADY JUDGED" STATE AUDIT

Date d’audit : 2026-08-11

## 1. Scope

Audit uniquement.

Aucun patch appliqué.

Aucune note ajoutée.
Aucune clôture.
Aucune qualification.
Aucun reset manuel DB.
Aucune suppression de données Mamelles.

## 2. Persistent state preserved

Contexte certifié au départ :

- event_id = `10`
- competition = `MAMELLES OPEN`
- division = `JUNIOR`
- round = `1`
- heat = `1`
- heat_id = `mamelles_open_junior_r1_h1`
- heat.status = `open`

Scores persistés conservés :

- `J1 / CHARLES / ROUGE / V1 / 7.00`
- `J2 / J1MAIMOUNA / ROUGE / V1 / 7.50`

## 3. Browser reproduction

Reproduction Playwright read-only sur la release field active :

- release : `surfjudging-2026.08.11-p2.7.11c-admin-canonical`
- URL : `http://192.168.1.41:8080/admin?eventId=10`

État Admin observé :

- `Status Actuel : OPEN`
- résultat canonique :
  - `ROUGE Babacar Sene V1:7.25*`
- message :
  - `HEAT DÉJÀ JUGÉ - RELANCE BLOQUÉE`
- timer affiché :
  - `20:00`
- bouton principal :
  - `START`

Display observé :

- `ROUGE 7.25`

Conclusion :

- l’UI montre simultanément :
  - heat `OPEN`
  - score live correct
  - mais verrou “déjà jugé”
  - et timer revenu à `20:00`

## 4. DB state

### Heats row

```json
{
  "id": "mamelles_open_junior_r1_h1",
  "event_id": 10,
  "competition": "MAMELLES OPEN",
  "division": "JUNIOR",
  "round": 1,
  "heat_number": 1,
  "status": "open",
  "closed_at": null
}
```

### Active pointer

```json
{
  "event_id": 10,
  "podium_id": "A",
  "active_heat_id": "mamelles_open_junior_r1_h1"
}
```

### Realtime timer row

```json
{
  "heat_id": "mamelles_open_junior_r1_h1",
  "status": "paused",
  "timer_start_time": null,
  "timer_duration_minutes": 0,
  "updated_by": "admin"
}
```

### Readiness RPC

```json
{
  "status": "open",
  "can_close": false,
  "summary": {
    "score_count": 2,
    "missing_score_count": 1,
    "missing_lineup_count": 0,
    "expected_judges": 3,
    "assigned_judges": 3,
    "invalid_score_count": 0,
    "orphan_score_count": 0
  }
}
```

Blocker retourné :

- `MISSING_SCORES`
- score manquant :
  - `J3 / JKHADIJA / ROUGE / V1`

### Heat history

`heat_history` pour `mamelles_open_junior_r1_h1` :

- aucune ligne trouvée

Conclusion DB :

- le heat n’est ni closed ni historiquement archivé ;
- il reste actif sur le podium A ;
- il est métierement incomplet ;
- le faux état “already judged” ne vient pas de la readiness métier ni de `heat_history`.

## 5. Exact UI trigger

Source du message :

- fichier : `frontend/src/components/AdminInterface.tsx`
- zone : panneau “Heat déjà jugé - relance bloquée”

Condition directe :

```ts
const currentHeatAlreadyRan =
  stableHeatLocked ||
  isCurrentHeatFinished ||
  timerHasExpired ||
  (currentHeatHasScores && !timer.isRunning && !timer.startTime);

const heatRejudgeProtected = currentHeatAlreadyRan && !rejudgeOverrideActive;
```

Raison affichée dans le cas actuel :

```ts
(currentHeatHasScores && !timer.isRunning && !timer.startTime) ? 'scores' : null
```

Texte rendu :

```ts
`Ce heat contient déjà ${currentHeatScoreCount} note(s), mais il n'est plus en cours.`
```

## 6. Why the current state matches that condition

Valeurs observées / déduites pour l’état courant :

- `currentHeatHasScores = true`
  - 2 notes persistées
- `timer.isRunning = false`
- `timer.startTime = null`
- `isCurrentHeatClosed = false`
- `isCurrentHeatFinished = false`
- `can_close = false`

Donc la branche fautive déclenche même si le heat est simplement incomplet :

```ts
currentHeatHasScores && !timer.isRunning && !timer.startTime
```

## 7. Why the timer became "not in progress"

Cause amont prouvée :

- `heat_realtime_config` contient :
  - `status = paused`
  - `timer_start_time = null`
  - `timer_duration_minutes = 0`

Source de cette valeur :

- `frontend/src/hooks/useCompetitionTimer.ts`

À l’expiration du timer :

```ts
const expiredTimer: HeatTimer = {
  isRunning: false,
  startTime: null,
  duration: 0
};
setHeatStatus('paused');
publishTimerPause(currentHeatId, 0);
```

Donc, quand le chrono arrive à terme :

- le système bascule volontairement le heat en `paused`
- avec `startTime = null`
- et `duration = 0`

Puis l’Admin lit cette row realtime et reçoit exactement un timer “non en cours”.

## 8. Why the Admin shows 20:00 instead of 00:00

Le visuel `20:00` ne vient pas de la DB.

La DB temps réel est à `0`.

Le `20:00` observé provient du state local/store par défaut :

- `frontend/src/stores/judgingStore.ts`
  - `DEFAULT_TIMER_STATE.duration = 20`
- `frontend/src/pages/AdminPage.tsx`
  - avant réception complète de l’état realtime, l’Admin repart en état local `waiting`
- `frontend/src/components/AdminInterface.tsx`
  - le panneau chrono affiche `floatingTimeLeft` basé sur `timer.duration`

Conclusion :

- le faux verrouillage vient du timer “non en cours”
- le faux affichage `20:00` est un effet secondaire de réinitialisation/fallback UI locale
- ce sont deux symptômes liés, mais pas la même source immédiate

## 9. Short-id / canonical-id audit

Pour le heat courant, les requêtes observées sont canoniques :

- `scores?heat_id=eq.mamelles_open_junior_r1_h1`
- `heat_entries?heat_id=eq.mamelles_open_junior_r1_h1`
- `v_heat_lineup?heat_id=eq.mamelles_open_junior_r1_h1`
- `heat_slot_mappings?heat_id=eq.mamelles_open_junior_r1_h1`
- `heat_realtime_config?heat_id=eq.mamelles_open_junior_r1_h1`
- `heats?id=eq.mamelles_open_junior_r1_h1`

Aucune collision `r1_h1` n’a été observée pour la logique du heat courant pendant cet audit.

## 10. Root cause

Cause racine prouvée :

1. le timer du heat a expiré auparavant ;
2. l’expiration publie volontairement :
   - `status = paused`
   - `timer_start_time = null`
   - `timer_duration_minutes = 0`
3. l’Admin contient une règle UI trop agressive :

```ts
has scores + timer not running + no startTime => heat already ran
```

Cette règle est fausse pour un heat terrain incomplet :

- un heat peut avoir des scores partiels
- et un timer expiré / pausé
- sans être clôturé ni “déjà jugé”

## 11. Final verdict

Le faux état `HEAT DÉJÀ JUGÉ - RELANCE BLOQUÉE` n’est pas causé par :

- `heats.status`
- `active_heat_pointer`
- `heat_history`
- la readiness de clôture
- une collision short-id/canonical-id

Il est causé par une logique UI fautive dans `AdminInterface.tsx` :

```ts
(currentHeatHasScores && !timer.isRunning && !timer.startTime)
```

combinée à un état timer réel de fin/expiration :

```text
paused + timer_start_time=null + duration=0
```

Le problème est donc prouvé et prêt pour un patch ciblé dans le chantier suivant.
