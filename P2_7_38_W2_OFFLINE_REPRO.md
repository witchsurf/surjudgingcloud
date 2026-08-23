# P2.7.38 — W2 offline reproduction

Instrumentation P2.7.37: removed from source. No `P2.7.37` or `P2.7.35-CONFIG` logging remains.

Stable releaseId: pending operator rebuild/deploy. Recommended stable diagnostic-free build: `surfjudging-2026.08.13-p2.7.36-division-handler`.
Served SHA: pending HTTP verification after operator deployment.

Current A pointer: not read in this sandbox. Current B pointer: not read in this sandbox.
OPEN metadata: not read in this sandbox. Current B config: not read in this sandbox.

W2 exact input/output (authoritative Mac capture):

- A pointer: `mamelles_open_open_r3_h1`
- B pointer: `mamelles_open_open_r2_h3`
- Current B config: `OPEN/R2/H3` (from pointer/runtime state)
- OPEN ordered metadata: R1H1–R1H5 closed; R2H1–R2H2 closed; R2H3 open; R3H1 open; R3H2 open; R4H1 open.
- W2 exclusions: normalized A `mamelles_open_open_r3_h1`, B/current `mamelles_open_open_r2_h3`.
- Candidate evaluation: R2H1/R2H2 rejected closed; R2H3 rejected active/current B; R3H1 rejected active A; R3H2 accepted; R4H1 later candidate.
- W2 output: `OPEN/R3/H2` (`mamelles_open_open_r3_h2`).

Classification: **W2 RETURNS CORRECT RESULT**
ROOT CAUSE PROVEN: NO — the live R2H3 result is produced after W2 or from a source not represented by this offline decision model.

NO PRODUCTION PATCH
NO SAVE
NO DB MUTATION

## Operator commands (Mac Field)

```bash
cd "/Users/rene/Desktop/judging 2"
SURFJUDGING_RELEASE_ID=surfjudging-2026.08.13-p2.7.36-division-handler npm --prefix frontend run build:field
rsync -a --delete frontend/dist-field/ releases/mac-runtime/current/dist/
docker restart surfjudging
curl -sS http://127.0.0.1:8080/deployment-manifest.json
```

Then capture read-only state:

```bash
docker exec surfjudging_postgres psql -At -U postgres -d postgres -c "select podium_id,active_heat_id from public.active_heat_pointer where event_id=10 order by podium_id;"
docker exec surfjudging_postgres psql -At -U postgres -d postgres -c "select id,round,heat_number,status from public.heats where event_id=10 and upper(division)='OPEN' order by round,heat_number;"
```
