begin;

-- PAUSE stores the exact remaining duration in fractional minutes.  The RPC
-- already accepts numeric, but the legacy integer column rounded 02:50 back to
-- 03:00 and made RESUME restart from the full configured minute.
alter table public.heat_realtime_config
  alter column timer_duration_minutes type numeric(10, 4)
  using timer_duration_minutes::numeric(10, 4);

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260823090000_preserve_timer_pause_precision',
  'Preserve timer pause precision',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

commit;
