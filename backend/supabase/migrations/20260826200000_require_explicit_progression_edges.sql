-- Future multi-round plans are graph-first.  Never rely on close-time
-- qualifier inference: every empty downstream slot needs one exact edge.
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
  -- Any unresolved slot in R2+ is sporting data, not a default/heuristic.
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
commit;
