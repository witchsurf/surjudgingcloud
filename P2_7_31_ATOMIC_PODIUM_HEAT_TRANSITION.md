# P2.7.31 — Atomic podium transition

- auto-selection before: Podium B OPEN/R3 selected R3H1 (P2.7.30).
- auto-selection patch: excludes active heat IDs owned by another podium; intended B destination is R3H2.
- SAVE order before: runtime config → judge assignments → entries → snapshot.
- judge root cause: assignment trigger evaluated B's old active heat before pointer activation.
- transaction strategy: existing `activate_heat_on_podium` RPC performs panel copy and pointer activation transactionally; cross-podium trigger remains enforced.
- tests A–F: focused repository mutation/assignment tests PASS (11/11); A–F full live/database matrix not executed.
- typecheck: existing repository-wide TypeScript errors remain (baseline; no new isolated error established).
- build:field: PASS.
- runtime releaseId: `surfjudging-2026.08.13-p2.7.31-atomic-transition`.
- served SHA: `2bd718223d91d913da2be97d47c564928fecfdaf` (manifest verified over HTTP).
- live starting pointers: A=OPEN R3H1, B=OPEN R2H3 (read previously; no data changed).
- DB before (fresh): A=`mamelles_open_open_r3_h1`; B=`mamelles_open_open_r2_h3`; R3H1=`open`, active on A; R3H2=`open`, free. Active B judges: NGALLA `1ef05b77-8ce6-4090-a309-96bc666af22f`, MAMADOU `e98d47da-fee5-478b-a0cd-9365f455d5e5`, KHADIOU `65210ea2-fb72-4692-adf3-5d8b0cdcb5b5`.
- auto-selection trigger exercised: YES (temporary BENJAMIN → OPEN; intermediate SAVE: NO).
- temporary division selected: BENJAMIN.
- OPEN destination automatically selected: `mamelles_open_open_r2_h1` (R2H1), incorrect.
- fresh DB immediately after: R2H1=`closed`; R2H2=`closed`; R2H3=`open`/active B; R3H1=`open`/active A; R3H2=`open`/free; R4H1=`open`/free.
- destination free before SAVE: not applicable; auto-selection failed, so SAVE was not attempted.
- SAVE clicks: 0; first-click result: not applicable; no competition data mutation.
- commit SHA: `2bd718223d91d913da2be97d47c564928fecfdaf`.
- push: not performed (live SAVE did not pass).

VERDICT: BLOCKED (AUTO-SELECTION TEST FAIL)

## Static writer audit (P2.7.31)

| ID | Location | Trigger | Reads / source kinds | Writes | Can run after division change |
|---|---|---|---|---|---|
| W1 | AdminInterface.tsx:2209-2211 | participant metadata effect | participants PROP/ASYNC state, config STATE | division | YES |
| W2 | AdminInterface.tsx:2232-2269 | division selector | allEventHeatsMeta ASYNC DB, activePodiumPointers STATE, authoritative status REF | division/round/heat | YES |
| W3 | AdminInterface.tsx:2283 | round/heat selector | config STATE, UI event | round/heat | YES |
| W4 | AdminInterface.tsx:2957 | invalid-division effect | activeDivisionOptions DERIVED, config STATE | division | YES |
| W5 | AdminInterface.tsx:2995 | round/heat reconciliation effect | visibleRoundOptions MEMO, divisionHeatSequence ASYNC, allEventHeatsMeta ASYNC, active pointers STATE, config STATE | round/heat | YES |
| W6 | AdminInterface.tsx:2441-2446 | lineup hydration | entries ASYNC, configRef REF, configSaved STATE | lineup only | NO |
| W7 | AdminInterface.tsx:3780-3967, 4083, 5104 | judge/lineup controls | config STATE/props | non-heat fields (except spread) | NO |

Pure/initial decision on the authoritative Mamelles fixture: **OPEN/R3/H2**. The selector predicate excludes closed heats and both active pointers, so R3H2 is selected; it does not independently select R2H3.

Controlled deterministic callback test added at `frontend/src/components/__tests__/AdminInterface.divisionFirstAvailable.contract.test.ts`. It records one division callback: `OPEN/R3/H2`. A full mounted AdminInterface component harness was not reproducible without broad unrelated mocks; therefore no valid ordered runtime writer sequence was obtained.

WRITERS FOUND: W1-W7 above
PURE/INITIAL DECISION: OPEN/R3/H2
COMPONENT CALL SEQUENCE: controlled callback model = CALL 1 OPEN/R3/H2; mounted component sequence unavailable
FIRST OPEN VALUE: R3/H2 (model)
FINAL OPEN VALUE: unavailable in mounted component
R3H2 EVER SELECTED: YES (model)
R2H3 OVERWRITE OBSERVED: NO (valid component test)
FINAL WRITER: not proven
CLASSIFICATION: TEST MODEL INCOMPLETE
ROOT CAUSE PROVEN: NO
NO PRODUCTION PATCH
NO DB MUTATION

## Selector-fix continuation
- proven root cause: division handler used `divisionHeatSequence`/`isHeatClosed` from stale local state; a post-change effect could also reset the selection. The metadata fetch is authoritative (`heats.status`).
- old predicate: `!isHeatClosed(heat_number, round)` plus a fallback to `planned[0]`.
- new predicate: authoritative `heats.status != closed`, all active pointer IDs excluded, no unsafe first-planned fallback; a pending division selection is preserved across reconciliation.
- regression tests: 5/5 focused selector tests PASS; build/deploy PASS.
- latest release: `surfjudging-2026.08.13-p2.7.31-selector-final2`; served revision `42492e080cf5926c3bd6a2719994d38f9a0272a0`.
- live retest: temporary BENJAMIN → OPEN still did not select R3H2 (settled at OPEN R2H3); SAVE clicks 0; no DB mutation.
- commits: `2bd7182`, `47d9bf5`, `f4b81dd`, `a6a8926`, `42492e0`; push not performed.
- selector contract trace: the last confirmed state writer is the reconciliation effect at `AdminInterface.tsx` (~2964), which consumes `divisionHeatSequence`/`visibleRoundOptions` and calls `onConfigChange` after the division handler. Its stale current-division sequence preserves B's current R2H3. No SAVE was performed. Further patching is paused pending a proper timestamped instrumentation run.
- final writer trace: temporary instrumentation was not usable; the diagnostic build failed at runtime with `ReferenceError: Cannot access 'Pe' before initialization` in the Admin bundle, before the UI could execute. It was removed without commit and the stable non-instrumented runtime was restored as `surfjudging-2026.08.13-p2.7.31-selector-final3`.
- ordered writer table: unavailable; no valid trace captured. SAVE clicks: 0. No DB mutation. RACE/ORDERING ROOT CAUSE PROVEN: NO (candidate remains unconfirmed by timestamped instrumentation).
