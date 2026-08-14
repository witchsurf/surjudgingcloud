# P2.7.54 — Competing Config Writer

## Runtime lock

- Source/deployed revision: `1198898085a0146c21e82f612cde7da4b07ecf5b`
- Release: `surfjudging-2026.08.13-p2.7.54-config-writer-trace-1198898`
- Diagnostic build: `AdminPage-CbhirRuG.js`
- Runtime manifest: verified by operator; revision matches source.

## Diagnostic trace

- Browser session reused on `http://10.0.0.10:8080/admin?eventId=10`.
- Transition: B `BENJAMIN` (2 s) → `OPEN`, no SAVE.
- Every observed post-transition write came from `ROUND_HEAT_RECONCILIATION`.
- First writes: R2/H1 → R2/H3 at ~0.75 s, then R2/H3 → R3/H1 at ~1.63 s.
- Thereafter the same writer alternated R3/H1 ↔ R2/H3 about every 0.78 s for >6 s.
- `configSaved` was false after the first user transition; no DB mutation occurred.
- No competing writer, hydration writer, or pointer writer was observed.

WRITER OF R2H1: ROUND_HEAT_RECONCILIATION (initial reconciliation)
WRITER OF R2H3: ROUND_HEAT_RECONCILIATION
WRITER OF R3H1: ROUND_HEAT_RECONCILIATION
FIRST POST-W2 WRITER: ROUND_HEAT_RECONCILIATION
ROOT CAUSE PROVEN: YES — pending division destination was cleared after matching once, allowing repeated reconciliation against alternating inputs.

## Patch

The pending division destination remains latched while it matches the current division; explicit round/heat edits clear it. Diagnostic instrumentation was removed before the final build.

NO SAVE / NO DB MUTATION during trace.
