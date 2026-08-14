# P2.7.62 — Realtime CLOSED origin trace

FIELD_HOST: `10.0.0.10`
DIAGNOSTIC COMMIT: `92e6b1f`
DIAGNOSTIC RELEASE: `surfjudging-2026.08.14-p2.7.62-realtime-origin-trace`
JUDGE BUNDLE: `JudgePage-BcwVVoTV.js`
SOURCE == SERVED: YES
BUNDLE MATCH: YES

TRACE (Judge B only):

| timestamp | generation | key | operation | owner | listeners | status |
|---|---:|---|---|---|---:|---|
| 18:26:37.484 | 1 | 10:podium:B | SUBSCRIBE_CALL / LISTENER_ADD | listener_1 | 1 | created |
| 18:26:37.535 | 1 | 10:podium:B | STATUS_SUBSCRIBED | — | 1 | SUBSCRIBED |
| 18:26:47.423 | 1 | 10:podium:B | LISTENER_REMOVE | listener_1 | 0 | active |
| 18:26:47.424 | 1 | 10:podium:B | UNSUBSCRIBE_CALL / REMOVE_CHANNEL_CALL | — | 0 | expected cleanup |
| 18:26:47.424 | 1 | 10:podium:B | STATUS_CLOSED | — | 0 | expectedClose=true |
| 18:26:47.462 | 2 | 10:podium:B | SUBSCRIBE_CALL / LISTENER_ADD | listener_2 | 1 | created |
| 18:26:47.476 | 2 | 10:podium:B | STATUS_SUBSCRIBED | — | 1 | SUBSCRIBED |

LAST HEALTHY EVENT: generation 1 `SUBSCRIBED`.
FIRST ABNORMAL EVENT: none; the close followed final-owner cleanup.
CLOSED EVENT: generation 1 at 18:26:47.424.
EXPECTED CLOSE: YES.
LISTENERS AT CLOSE: 0.
UNSUBSCRIBE BEFORE CLOSE: YES.
REMOVE_CHANNEL BEFORE CLOSE: YES (same cleanup sequence).
WEBSOCKET: no unexpected drop observed.
SERVER LOG CORRELATION: not required; application cleanup precedes close.
OTHER CHANNELS: not part of this Judge-only trace.

TEST A: Judge B only — PASS, generation 2 remained SUBSCRIBED for 60 s.
TEST B/C/D: not run; no need after exact expected cleanup was proven.

CLASSIFICATION: A — application final-owner cleanup (expected lifecycle).
ROOT CAUSE: login transition releases generation 1, then creates generation 2; no stale-generation race proven.
ROOT CAUSE PROVEN: YES for observed CLOSED origin; NO evidence of an unexpected transport close.

PRE-PATCH REGRESSION: not applicable; no lifecycle defect reproduced.
FIX: none. Temporary diagnostics removed after trace.
MATRIX A-K: not run; no production defect established.
FINAL COMMIT: pending cleanup commit.
FINAL RELEASE: restore stable P2.7.58 build.
LIVE JUDGE AUTO REFRESH: not retested in this forensic-only phase.
FINAL VERDICT: BLOCKED — P2.7.59 stale transition requires a separate reproduction while generation 2 is active.
