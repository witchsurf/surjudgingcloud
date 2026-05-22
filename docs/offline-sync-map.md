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
- Judge tablets in local beach mode may poll `active_heat_pointer` as a fallback.
- Heat timer/config keeps local polling in local mode.

## Follow-Up Candidates

- Gradually migrate legacy queue writers to typed business operations.
- Add schema-version checks between frontend and HP Supabase migrations.
- Add targeted tests for replay idempotency and duplicate online events.
