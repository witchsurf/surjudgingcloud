-- Cleanup performance-query debt found after the initial index hardening passes.
-- Keep this conservative: only drop indexes that are covered by newer composites,
-- and debounce the local judge-accuracy materialized-view refresh.

begin;

-- scores(heat_id, created_at) was added twice under different names. Keep the
-- first name used by the realtime/accuracy migration and drop the later twin.
do $$
begin
  if to_regclass('public.idx_scores_heat_id_created_at') is not null then
    drop index if exists public.idx_scores_heat_created_at;
  end if;
end $$;

-- The composite score timeline index covers heat_id-only lookups while also
-- serving the dominant ORDER BY created_at reads.
do $$
begin
  if to_regclass('public.idx_scores_heat_id_created_at') is not null then
    drop index if exists public.idx_scores_heat_id;
  end if;
end $$;

-- heat_entries(heat_id, position) covers heat_id-only access and the ordered
-- lineup reads used by judge/display screens.
do $$
begin
  if to_regclass('public.idx_heat_entries_heat_id_position') is not null then
    drop index if exists public.idx_heat_entries_heat_id;
    drop index if exists public.heat_entries_heat_id_idx;
  end if;
end $$;

-- Queue every request, but avoid refreshing the materialized judge-accuracy
-- summary after every local score write. Field scoring must stay fast; accuracy
-- reporting can tolerate a short delay.
create or replace function public.trg_queue_accuracy_summary_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_refreshed_at timestamp with time zone;
begin
  insert into public.materialized_view_refresh_queue (view_name, last_refresh_requested_at)
  values ('v_event_judge_accuracy_summary', now())
  on conflict (view_name) do update
    set last_refresh_requested_at = now()
  returning last_refreshed_at into v_last_refreshed_at;

  if public.is_local_database()
     and (
       v_last_refreshed_at is null
       or v_last_refreshed_at < now() - interval '60 seconds'
     )
     and pg_try_advisory_xact_lock(hashtext('v_event_judge_accuracy_summary_refresh'))
  then
    perform public.refresh_judge_accuracy_summary();
  end if;

  return null;
end;
$$;

grant execute on function public.trg_queue_accuracy_summary_refresh() to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260708000000_cleanup_performance_query_debt',
  'Cleanup duplicate performance indexes and debounce local accuracy refresh',
  now()
)
on conflict (id) do update
set
  schema_version = excluded.schema_version,
  schema_label = excluded.schema_label,
  updated_at = now();

commit;
