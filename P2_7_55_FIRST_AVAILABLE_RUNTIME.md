# P2.7.55 — First-Available Destination Runtime Check

FIELD_HOST: `10.0.0.10`
FIELD_ADMIN_URL: `http://10.0.0.10:8080/admin?eventId=10`
SERVED RELEASE: `surfjudging-2026.08.14-p2.7.54-division-reconciliation-fix-808ca03`
SERVED REVISION: `808ca0351f0715fedb4febcff921cbfdef84e889`
ADMIN BUNDLE: `AdminPage-9nju6FLm.js`

The live pointer fixture had changed before this check:

- A = `mamelles_open_benjamin_r2_h1`
- B = `mamelles_open_open_r3_h1`

OPEN metadata remained: R2H3 open, R3H1 open, R3H2 open, R4H1 open; earlier heats closed.

Controlled UI-only navigation B BENJAMIN (2 s) → OPEN, no SAVE:

- initial OPEN state: R2/H3
- BENJAMIN: R2/H1
- OPEN settled: R2/H3, stable for 1.9 s

With the actual current B pointer on R3H1, selecting the first eligible OPEN heat yields R2H3. This is consistent with the implemented exclusion rule; it does not validate the former fixture expecting R3H2 when B owned R2H3.

STOP: do not continue without restoring/confirming the authoritative P2.7.55 fixture. No scores or heat closure were performed.

Verdict: `BLOCKED — fixture changed before destination comparison`.
