begin;
create or replace function public.bulk_upsert_planning_safe_v4(
  p_event_id bigint,p_category text,p_overwrite boolean default false,
  p_heats jsonb default '[]'::jsonb,p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,p_participants jsonb default '[]'::jsonb,
  p_heat_configs jsonb default '[]'::jsonb,p_policy jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_ids text[];
begin
  select coalesce(array_agg(x.id),'{}') into v_ids from jsonb_to_recordset(coalesce(p_heats,'[]')) x(id text);
  if exists (select 1 from jsonb_to_recordset(coalesce(p_mappings,'[]')) x(heat_id text,source_round int,source_heat int,source_position int,position int)
    where x.heat_id is null or x.position<1 or x.source_round is not null and (x.source_heat is null or x.source_position is null)
      or x.source_round is not null and not exists (select 1 from jsonb_to_recordset(coalesce(p_heats,'[]')) s(round int,heat_number int) where s.round=x.source_round and s.heat_number=x.source_heat)) then
    raise exception 'invalid or missing source heat mapping';
  end if;
  perform public.bulk_upsert_planning_safe_v4(p_event_id,p_category,p_overwrite,p_heats,p_entries,p_mappings,p_participants,p_heat_configs,p_policy);
end; $$;
commit;
