# SURFJUDGING — P2.7.10 — MAMELLES JUNIOR FULL RUN

Date: 2026-08-11

Verdict: `MAMELLES JUNIOR BLOCKED`

## A. Starting state

- Event: `MAMELLES OPEN`
- `event_id = 10`
- Category: `JUNIOR`
- Heat targeted: `Round 1 / Heat 1`
- Certified entry state before this run:
  - `heat_id = mamelles_open_junior_r1_h1`
  - `status = open`
  - `configSaved = true`
  - `scores = 0`

## B. Browser contexts

Playwright real browser contexts were opened independently for:

- `ADMIN`
- `J1`
- `J2`
- `J3`
- `DISPLAY`

Artifacts:

- `artifacts/p2_7_10_mamelles_junior/admin.png`
- `artifacts/p2_7_10_mamelles_junior/j1.png`
- `artifacts/p2_7_10_mamelles_junior/j2.png`
- `artifacts/p2_7_10_mamelles_junior/j3.png`
- `artifacts/p2_7_10_mamelles_junior/display.png`
- `artifacts/p2_7_10_mamelles_junior/probe.json`

Observed initial kiosk identities before first score:

- `J1 -> CHARLES`
- `J2 -> J1MAIMOUNA`
- `J3 -> JKHADIJA`

Observed initial judge session storage after login:

- `J1`
  - `authenticated_judge_id = J1`
  - `authenticated_judge_identity_id = 5164895e-51e9-42f2-9583-80a3e36cc435`
  - `kiosk_position = J1`
- `J2`
  - `authenticated_judge_id = J2`
  - `authenticated_judge_identity_id = 442df135-52cb-4037-895f-5a174de825ca`
  - `kiosk_position = J2`
- `J3`
  - `authenticated_judge_id = J3`
  - `authenticated_judge_identity_id = c724401b-46ba-4b3e-8227-d8c46110eb2e`
  - `kiosk_position = J3`

All three judge contexts showed the correct heat and lineup:

- `MAMELLES OPEN`
- `JUNIOR`
- `R1 H1`
- `ROUGE Babacar Sene`
- `BLANC Mouhamed Diawara`
- `JAUNE Buye Assane Gueye`

## C. R1 H1 scores

Only one real score was entered before stop:

- Judge UI: `J1`
- Surfer: `ROUGE / Babacar Sene`
- Wave: `1`
- Score entered: `7.0`

No direct SQL insert or REST write was used by the operator path. The score was submitted through the Judge UI keypad.

## D. R1 H1 ranking

Not completed.

Reason: after the first persisted score, the canonical Admin result stayed at `0.00` for all surfers while `/display` and the judge context showed the new score.

## E. R1 H1 qualification

Not reached.

## F. R1 H2 scores

Not reached.

## G. R1 H2 ranking

Not reached.

## H. Final qualification

Not reached.

## I. Final scores

Not reached.

## J. Final ranking

Not reached.

## K. Realtime behavior

### START

The real Admin workflow was used.

Observed result:

- the heat timer started;
- Admin switched from `START` to `PAUSE`;
- judge contexts switched to active scoring state;
- Display switched to active live state.

Evidence after start:

- `artifacts/p2_7_10_mamelles_junior/admin_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/j1_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/j2_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/j3_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/display_after_start.png`

### First submitted score

Observed timeline for the first real score:

- submit time from persisted row:
  - `2026-08-11T22:18:39.11+00:00`
- DB persistence:
  - `YES`
- Display realtime update:
  - `YES`
- Admin canonical result update:
  - `NO`
- polling fallback visible in Admin diagnostics:
  - `YES`
  - `REALTIME TABLETTES ● POLLING SECOURS`

Important divergence:

- `/display` showed `ROUGE V1 = 7.00`
- `J1` showed `ROUGE V1 = 7.0`
- Admin still showed:
  - `BLANC V1:0.00*`
  - `JAUNE V1:0.00*`
  - `ROUGE V1:0.00*`

This is consistent with an Admin-side wrong-heat/wrong-key read path:

- captured Admin requests include:
  - `/scores?heat_id=eq.r1_h1`
  - `/heat_entries?heat_id=eq.r1_h1`
- persisted score row uses:
  - `heat_id = mamelles_open_junior_r1_h1`

## L. Refresh behavior

Not executed after the first score because the run was stopped immediately after detecting the Admin canonical divergence.

