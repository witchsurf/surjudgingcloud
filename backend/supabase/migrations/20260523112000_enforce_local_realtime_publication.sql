begin;

-- Keep HP/local realtime explicit and idempotent. Some field boxes were
-- bootstrapped before every realtime publication migration had actually run.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'active_heat_pointer',
    'event_last_config',
    'heat_realtime_config',
    'heats',
    'scores',
    'score_overrides',
    'interference_calls',
    'heat_entries',
    'heat_slot_mappings'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I replica identity full', v_table);

      if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
         and not exists (
           select 1
           from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = v_table
         )
      then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end if;
  end loop;
end
$$;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260523112000_enforce_local_realtime_publication', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

commit;
