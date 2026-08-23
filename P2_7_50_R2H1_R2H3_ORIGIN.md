# P2.7.50 — R2H1 → R2H3 origin

NO PATCH. NO SAVE. NO DB MUTATION.

## Live

Current Playwright session reused. Podium B transition BENJAMIN (2 s) → OPEN:

- FIRST VALUE = `OPEN/R2/H1` at +34 ms
- SECOND VALUE = `OPEN/R2/H3` at +88 ms, stable through +5 s

The Round and Heat controls are controlled selects: their `value` is derived
from the Admin config; the DOM values therefore represent two successive config
states, not browser-only defaults.

## R2H1 candidates

Current source `AdminInterface.handleConfigChange` (around line 2230) chooses a
planned available heat and writes `onConfigChange({ ...config, division, round,
heatId })`; the current checked-in source would exclude closed and active-pointer
heats. The served bundle is older and does not contain the current
`reconcileRoundHeat`/pending-selection implementation. Thus the exact old
branch producing R2H1 is not present in the audited source, but the stale served
bundle is proven capable of the first value.

R2H1 SOURCE PROVEN: **YES, as stale served-runtime behavior**.

## R2H3 candidates / response content

The B pointer response explicitly returned:
`mamelles_open_open_r2_h3`.
The OPEN heats response returned R2H3/R3H1/R3H2/R4H1 open, with R1 and R2H1–H2
closed. The pointer is read-only in Admin’s direct effect; no source-level
`setConfig` call consuming it was proven during this transition. R2H3 is therefore
correlated with pointer/hydration timing, but the exact second writer is not proven.

R2H3 SOURCE PROVEN: **NO**.

## Bundle identity

- SERVED RELEASE: `surfjudging-2026.08.13-p2.7.36-division-handler`
- SERVED SHA: `42492e080cf5926c3bd6a2719994d38f9a0272a0`
- SERVED Admin chunk: `assets/AdminPage-BXaETlou.js`
- Served chunk contains `active_heat_pointer`, but not `reconcileRoundHeat`.
- SOURCE HEAD: `42492e080cf5926c3bd6a2719994d38f9a0272a0`
- Working tree: `AdminInterface.tsx` is modified and `reconcileRoundHeat.ts` is untracked.
- SOURCE == SERVED: **NO** (same SHA label, but served artifact predates current uncommitted source).

FIRST WRITER: stale served division-selection branch (R2H1)
SECOND WRITER: pointer-correlated restore path (exact setter not proven; response contains R2H3)

CLASSIFICATION: **A — STALE SERVED BUNDLE**
ROOT CAUSE PROVEN: **YES** for the runtime/source mismatch; **NO** for the exact R2H3 setter.
