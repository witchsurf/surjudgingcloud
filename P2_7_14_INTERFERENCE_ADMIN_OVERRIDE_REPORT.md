# P2_7_14_INTERFERENCE_ADMIN_OVERRIDE_REPORT

## A. Scope

Functional add-on executed on August 11, 2026 during:

- Event: `MAMELLES OPEN`
- `event_id = 10`
- Division: `JUNIOR`
- Round 1 / Heat 1
- `heat_id = mamelles_open_junior_r1_h1`

Constraint preserved:

- no event cleanup
- no backup restore
- no SQL direct write
- no REST direct write for score creation/interference/override actions

## B. Starting state

Certified pre-run state before P2.7.14 writes:

- `heat.status = open`
- persisted scores:
  - J1 / CHARLES / ROUGE / V1 / `7.00`
  - J2 / J1MAIMOUNA / ROUGE / V1 / `7.50`
  - J3 / JKHADIJA / ROUGE / V1 / `8.00`

Already certified from P2.7.13:

- no false `HEAT DÉJÀ JUGÉ`
- `FERMER LE HEAT` remained the only authoritative closure path

## C. Product behavior identified before action

### Interference contract actually implemented

From code and live UI:

- each judge may declare an interference independently from the Judge UI
- calls are persisted in `interference_calls`
- the decision becomes effective by majority
- with 3 judges, threshold = `2/3`
- `INT1` means second best scoring wave is halved (`B/2`)
- `INT2` means second best scoring wave is zeroed (`B=0`)
- two effective interferences on the same surfer lead to `DSQ`
- Admin and Display derive the scoring consequence from the canonical scoring engine

Relevant code:

- [frontend/src/utils/interference.ts](/Users/rene/Desktop/judging%202/frontend/src/utils/interference.ts)
- [frontend/src/domain/scoring/engine.ts](/Users/rene/Desktop/judging%202/frontend/src/domain/scoring/engine.ts)
- [frontend/src/components/JudgeInterface.tsx](/Users/rene/Desktop/judging%202/frontend/src/components/JudgeInterface.tsx)

### Admin score override contract actually implemented

From code and live UI:

- Admin correction panel works on an already selected source score
- move workflow uses `applyScoreCorrectionSecure(...)`
- override chronology is expected through `score_overrides`
- UI exposes a real move action:
  - `Déplacer la note sélectionnée`

Relevant code:

- [frontend/src/components/AdminInterface.tsx](/Users/rene/Desktop/judging%202/frontend/src/components/AdminInterface.tsx)
- [frontend/src/api/modules/scoring.api.ts](/Users/rene/Desktop/judging%202/frontend/src/api/modules/scoring.api.ts)

## D. Exact BLUE scenario feasibility

Requested exact scenario:

```text
ROUGE V3 → BLEU V4
```

Result on `R1 H1`:

- `BLUE` was not part of the active lineup
- actual active surfers were:
  - `ROUGE`
  - `BLANC`
  - `JAUNE`

Therefore:

```text
EXACT ROUGE V3 → BLEU V4 test
DEFERRED TO FINAL BECAUSE BLUE IS NOT IN R1 H1
```

Per explicit operator authorization, a fallback live move test was then attempted on:

```text
ROUGE V3 → JAUNE V4
```

## E. Real browser contexts used

Playwright contexts used during the live workflow:

- ADMIN
- J1
- J2
- J3
- DISPLAY

Browser executable:

