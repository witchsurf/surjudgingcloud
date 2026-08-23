begin;
alter function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  rename to bulk_upsert_planning_safe_v4_legacy;

create or replace function public.bulk_upsert_planning_safe_v4(
  p_event_id bigint,p_category text,p_overwrite boolean default false,
  p_heats jsonb default '[]',p_entries jsonb default '[]',p_mappings jsonb default '[]',
  p_participants jsonb default '[]',p_heat_configs jsonb default '[]',p_policy jsonb default '{}')
returns void language plpgsql security definer set search_path=public as $$
declare v_ids text[];
begin
  select coalesce(array_agg(x.id),'{}') into v_ids from jsonb_to_recordset(coalesce(p_heats,'[]')) x(id text);
  if exists(select 1 from jsonb_to_recordset(coalesce(p_mappings,'[]')) x(heat_id text,position int,source_round int,source_heat int,source_position int)
    where x.heat_id is null or not (x.heat_id=any(v_ids)) or x.position<1 or
      (x.source_round is not null and (x.source_heat is null or x.source_position is null or x.source_round>=99))) then raise exception 'invalid target or mapping shape'; end if;
  if exists(select 1 from (select x.heat_id,x.position,count(*) n from jsonb_to_recordset(coalesce(p_mappings,'[]')) x(heat_id text,position int) group by 1,2 having count(*)>1) d) then raise exception 'duplicate target mapping'; end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_mappings,'[]')) x(heat_id text,position int,source_round int,source_heat int,source_position int)
    where x.source_round is not null and not exists(select 1 from jsonb_to_recordset(coalesce(p_heats,'[]')) s(event_id bigint,division text,round int,heat_number int,heat_size int) where s.event_id=p_event_id and s.division=p_category and s.round=x.source_round and s.heat_number=x.source_heat)) then raise exception 'source heat does not exist in submitted event/category plan'; end if;
  perform public.bulk_upsert_planning_safe_v4_legacy(p_event_id,p_category,p_overwrite,p_heats,p_entries,p_mappings,p_participants,p_heat_configs,p_policy);
end; $$;
grant execute on function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
commit;
