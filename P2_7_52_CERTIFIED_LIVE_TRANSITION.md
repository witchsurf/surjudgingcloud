# P2.7.52 — Certified live transition

RUNTIME LOCK: PASS
SERVED RELEASE: `surfjudging-2026.08.13-p2.7.51-runtime-lock-1cabd59`
SERVED REVISION: `1cabd59214dd6f2905144537908ce1f8dbaf1a5c`
ADMIN BUNDLE: `assets/AdminPage-C4XCiCec.js`

## DB before

- A = `mamelles_open_benjamin_r2_h1`
- B = `mamelles_open_open_r2_h3`
- OPEN R1H1–R1H5, R2H1–R2H2 = closed
- OPEN R2H3, R3H1, R3H2, R4H1 = open

Because A owns BENJAMIN R2H1, no OPEN heat is occupied on A. The first free
OPEN heat after excluding B's current R2H3 is **R3H1**. EXPECTED DESTINATION =
`mamelles_open_open_r3_h1`.

## Live selection

Playwright session reused. Podium B was selected; BENJAMIN was selected and held
for 2 s; performance entries were cleared; OPEN was selected; no SAVE was made.
At the final +5 s observation the controlled values were:

`OPEN / R2 / H3`

The destination remained B's currently occupied heat, so AUTO-SELECTION = FAIL.
Intermediate samples were not retained by the failed multi-sample call; the
reliable final observation is the incorrect `OPEN/R2/H3`.

Transition network responses included active pointer B, event heats, division
heats, and assignment reads. Pointer response completed at ~17 ms; assignment
reads completed at ~22 ms and ~37 ms; OPEN metadata responses completed at ~25–34
ms. No mutation request was issued.

SAVE CLICKS: 0
FIRST SAVE: NOT ATTEMPTED
JUDGE/DISPLAY: NOT TESTED
30S STABILITY: NOT TESTED

FINAL VERDICT: **B — AUTO-SELECTION FAIL**
CURRENT LOCKED RUNTIME FUNCTIONAL FAIL. No patch applied. No SAVE. No DB mutation.
