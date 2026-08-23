# P2.7.61 — Shared active-heat channel lifecycle

FIELD_HOST: `10.0.0.10`
BASELINE: `surfjudging-2026.08.14-p2.7.58-admin-reload-hydration`
JUDGE BUNDLE: `JudgePage-CCvV_kHZ.js`
SOURCE == SERVED: YES
BUNDLE MATCH: YES

CHANNEL IMPLEMENTATION: `frontend/src/lib/sharedRealtimeSubscriptions.ts`
CHANNEL KEY: `shared-active-heat-${eventId}:podium:${podiumId}` → `shared-active-heat-10:podium:B`

OWNERS: JudgePage, DisplayPage, PriorityJudgePage, OverlayPage (same registry key when mounted with same event/podium).

REF COUNT: YES — `listeners: Map<string, Listener<T>>` is the reference count.
CLEANUP SEMANTICS: release removes the listener; channel unsubscribe/removeChannel occurs only when listener count reaches zero.

CHANNEL TRACE: runtime console repeatedly reports `Shared active heat channel dropped for key 10:podium:B: CLOSED`; no application CREATE/REMOVE trace is exposed in the served build.

WHO CLOSED CHANNEL: not proven.
WHY: not proven.
APPLICATION OR TRANSPORT: application owner cleanup is statically guarded; current evidence points to transport/server lifecycle, but exact cause is not proven.

RECOVERY BEFORE FIX: `CLOSED` starts polling only when fallback is enabled; Judge B remained stale until a browser reload. No bounded resubscribe is implemented for an active consumer.

CLASSIFICATION: G — other/model incomplete (transport cause not proven)
ROOT CAUSE: shared channel reaches CLOSED without a recoverable active subscription.
ROOT CAUSE PROVEN: NO (exact closer/transport reason pending)

PRE-PATCH REGRESSION: not created; exact close origin is not yet isolated.
FIX: none.

MATRIX A-K: blocked at channel lifecycle trace; no competition mutation performed.
60S CHANNEL HEALTH: FAIL/NOT CERTIFIABLE — channel CLOSED.
LIVE POINTER: B `OPEN/R3/H2`
JUDGE: `OPEN/R3/H2` only after manual reload
DISPLAY: not tested after first lifecycle failure
JUDGE AUTO REFRESH: FAIL
DISPLAY AUTO REFRESH: not tested
30S STABILITY: not run
PUSH: none

FINAL VERDICT: BLOCKED — exact channel closer/transport cause must be proven before patching.