## M. Offline/reconnect

Not reached.

## N. Display

Display was correct for the first score while Admin was not.

Observed on `/display` after the first score:

- heat: `MAMELLES OPEN / JUNIOR / R1 H1`
- `Babacar Sene / ROUGE / V1 = 7.00`
- the score was visible in the score grid and live section

Evidence:

- `artifacts/p2_7_10_mamelles_junior/display_after_first_score.png`

## O. Heat history

Not reached for close/qualification behavior.

## P. Database audit

Read-only confirmation for the first persisted score:

```json
{
  "id": "00000000-0000-4000-18fc-019ff2e80286",
  "event_id": 10,
  "heat_id": "mamelles_open_junior_r1_h1",
  "competition": "MAMELLES OPEN",
  "division": "JUNIOR",
  "round": 1,
  "judge_id": "J1",
  "judge_name": "CHARLES",
  "judge_station": "J1",
  "judge_identity_id": "5164895e-51e9-42f2-9583-80a3e36cc435",
  "surfer": "ROUGE",
  "wave_number": 1,
  "score": 7.00,
  "timestamp": "2026-08-11T22:18:39.11+00:00",
  "created_at": "2026-08-11T22:18:39.11+00:00"
}
```

Conclusions from this row:

- correct `event_id`: `10`
- correct `heat_id`: `mamelles_open_junior_r1_h1`
- correct station: `J1`
- correct judge identity UUID:
  - `5164895e-51e9-42f2-9583-80a3e36cc435`
- correct surfer:
  - `ROUGE`
- correct score:
  - `7.00`

So the first score persistence itself is canonical, but the Admin result view is not consuming it correctly.

## Q. Screenshots

- `artifacts/p2_7_10_mamelles_junior/admin.png`
- `artifacts/p2_7_10_mamelles_junior/j1.png`
- `artifacts/p2_7_10_mamelles_junior/j2.png`
- `artifacts/p2_7_10_mamelles_junior/j3.png`
- `artifacts/p2_7_10_mamelles_junior/display.png`
- `artifacts/p2_7_10_mamelles_junior/admin_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/j1_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/j2_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/j3_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/display_after_start.png`
- `artifacts/p2_7_10_mamelles_junior/admin_after_first_score.png`
- `artifacts/p2_7_10_mamelles_junior/j1_after_first_score.png`
- `artifacts/p2_7_10_mamelles_junior/display_after_first_score.png`

## R. Problems discovered

### CRITICAL

1. Admin canonical scoring view failed after the first persisted score.

   Evidence:

   - score persisted in DB with correct `heat_id`, `judge_station`, and `judge_identity_id`;
   - judge UI showed the score;
   - `/display` showed the score;
   - Admin stayed at `0.00` / `V1:0.00*` for every surfer.

2. Admin appears to query heat-scoped scoring with the short key `r1_h1` instead of the canonical heat id `mamelles_open_junior_r1_h1`.

   Captured request examples from Admin:

   - `/scores?heat_id=eq.r1_h1`
   - `/heat_entries?heat_id=eq.r1_h1`

   Persisted score row:

   - `heat_id = mamelles_open_junior_r1_h1`

3. Because the chief-judge canonical result stayed false while the DB and Display moved forward, continuing the category would have risked ranking corruption and invalid qualification decisions.

### MAJOR

1. Admin diagnostics degraded to `POLLING SECOURS` even though live judge/display flow continued.

### MINOR

1. Admin still logs `401 permission denied for table score_overrides` during read attempts. This was already known, but it remains noisy in the browser console.

## S. Mamelles data intentionally preserved

No cleanup, reset, delete, backup restore, or manual repair was performed.

Preserved intentional state after stop:

- `R1 H1` timer started and still running at stop time
- one real persisted score exists:
  - `J1 / CHARLES / ROUGE / wave 1 / 7.00`
- all Mamelles event data remains available for operator inspection

## T. Final verdict

`MAMELLES JUNIOR BLOCKED`

Stop reason:

The first real judge score exposed a `CRITICAL` cross-surface divergence:

- DB persistence: correct
- Judge UI: correct
- Display: correct
- Admin canonical result: incorrect / stale

Under the stop conditions, continuing toward qualification and Final would risk wrong ranking and wrong finalist propagation. Mamelles data has been preserved in-place for visual inspection.
