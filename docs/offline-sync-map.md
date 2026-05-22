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

## Realtime And Polling Rules

- Display scores in cloud mode should update from realtime score/interference
  actions, not interval polling.
- Judge tablets in cloud mode should not poll `active_heat_pointer`.
- Judge tablets in local beach mode may poll `active_heat_pointer` as a fallback.
- Heat timer/config keeps local polling in local mode.

## Follow-Up Candidates

- Merge both queues behind one replay coordinator.
- Add a visible field diagnostics panel for both queue lengths.
- Add targeted tests for replay idempotency and duplicate online events.
