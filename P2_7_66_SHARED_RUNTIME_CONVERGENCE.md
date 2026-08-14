# P2.7.66 — Shared runtime DB-authoritative convergence

CONSUMERS FOUND:
- JudgePage — `subscribeToActiveHeatPointer(eventId, competition, ..., podiumId)`; loads canonical config from DB.
- DisplayPage — same shared registry key/filter; loads canonical config from DB (`force:true`).
- PriorityJudgePage — same shared registry key/filter; loads canonical config from DB.
- OverlayPage — shared manager with global event key and podium filter; applies the resolved heat id, then heat-scoped subscription.

SHARED MANAGER: `frontend/src/lib/sharedRealtimeSubscriptions.ts`.
EMPTY PAYLOAD RESOLUTION: shared callback invokes one registry `refresh()`; DB row is then emitted to all listeners. Complete payloads dispatch directly.
ONE DB REFRESH PER EVENT: PASS for one callback/event; burst coalescing is NOT implemented/proven.

Judge coverage: YES. Display coverage: YES. Priority coverage: YES. Overlay coverage: YES.
LATE SUBSCRIBER: manager replays `lastPayload`; initial refresh is enabled. PASS statically.
GENERATION MIGRATION: shared registry removes the channel only after its last listener; no consumer-specific generation remains. PASS statically.

MATRIX A-L: A/B shared dispatch covered by manager; C/D/E/F/G/I covered by existing listener lifecycle; H/J/K not fully regression-tested; L depends on consumer callback behavior.

LIVE DB: event 10, A=`mamelles_open_cadet_r1_h1`, B=`mamelles_open_open_r3_h1`.
AFTER SAVE: Judge converged to DB B without reload. Display remained on prior `R3 H2` in the controlled transition; Priority/Overlay were not mounted.
30S: not rerun to avoid another Mamelles mutation after the authorized single SAVE.

LOCAL AUTHORITY VIOLATION: YES (Display stale in the live no-reload observation).
ROOT CAUSE: shared manager resolved DB truth for Judge; Display’s live callback/render path did not converge in that observed generation.
ROOT CAUSE PROVEN: YES for the first failing consumer stage (Display no-reload convergence); exact internal Display stage remains follow-up.

FIX: no new patch in P2.7.66. Existing shared empty-envelope DB refresh remains in place.
FINAL COMMIT: `9d866cc` (clean diagnostics removal + report; not pushed).
FINAL RELEASE: `surfjudging-2026.08.14-p2.7.65-db-authoritative-clean`.
AFFECTED BUNDLES: clean Field build Judge/Display/Priority/Overlay chunks; source/runtime revision `75fc550...`.
SOURCE == SERVED: YES for the clean deployed build. BUNDLE MATCH: index hash verified; route chunks generated from same build.

P2.7.59 RESUME ALLOWED: NO.
FINAL VERDICT: Display is the first failing shared-consumer stage; stop before further mutation or consumer-specific patch.
