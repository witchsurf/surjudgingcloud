-- A best eliminated qualifier is an explicit, score-resolved placeholder mapping.
-- It predates the progression-edge graph and must remain valid without inventing
-- a false winner or BYE edge.
begin;

create or replace function public.bulk_upsert_heats_safe_v5(
  p_event_id bigint, p_category text, p_overwrite boolean default false,
  p_heats jsonb default '[]'::jsonb, p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb, p_participants jsonb default '[]'::jsonb,
  p_heat_configs jsonb default '[]'::jsonb, p_progression_edges jsonb default '[]'::jsonb,
  p_policies jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_entries,'[]'::jsonb)) entry(heat_id text,position integer,participant_id bigint)
    join jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) heat(id text,round integer) on heat.id=entry.heat_id
    where heat.round > 1 and entry.participant_id is null
      and not exists (select 1 from jsonb_to_recordset(coalesce(p_progression_edges,'[]'::jsonb)) edge(target_heat_id text,target_position integer)
        where edge.target_heat_id=entry.heat_id and edge.target_position=entry.position)
      and not exists (select 1 from jsonb_to_recordset(coalesce(p_mappings,'[]'::jsonb)) mapping(heat_id text,position integer,placeholder text)
        where mapping.heat_id=entry.heat_id and mapping.position=entry.position
          and upper(trim(coalesce(mapping.placeholder,''))) ~ '^MEILLEUR[[:space:]]+[0-9]+E[[:space:]]+R[0-9]+$')
  ) then raise exception 'PLANNING_PROGRESS_GRAPH_INCOMPLETE: every unresolved downstream slot requires an explicit progression edge or best-eliminated mapping' using errcode='23514'; end if;
  perform public.bulk_upsert_heats_safe_v3(p_event_id,p_category,p_overwrite,p_heats,p_entries,p_mappings,p_participants,p_heat_configs,p_progression_edges,p_policies);
end; $$;

notify pgrst, 'reload schema';
commit;