```text
/Users/rene/Library/Caches/ms-playwright/chromium-1208/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

Supporting scripts used:

- [scripts/p2_7_14_functional_run.mjs](/Users/rene/Desktop/judging%202/scripts/p2_7_14_functional_run.mjs)
- [scripts/p2_7_14_admin_override_only.mjs](/Users/rene/Desktop/judging%202/scripts/p2_7_14_admin_override_only.mjs)

## F. R1 H1 scoring completed for the test

The real Judge UI was used to complete the planned R1 H1 scoring up to the override source note.

Persisted scores:

### ROUGE — Babacar Sene

- V1:
  - J1 `7.00`
  - J2 `7.50`
  - J3 `8.00`
  - average `7.50`
- V2:
  - J1 `6.00`
  - J2 `6.50`
  - J3 `7.00`
  - average `6.50`
- V3 source note for override test:
  - J1 `4.00`

### BLANC — Mouhamed Diawara

- V1:
  - J1 `6.00`
  - J2 `6.50`
  - J3 `7.00`
  - average `6.50`
- V2:
  - J1 `5.50`
  - J2 `6.00`
  - J3 `6.50`
  - average `6.00`

### JAUNE — Buye Assane Gueye

- V1:
  - J1 `5.00`
  - J2 `5.50`
  - J3 `6.00`
  - average `5.50`
- V2:
  - J1 `4.50`
  - J2 `5.00`
  - J3 `5.50`
  - average `5.00` before interference effect

## G. Interference test

### Surfer

- `JAUNE / Buye Assane Gueye`

### Workflow

Real Judge UI workflow used.

No SQL insert.
No REST direct write.

Judges involved:

- J1 / CHARLES
- J2 / J1MAIMOUNA

Action:

- both judges declared `INT1` on `JAUNE / vague 2`

### Persisted state

Persisted in `interference_calls`:

- J1 / `JAUNE` / wave `2` / `INT1`
- J2 / `JAUNE` / wave `2` / `INT1`

Canonical keys confirmed:

- `heat_id = mamelles_open_junior_r1_h1`
- surfer = `JAUNE`
- wave = `2`

No contamination observed on:

- `ROUGE`
- `BLANC`

### Scoring effect

Observed business effect:

- majority reached: `2/3`
- effective interference type: `INT1`
- JAUNE V2 changed from `5.00` to `2.50`
- JAUNE total changed from `10.50` to `8.00`

### Admin result

Observed in Admin snapshot:

- JAUNE penalty displayed as `INT1 (1)`
- JAUNE waves shown as `V1:5.50 V2:2.50`
- total shown as `8.00`

### Display result

Observed in Display:

- `INT1 · V2`
- JAUNE total shown as `8.00`

### PASS / FAIL

```text
PASS
```

## H. Admin score override

### Original score

- judge: `CHARLES`
- source surfer: `ROUGE`
- source wave: `V3`
- value: `4.00`

### Destination

Requested exact scenario:

- `ROUGE V3 → BLEU V4`

Not executable on R1 H1 because BLUE was not in the current heat.

Fallback explicitly approved by operator:

- `ROUGE V3 → JAUNE V4`

### Override method

Real Admin correction workflow used:

- open `6. CORRECTION DE NOTES`
- select judge `CHARLES`
- select surfer `ROUGE`
- select wave `3`
- use move panel
- destination surfer `JAUNE`
- destination wave `4`
- click `Déplacer la note sélectionnée`

No SQL direct write.
No REST direct write.

### DB before

Before the move attempt:

- source present: `ROUGE / V3 / 4.00`
- destination absent: `JAUNE / V4`
- no active move applied yet

### Exact live result

UI result after the click:

```text
Impossible de déplacer la note.
```

Exact frontend error captured:

```text
TypeError: crypto.randomUUID is not a function
```

Additional live evidence during the same workflow:

- Admin warning:
  - `score_overrides indisponible pour ce heat, scores conservés`
- DB/API direct read on `score_overrides` returned:
  - `42501 permission denied for table score_overrides`

### DB after

Observed result after failure:

- source still present: `ROUGE / V3 / 4.00`
- destination still absent: `JAUNE / V4`
- no moved score visible in Admin
- no moved score visible in Display

### Duplicate check

- source supprimée/remplacée: `NON`
- destination présente: `NON`
- doublon actif: `NON`

### Admin

Admin remained on the same heat and displayed the failure state:

- current score still selected as `4.00`
- move controls still visible
- error banner/message:
  - `Impossible de déplacer la note.`

### Display

No change after the failed move:

- ROUGE still showed V3 `4.00`
- JAUNE still had no V4 score

### PASS / FAIL

```text
FAIL
```

## I. Heat state after both subtests

Confirmed after the live run:

- `heat.status = open`
- no automatic heat closure
- no false `HEAT DÉJÀ JUGÉ`

## J. Screenshots and artifacts

Interference/scoring artifacts:

- [artifacts/p2_7_14_functional/admin_after_primary_scoring.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_functional/admin_after_primary_scoring.png)
- [artifacts/p2_7_14_functional/display_after_primary_scoring.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_functional/display_after_primary_scoring.png)
- [artifacts/p2_7_14_functional/admin_after_interference.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_functional/admin_after_interference.png)
- [artifacts/p2_7_14_functional/display_after_interference.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_functional/display_after_interference.png)
- [artifacts/p2_7_14_functional/j1_after_interference.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_functional/j1_after_interference.png)
- [artifacts/p2_7_14_functional/j2_after_interference.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_functional/j2_after_interference.png)

Override artifacts:

- [artifacts/p2_7_14_override_only/admin_before.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_override_only/admin_before.png)
- [artifacts/p2_7_14_override_only/admin_after.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_override_only/admin_after.png)
- [artifacts/p2_7_14_override_only/display_before.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_override_only/display_before.png)
- [artifacts/p2_7_14_override_only/display_after.png](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_override_only/display_after.png)
- [artifacts/p2_7_14_override_only/run.json](/Users/rene/Desktop/judging%202/artifacts/p2_7_14_override_only/run.json)

## K. Problems discovered

### CRITICAL — Chief Judge move/override workflow blocked in competition

The live Admin move workflow failed during real use on August 11, 2026 with:

```text
TypeError: crypto.randomUUID is not a function
```

Impact:

- Chief Judge cannot complete the real move/replace workflow in this runtime
- correction of a wrongly assigned wave/lycra is blocked in live competition conditions

### MAJOR — `score_overrides` access still broken in local Admin workflow

Observed live:

- `42501 permission denied for table score_overrides`
- Admin warning:
  - `score_overrides indisponible pour ce heat, scores conservés`

Impact:

- override chronology is not readable from Admin in the current local field context
- this may hide auditability or contribute to degraded correction workflows

## L. Preserved data

Intentionally preserved:

- all persisted R1 H1 scores
- all judge identities
- all interference calls
- current heat configuration
- current ranking state
- current heat open status

Explicitly not done:

- no heat close
- no cleanup
- no restore
- no manual DB repair after failure

## M. Final verdict

```text
P2.7.14 PARTIALLY COMPLETED
```

Summary:

- Interference live workflow on `JAUNE / V2` was successfully executed and verified end-to-end
- Exact `ROUGE V3 → BLEU V4` scenario was not executable on `R1 H1` because BLUE was not part of the heat
- Explicitly approved fallback `ROUGE V3 → JAUNE V4` was attempted through the real Admin workflow
- The move failed with a real runtime blocker:
  - `TypeError: crypto.randomUUID is not a function`
- `score_overrides` also remained unreadable in local Admin context with:
  - `42501 permission denied for table score_overrides`
