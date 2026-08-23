# P2.7.49 — Post-W2 runtime writer trace

PLAYWRIGHT SESSION: REUSED

No SAVE, DB mutation, score, START or close was performed.

## LIVE TRACE (Podium B)

Transition executed: OPEN/R2/H3 → BENJAMIN (waited 2 s) → OPEN.

| sample | values (division / round / heat) |
|---:|---|
| T0 (+34 ms) | OPEN / R2 / H1 |
| +50 ms (+88 ms) | OPEN / R2 / H3 |
| +100 ms (+142 ms) | OPEN / R2 / H3 |
| +250 ms (+296 ms) | OPEN / R2 / H3 |
| +500 ms (+550 ms) | OPEN / R2 / H3 |
| +750 ms (+803 ms) | OPEN / R2 / H3 |
| +1 s (+1058 ms) | OPEN / R2 / H3 |
| +1.5 s (+1562 ms) | OPEN / R2 / H3 |
| +2 s (+2066 ms) | OPEN / R2 / H3 |
| +3 s (+3070 ms) | OPEN / R2 / H3 |
| +5 s (+5073 ms) | OPEN / R2 / H3 |

## Network correlation

Performance entries were cleared immediately before selecting OPEN. During the
transition, pointer B read completed at ~30 ms after request start; event-heats
and division-heats reads completed at ~34–52 ms; assignment reads completed at
~20–31 ms. The initial H1 value was visible before those responses completed, and
H3 appeared after the response burst. This establishes correlation with async
hydration/reconciliation timing, but not the exact JavaScript writer.

## Writer proof

W2 offline/current-source decision with pending OPEN/R3/H2 returns **R3/H2**.
W5 (`reconcileRoundHeat`) with pending `{division: OPEN, round: 3, heatId: 2}`
returns **R3/H2**; it cannot produce R2/H3 for those inputs. The active pointer B
was read during the transition, but no runtime hook exposes the post-W2 setter or
proves that pointer data directly overwrote the config.

W2 OUTPUT: OPEN/R3/H2 (offline/source model)
NEXT CONFIG VALUE: OPEN/R2/H1 then OPEN/R2/H3 in live DOM
FIRST POST-W2 WRITER: NOT PROVEN
WRITER INPUT: NOT OBSERVABLE without production instrumentation
WRITER OUTPUT: OPEN/R2/H3 observed

ACTIVE POINTER B READ BEFORE OVERWRITE: YES (correlated read; causal overwrite not proven)
W5 EXECUTED AFTER W2: NOT PROVEN
W5 OUTPUT: OPEN/R3/H2 for authoritative pending input
NETWORK RESPONSE CORRELATED: YES (timing only)

CLASSIFICATION: **G — STILL NOT PROVEN**
ROOT CAUSE PROVEN: **NO**

NO PATCH. NO SAVE. NO DB MUTATION.
