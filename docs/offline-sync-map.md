# Offline Sync Map

This document maps the current offline/local sync paths so field changes stay
intentional.

## Runtime Modes

- Cloud mode: prefer realtime events and avoid background REST polling unless an
  operator explicitly enables a polling mode.
- Local beach mode: keep polling fallbacks for judge tablets and heat state,
  because LAN WebSocket delivery can be less predictable on tablets.
- The HP local Supabase database is the event-day source of truth while on the
  beach network.

## Queues

### Score WAL: `surfJudgingOfflineWAL`

Owner: `frontend/src/stores/offlineStore.ts`

Used for:

- `scores`
- `score_overrides`

Writers:

- `ScoreRepository.saveScore`
- `ScoreRepository.overrideScore`

Replay:

- FIFO replay through `OfflineStore.processSyncQueue`.
- Replays through `offlineSyncCoordinator`.
- Guarded against concurrent replay inside the store.

### Legacy Queue: `surfapp_offline_queue`

Owner: `frontend/src/lib/supabase.ts`

Used for:

- `heats`
- `heat_configs`
- `heat_judge_assignments`
- `heat_realtime_config`
- heat config repair marker `__heat_config_repair__`

Writers:

- `HeatRepository`
- `TimerRepository`
- legacy `useSupabaseWithFallback`

Replay:

- `syncOffline()`.
- Replays through `offlineSyncCoordinator`.
- Guarded against concurrent replay.

## Replay Coordinator

Owner: `frontend/src/lib/offlineSyncCoordinator.ts`

Responsibilities:

- Installs the browser `online` / `offline` listeners.
- Replays once on startup when the browser is already online.
- Replays queues in deterministic order:
  1. legacy queue for heats/config/timer;
  2. score WAL for scores/overrides.
- Prevents concurrent global replay.
- Records replay start/success/failure in the unified operation log.

## Unified Operation Log

Owner: `frontend/src/lib/offlineOperations.ts`

Storage key: `surfJudgingOfflineOperationLog`

Purpose:

- Provide one operational view over both physical queues.
- Give every newly queued legacy operation an `operation_id`.
- Track score WAL mutations by their existing mutation ID.
- Record statuses: `queued`, `replaying`, `synced`, `failed`, `skipped`.
- Keep the log bounded to the last 120 entries so diagnostics do not grow
  indefinitely on event-day tablets.

Important rule:

- This log is diagnostic only. It must never block scoring, heat closure, replay,
  or local HP operation if localStorage is unavailable or malformed.

## Field Diagnostics Panel

Owner: `frontend/src/components/FieldDiagnosticsPanel.tsx`

Visible in the admin shell below the existing sync status.

It shows:

- Supabase mode and endpoint.
- HP/web reachability when served from a LAN host.
- Local Supabase API reachability when served from a LAN host.
- Frontend version/build identifier.
- Expected schema version (latest migration known at frontend build time).
- Installed HP schema version from `public.app_runtime_schema_version`.
- A visible mismatch warning when the HP schema does not match the frontend.
- Realtime channel state, including whether fallback polling is active.
- Browser online/offline state.
- Legacy queue count.
- Score WAL queue count.
- Total pending operations.
- Last replay status and error.
- Last five offline/replay operations.

It also exposes a manual "Rejouer les files" button that calls
`replayOfflineQueues('admin-diagnostics-manual')`.

## Realtime And Polling Rules

- Display scores in cloud mode should update from realtime score/interference
  actions, not interval polling.
- Judge tablets in cloud mode should not poll `active_heat_pointer`.
- Local beach mode now tries Supabase Realtime first for `scores`,
  `interference_calls`, `active_heat_pointer`, and `heat_realtime_config`.
- Local fallback polling is slow (`30s`) and exists only when the websocket is
  unavailable or explicitly forced by a consumer.
- Heat timer/config performs one initial REST fetch, then relies on realtime
  unless degraded fallback polling is active.

## Runtime Schema Version

Owner:

- Migration: `backend/supabase/migrations/20260523010000_add_runtime_schema_version.sql`
- Build-time expectation: `frontend/vite.config.ts`
- Runtime check: `frontend/src/lib/offlineOperations.ts`

Mechanism:

- The migration writes a singleton row in `public.app_runtime_schema_version`.
- The frontend build embeds `VITE_EXPECTED_SCHEMA_VERSION` from the latest
  migration filename.
- The field diagnostics panel compares the embedded expected version with the
  installed database version.

Operational rule:

- A schema mismatch is a terrain warning. Apply HP migrations before trusting
  newly deployed frontend behavior that depends on database changes.

## Field Smoke Test

Owner: `scripts/hp-field-smoke-test.mjs`

Purpose:

- Run a read-only browser smoke test against the HP local web app.
- Resolve a real event from local Supabase, by default `SANDY CUP`.
- Open admin, display, and judge screens.
- Fail if those screens call the cloud Supabase/project host.
- Fail on HTTP `4xx`/`5xx` responses such as the recurring
  `active_heat_pointer` `400`.
- Compare the HP runtime schema version with the latest migration known by the
  repository.
- Measure background fetches during an idle window so polling regressions are
  visible before an event.

Home profile example:

```bash
SURF_HP_PROFILE=home SURF_HP_HOST=10.0.0.14 node scripts/hp-field-smoke-test.mjs --event=SANDY\ CUP
```

Beach profile example:

```bash
SURF_HP_PROFILE=field node scripts/hp-field-smoke-test.mjs --event=SANDY\ CUP
```

The script is intentionally non-destructive: it does not submit scores, close
heats, or replay offline queues.

## Field Mutation Test

Owner: `scripts/hp-field-mutation-test.mjs`

Purpose:

- Run an isolated write-path test against the HP local stack.
- Create or reuse the technical event `FIELD SMOKE TEST`.
- Create a fresh test heat on each run so existing event data is not touched.
- Open the judge and display screens.
- Submit one real score through the judge UI.
- Verify the score is written to local Supabase and visible on display.
- Close only that generated test heat.
- Verify the judge UI blocks further scoring after closure.
- Fail if the browser calls cloud Supabase or `surfjudging.cloud`.

Home profile example:

```bash
SURF_HP_PROFILE=home SURF_HP_HOST=10.0.0.14 node scripts/hp-field-mutation-test.mjs
```

The output includes `displayRealtimeOk` and `closeRealtimeOk`. If either is
`false`, the state became correct after reload/fallback, but not through the
short realtime window. That is a useful signal for beach-mode websocket quality.

## Follow-Up Candidates

- Gradually migrate legacy queue writers to typed business operations.
- Add targeted tests for replay idempotency and duplicate online events.
