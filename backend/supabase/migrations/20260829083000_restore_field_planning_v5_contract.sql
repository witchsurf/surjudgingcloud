-- Repair Field bundles that advanced their schema marker without shipping
-- 20260826200000_require_explicit_progression_edges.sql.
begin;

create or replace function public.bulk_upsert_heats_safe_v5(
  p_event_id bigint,
  p_category text,
  p_overwrite boolean default false,
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_heat_configs jsonb default '[]'::jsonb,
  p_progression_edges jsonb default '[]'::jsonb,
  p_policies jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) entry(
      heat_id text, position integer, participant_id bigint
    )
    join jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) heat(
      id text, round integer
    ) on heat.id = entry.heat_id
    where heat.round > 1
      and entry.participant_id is null
      and not exists (
        select 1
        from jsonb_to_recordset(coalesce(p_progression_edges, '[]'::jsonb)) edge(
          target_heat_id text, target_position integer
        )
        where edge.target_heat_id = entry.heat_id
          and edge.target_position = entry.position
      )
  ) then
    raise exception 'PLANNING_PROGRESS_GRAPH_INCOMPLETE: every unresolved downstream slot requires an explicit progression edge'
      using errcode = '23514';
  end if;

  perform public.bulk_upsert_heats_safe_v3(
    p_event_id, p_category, p_overwrite, p_heats, p_entries, p_mappings,
    p_participants, p_heat_configs, p_progression_edges, p_policies
  );
end;
$$;

revoke all on function public.bulk_upsert_heats_safe_v5(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.bulk_upsert_heats_safe_v5(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to anon,authenticated,service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260829083000_restore_field_planning_v5_contract',
  'Restore Field planning V5 contract',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
