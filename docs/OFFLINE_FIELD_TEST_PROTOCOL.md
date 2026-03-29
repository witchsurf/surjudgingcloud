# Offline Field Test Protocol

This protocol is for validating that Supabase remains the source of truth before, during, and after a real offline sequence.

## Goal

Validate that the application can:
- continue judging while disconnected
- reconnect without drifting scores, heats, assignments, timer state, or active heat pointer
- rebuild all live screens from Supabase after reconnection

## Preconditions

- Deploy the latest frontend and apply the latest Supabase migrations.
- Use a real event with:
  - at least 2 divisions
  - at least 2 heats in one division
  - at least 2 judges plus optional priority judge
- Confirm these tables are already populated for the event:
  - `events`
  - `heats`
  - `heat_configs`
  - `heat_realtime_config`
  - `participants`
  - `heat_entries` or a reproducible round-one fallback
  - `heat_judge_assignments`

## Devices

- 1 admin screen
- 2 or 3 judge screens
- 1 display screen
- optional 1 priority judge screen

Use separate browsers/profiles so local storage is isolated.

## Baseline SQL Audit

Run [AUDIT_OFFLINE_SOURCE_OF_TRUTH.sql](/Users/sandy/Desktop/judging/backend/sql/AUDIT_OFFLINE_SOURCE_OF_TRUTH.sql) before the test.

Pass criteria:
- no score/event drift rows
- no judge assignment/event drift rows
- no active heat pointer drift rows
- no duplicate heats for the target event
- no missing `heat_realtime_config` rows for heats under test

## Phase 1: Online Baseline

1. Open admin on the target event.
2. Open judge screens on the same event.
3. Open display on the same event.
4. Confirm all screens show the same:
   - event name
   - division
   - round
   - heat number
   - judge assignments
   - surfer names
5. Start the timer online.
6. Enter at least one score from one judge.
7. Confirm admin and display show the score.

## Phase 2: Offline Cut

Disconnect the network on all devices.

Do not reload yet. First validate live behavior after the network cut.

### Admin actions offline

1. Pause timer.
2. Resume timer.
3. Save heat config once.
4. Close the heat.
5. Move to the next heat.
6. Save the next heat config.

### Judge actions offline

1. Enter multiple scores on at least 2 devices.
2. Edit one score if score override workflow is available.
3. Refresh one judge page while still offline.

### Display actions offline

1. Refresh display while still offline.
2. Confirm it still rebuilds from local/snapshot state.

## Phase 3: Reconnect

Reconnect all devices.

Wait for:
- offline queue replay
- config/timer polling catch-up
- score sync completion

Do not manually refresh immediately. Give the replay time to finish first.

## Phase 4: Post-Reconnect Checks

### UI checks

Confirm on admin, judges, priority, and display:
- same active heat
- same timer state
- same surfer names
- same scores
- same judge assignments

Generate:
- heat PDF
- full competition PDF

Check:
- the closed heat appears as results, not predictions
- no missing previously scored heat
- no clipped country/color labels

### SQL checks

Run [AUDIT_OFFLINE_SOURCE_OF_TRUTH.sql](/Users/sandy/Desktop/judging/backend/sql/AUDIT_OFFLINE_SOURCE_OF_TRUTH.sql) again.

Then run this event-focused query with the tested event id:

```sql
select
  h.id,
  h.event_id,
  h.division,
  h.round,
  h.heat_number,
  h.status,
  coalesce(score_counts.score_count, 0) as score_count,
  coalesce(entry_counts.entry_count, 0) as entry_count
from public.heats h
left join (
  select heat_id, count(*) as score_count
  from public.scores
  group by heat_id
) score_counts on score_counts.heat_id = h.id
left join (
  select heat_id, count(*) as entry_count
  from public.heat_entries
  group by heat_id
) entry_counts on entry_counts.heat_id = h.id
where h.event_id = 20
order by lower(trim(coalesce(h.division, ''))), h.round, h.heat_number;
```

## Expected Pass Criteria

- offline judge scores survive reconnect
- closed heat scores remain attached to the canonical heat id
- `heat_judge_assignments.event_id` matches `heats.event_id`
- `active_heat_pointer.event_id` matches the pointed heat
- `heat_entries` are present for heats saved offline
- `event_last_config` contains surfers, surfer names, and judges for the active heat
- timer state is present in `heat_realtime_config`
- PDFs use the recovered results, not predictions, for scored heats

## Failure Patterns To Watch

### Drift

- scores visible in one screen but missing from PDF or analytics
- judge assignments present by `heat_id` but absent in admin event reports
- active heat pointer showing a heat from another event identity

### Offline replay failures

- timer state not reflected after reconnect
- heat config present but no `heat_entries`
- event loads but surfer names disappear after refresh

### Transition issues

- closing one heat advances twice
- next heat opens without realtime row
- division/round progression skips a heat

## Transition Trigger Audit

Special attention:
- only one transition trigger should be active on `public.heat_realtime_config`
- if both `trg_unified_heat_transition` and `trg_advance_on_finished` are active at the same time, transition behavior is suspect

Use the first query in [AUDIT_OFFLINE_SOURCE_OF_TRUTH.sql](/Users/sandy/Desktop/judging/backend/sql/AUDIT_OFFLINE_SOURCE_OF_TRUTH.sql) to verify this before field testing.

## Notes Template

For each test run, record:
- event id
- device count
- browser/profile used
- exact offline start time
- exact reconnect time
- heats tested
- whether pages were refreshed while offline
- whether PDFs were generated before or after reconnect
- any drift found in SQL after reconnect
