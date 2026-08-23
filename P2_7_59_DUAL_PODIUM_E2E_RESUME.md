# P2.7.59 — Judge exclusivity resume

FIELD_HOST: `10.0.0.10`
RELEASE: `surfjudging-2026.08.14-p2.7.67-display-post-dispatch-clean`
REVISION: `e19daf50f4e07bc3e0a90623fa8ad42c7ed97f58`
SOURCE == SERVED: YES (certified baseline). BUNDLE MATCH: YES.

JUDGE EXCLUSIVITY: PASS — authoritative active assignments contain no overlap.
  A=`mamelles_open_cadet_r1_h1`: CHARLES, J1MAIMOUNA, JKHADIJA.
  B=`mamelles_open_open_r3_h2`: NGALLA, MAMADOU, KHADIOU.
CONFLICT REJECTION: PASS at Admin safety gate — A judges are disabled on B. Backend rejection was not forced via an out-of-band mutation.
SAME-PODIUM CONTINUATION: NOT RUN (no successive same-podium heat was opened without a new transition).
SCORE FLOW: NOT RUN.
WAVE ORDER JUDGE: NOT RUN.
WAVE ORDER ADMIN: NOT RUN.
OVERRIDE: NOT RUN. INTERFERENCE: NOT RUN.
HEAT CLOSE: NOT RUN. QUALIFICATION: NOT RUN. NEXT HEAT: NOT RUN.
ROUND ADVANCE: NOT RUN. 30S STABILITY: NOT RUN.

FINAL DB: A=`mamelles_open_cadet_r1_h1`; B=`mamelles_open_open_r3_h2`.
ADMIN/JUDGE/DISPLAY: committed B state remains `R3H2`; no score, START, close, or additional SAVE performed.

FINAL VERDICT: STOPPED AFTER EXCLUSIVITY — no conflict exists and the UI correctly prevents selecting an A-active judge on B. Further score/close/progression tests require an explicitly selected safe competition fixture.

## Safe fixture + score E2E continuation

FIXTURE MAP: 29 event-10 heats read from DB. Closed heats with scores were classified UNSAFE; open zero-score heats were candidates. `CADET R1H2` has 3 real entries, 0 scores, 0 interference, is unowned, and has planned R2 heats.
SELECTED SAFE FIXTURE: `mamelles_open_cadet_r1_h2`, Podium B, CADET R1H2; surfers Alioune Diagne (Nielo), Ablaye Diakhate, Mohamed Thiombane; scores=0.
PRE-MUTATION SNAPSHOT: A=`mamelles_open_cadet_r1_h1`; B=`mamelles_open_open_r3_h2`; fixture OPEN; entries present; assignments B=NGALLA/MAMADOU/KHADIOU; no fixture scores/interferences.
SAME-PODIUM CONTINUATION: NOT APPLICABLE (fixture was a new B heat; same B judges were retained without cross-podium conflict).
ACTIVATION: exact Admin draft CADET/R1/H2 held stable; DB unchanged; one SAVE; B pointer committed to `mamelles_open_cadet_r1_h2`; Judge and Display converged to R1H2 without reload.
SCORE FLOW: PASS — Judge NGALLA submitted ROUGE V1=9.00; DB row has `judge_identity_id=1ef05b77-8ce6-4090-a309-96bc666af22f`, station J1; Admin and Display show the 9 value.
WAVE ORDER JUDGE: PASS at UI gate — V2/V3 controls disabled until V1; no invalid DB row created.
WAVE ORDER ADMIN: NOT RUN. OVERRIDE: NOT RUN. INTERFERENCE: NOT RUN.
PRE-CLOSE: PASS — DB status remains OPEN and score persisted; no automatic close.
CLOSE/QUALIFICATION/NEXT HEAT/ROUND ADVANCE/30S: NOT RUN; stopped before further destructive workflow steps.
FINAL DB: A=`mamelles_open_cadet_r1_h1`; B=`mamelles_open_cadet_r1_h2`.
FINAL ADMIN/JUDGE/DISPLAY: B=`CADET R1H2`; score ROUGE V1=9.00 visible in Admin/Display.
MUTATIONS PERFORMED: one B activation SAVE, one Judge score row, one Admin START required to enable scoring. No close, qualification, override, interference, or cleanup.
FINAL VERDICT: PARTIALLY COMPLETED — fixture activation and canonical score flow PASS; stopped before Admin wave-order/override/interference/close progression tests.

## Controlled multi-judge / correction / interference continuation

JUDGE LEDGER: NGALLA/J1 ROUGE V1=9.00; MAMADOU/J2=8.00; KHADIOU/J3=7.00. Three distinct canonical rows; identities/stations correct.
AGGREGATION: Admin initially displayed 8.00; Display displayed 8.00, matching the three-judge mean.
ADMIN OVERRIDE: PASS — normal Admin correction NGALLA ROUGE V1 9.00 -> 9.50. Canonical DB contains the new 9.50 row; Display converged to 8.17 (=9.50+8+7)/3.
INTERFERENCE: PASS persistence — normal Admin INT1 (B/2) on NGALLA/ROUGE/V1 created canonical `interference_calls` row (id 11, `is_head_judge=false`). Display remained 8.17; penalty effect is not visible while the wave/heat remains incomplete.
ADMIN WAVE ORDER: NOT APPLICABLE in this pass — correction UI only exposes already-recorded waves; no invalid predecessor sequence could be submitted without out-of-band mutation.
QUALIFICATION PRECONDITION: BLOCKED — CADET R1H1 remains OPEN on Podium A, CADET R1H2 has only V1 data, and no public qualification table is present in the authoritative schema listing. Expected qualifiers/destination cannot be established safely.
HEAT CLOSE: NOT PERFORMED; pre-close safety gate failed (incomplete ranking and unresolved progression contract). No additional DB mutation after interference.
FINAL CONTINUATION VERDICT: PARTIALLY COMPLETED — multi-judge aggregation, Admin correction, and interference persistence PASS; close/qualification intentionally deferred.
