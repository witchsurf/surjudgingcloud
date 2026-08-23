begin;
alter function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
rename to bulk_upsert_planning_safe_v4_source_validated;
create or replace function public.bulk_upsert_planning_safe_v4(
 p_event_id bigint,p_category text,p_overwrite boolean default false,p_heats jsonb default '[]',p_entries jsonb default '[]',p_mappings jsonb default '[]',p_participants jsonb default '[]',p_heat_configs jsonb default '[]',p_policy jsonb default '{}')
returns void language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from (select x.source_round,x.source_heat,x.source_position,count(*) n from jsonb_to_recordset(coalesce(p_mappings,'[]')) x(source_round int,source_heat int,source_position int,placeholder text) where x.source_round is not null and coalesce(x.placeholder,'') not ilike 'Meilleur 2e%' group by 1,2,3 having count(*)>1) d) then raise exception 'duplicate source qualifier mapping'; end if;
 perform public.bulk_upsert_planning_safe_v4_source_validated(p_event_id,p_category,p_overwrite,p_heats,p_entries,p_mappings,p_participants,p_heat_configs,p_policy);
end; $$;
grant execute on function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
commit;
