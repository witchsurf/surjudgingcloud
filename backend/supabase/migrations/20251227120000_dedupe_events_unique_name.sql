-- Dedupe events by name and enforce uniqueness.
-- Keeps the lowest event id per normalized name and remaps foreign keys.

with duplicate_events as (
  select
    lower(trim(name)) as name_key,
    min(id) as keep_id,
    array_agg(id) as ids,
    count(*) as total
  from public.events
  where name is not null
  group by lower(trim(name))
  having count(*) > 1
),
dedupe_target as (
  select
    elc.event_id,
    d.keep_id,
    row_number() over (
      partition by d.keep_id
      order by elc.updated_at desc nulls last, elc.event_id desc
    ) as rn,
    exists (
      select 1 from public.event_last_config existing
      where existing.event_id = d.keep_id
    ) as keep_exists
  from public.event_last_config elc
  join public.events e on e.id = elc.event_id
  join duplicate_events d on lower(trim(e.name)) = d.name_key
)
update public.participants p
set event_id = d.keep_id
from duplicate_events d
where p.event_id = any(d.ids)
  and p.event_id <> d.keep_id;

update public.heats h
set event_id = d.keep_id
from duplicate_events d
where h.event_id = any(d.ids)
  and h.event_id <> d.keep_id;

update public.scores s
set event_id = d.keep_id
from duplicate_events d
where s.event_id = any(d.ids)
  and s.event_id <> d.keep_id;

update public.payments p
set event_id = d.keep_id
from duplicate_events d
where p.event_id = any(d.ids)
  and p.event_id <> d.keep_id;

-- Move one event_last_config row to the keep_id if needed.
update public.event_last_config elc
set event_id = dt.keep_id
from dedupe_target dt
where elc.event_id = dt.event_id
  and dt.rn = 1
  and dt.event_id <> dt.keep_id
  and dt.keep_exists = false;

-- Delete extra event_last_config rows tied to duplicate events.
delete from public.event_last_config elc
using public.events e, duplicate_events d
where elc.event_id = e.id
  and lower(trim(e.name)) = d.name_key
  and elc.event_id <> d.keep_id;

-- Remove duplicate events.
delete from public.events e
using duplicate_events d
where lower(trim(e.name)) = d.name_key
  and e.id <> d.keep_id;

-- Enforce uniqueness on normalized event name.
create unique index if not exists events_name_unique_lower
  on public.events (lower(trim(name)));
