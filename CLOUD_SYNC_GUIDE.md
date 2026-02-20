# 🌐 Cloud Event Sync Guide

## Overview

This runbook defines the **robust Cloud -> Local sync protocol** used by the app (`frontend/src/utils/syncCloudEvents.ts`) for offline/LAN operations.

It covers:
- pre-flight checks
- sync execution
- post-sync validation
- incident handling

---

## Sync Scope (Current)

Synced from Cloud to Local:
- `events`
- `participants`
- `heats`
- `heat_entries`
- `heat_slot_mappings`
- `scores`
- `event_last_config`
- local cache (`surfjudging_cloud_events`, `surfjudging_cloud_participants`, `surfjudging_last_sync`)

Not synced:
- browser-only runtime state (UI flags, local temporary form values)
- live in-memory timer state unless persisted in DB

---

## 1) Pre-flight (Mandatory)

### 1.1 Environment Variables

In `.env.local`, verify:

```env
VITE_SUPABASE_URL_LAN=http://192.168.x.x:8000
VITE_SUPABASE_ANON_KEY_LAN=...

VITE_SUPABASE_URL_CLOUD=https://<cloud-project>.supabase.co
VITE_SUPABASE_ANON_KEY_CLOUD=...
```

### 1.2 Local DB Schema & Policies

Run once on local DB:

```sql
-- backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql
```

This script:
- relaxes cloud/local mismatch constraints used in offline mode
- enables permissive local RLS policies for sync-critical tables

### 1.3 App Mode

- LAN/Local mode must target local Supabase (`supabase_mode=local` or cloud lock active)
- user must have a valid cloud session before clicking sync

---

## 2) Execution Protocol

### Preferred path (UI)

1. Go to `/my-events`
2. Authenticate cloud account if prompted
3. Click `🌐 Sync depuis Cloud`
4. Wait until sync completes

### Manual fallback (console)

```javascript
import('/src/utils/syncCloudEvents.ts').then(async (m) => {
  const events = await m.syncEventsFromCloud('your-email@example.com');
  console.log('Synced events:', events.length);
});
```

---

## 3) Robustness Built In

The sync pipeline now includes:
- explicit column selection (no blind `select *`)
- retry with exponential backoff for remote fetch/upsert (`withRetry`)
- FK-safe ordering:
  1. `events`
  2. `participants`
  3. `heats`
  4. `heat_entries` (replace by heat)
  5. `heat_slot_mappings` (replace by heat)
  6. `scores`
  7. `event_last_config` (+ RPC fallback)
- normalized payload values for schema drift tolerance
- partial-failure diagnostics (`Sync local partiel: ...`)

---

## 4) Post-sync Validation Checklist

Run these checks on local DB after sync:

```sql
-- Counts by table
select
  (select count(*) from events) as events_count,
  (select count(*) from participants) as participants_count,
  (select count(*) from heats) as heats_count,
  (select count(*) from heat_entries) as heat_entries_count,
  (select count(*) from heat_slot_mappings) as mappings_count,
  (select count(*) from scores) as scores_count;
```

```sql
-- Orphans check (must be 0)
select count(*) as orphan_entries
from heat_entries e
left join heats h on h.id = e.heat_id
where h.id is null;

select count(*) as orphan_mappings
from heat_slot_mappings m
left join heats h on h.id = m.heat_id
where h.id is null;
```

```sql
-- Event snapshot exists
select event_id, event_name, division, round, heat_number, updated_at
from event_last_config
order by updated_at desc
limit 10;
```

UI checks:
- events visible in `/my-events`
- selecting event opens correct round/heat
- display/judge pages show names (not only placeholders) when data exists

---

## 5) Incident Playbook

### Error: `Sync local partiel: ...`

1. Read first failing step in message (`events`, `participants`, `heats`, `scores`, etc.)
2. Re-run `backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql`
3. Re-run sync
4. If still failing, inspect table-specific policy/constraint

### Error: cloud auth/session invalid

- re-authenticate cloud user from `/my-events`
- retry sync

### Error: network (`Failed to fetch`)

- check internet for cloud and LAN reachability for local Supabase
- retry (sync already retries transient failures internally)

---

## 6) Recovery / Re-sync

If local DB is inconsistent:

1. Keep cloud as source of truth
2. Re-apply `FIX_LOCAL_SYNC_SCHEMA.sql`
3. Trigger sync again from `/my-events`
4. Run post-sync validation queries

Optional cache reset:

```javascript
localStorage.removeItem('surfjudging_cloud_events');
localStorage.removeItem('surfjudging_cloud_participants');
localStorage.removeItem('surfjudging_last_sync');
```

---

## Quick Reference

| Action | Command / Path |
|---|---|
| Apply local schema fix | `backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql` |
| Trigger sync | `/my-events` -> `🌐 Sync depuis Cloud` |
| Manual sync | `syncEventsFromCloud('email')` |
| Validate cache timestamp | `localStorage.getItem('surfjudging_last_sync')` |
| Validate table counts | SQL checks in section 4 |
