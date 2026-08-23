begin;

create or replace function public.bulk_upsert_heats_safe_v3(
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
declare
  v_heat_ids text[];
begin
  if p_event_id is null or nullif(p_category, '') is null then raise exception 'event/category required'; end if;
  if jsonb_typeof(coalesce(p_progression_edges, '[]'::jsonb)) <> 'array' then raise exception 'progression_edges payload must be an array'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text,event_id bigint,division text,is_active boolean)
             where x.id is null or x.event_id is distinct from p_event_id or x.division is distinct from p_category or x.is_active is distinct from false) then
    raise exception 'heat payload event/category/is_active mismatch';
  end if;
  select coalesce(array_agg(x.id order by x.id),'{}') into v_heat_ids from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text);
  if cardinality(v_heat_ids) <> (select count(distinct x.id) from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text)) then raise exception 'duplicate heat identity'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_progression_edges,'[]'::jsonb)) x(target_heat_id text,target_position integer,source_heat text,source_round integer,target_round integer,progression_type text,event_id bigint,category text)
             where x.event_id is distinct from p_event_id or x.category is distinct from p_category or x.target_position not between 1 and 5 or x.progression_type not in ('COMPETITION_RESULT','AUTO_ADVANCE_BYE') or x.source_round >= x.target_round) then raise exception 'invalid progression edge'; end if;
  if exists (select 1 from (select x.target_heat_id,x.target_position,count(*) n from jsonb_to_recordset(coalesce(p_progression_edges,'[]'::jsonb)) x(target_heat_id text,target_position integer) group by 1,2 having count(*) > 1) d) then raise exception 'duplicate target progression slot'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_progression_edges,'[]'::jsonb)) x(target_heat_id text) where x.target_heat_id is null or not (x.target_heat_id = any(v_heat_ids))) then raise exception 'progression target heat missing'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_progression_edges,'[]'::jsonb)) x(source_heat text,progression_type text) where x.progression_type='COMPETITION_RESULT' and (x.source_heat is null or not (x.source_heat = any(v_heat_ids)))) then raise exception 'progression source heat missing'; end if;

  perform public.bulk_upsert_heats_safe_v2(p_event_id,p_category,p_overwrite,p_heats,p_entries,p_mappings,p_participants,p_heat_configs);

  insert into public.event_category_planning_config(event_id,category,base_format,transition_round,transition_format,version)
  select p_event_id,p_category,coalesce(x.base_format,'elimination'),x.transition_round,x.transition_format,coalesce(x.version,1)
  from jsonb_to_recordset(coalesce(p_policies,'[]'::jsonb)) x(base_format text,transition_round integer,transition_format text,version integer)
  on conflict(event_id,category) do update set base_format=excluded.base_format,transition_round=excluded.transition_round,transition_format=excluded.transition_format,version=excluded.version;

  delete from public.heat_progression_edges where event_id=p_event_id and category=p_category and target_heat_id = any(v_heat_ids);
  insert into public.heat_progression_edges(event_id,category,target_heat_id,target_position,source_round,source_heat,source_position,progression_type)
  select p_event_id,p_category,x.target_heat_id,x.target_position,x.source_round,x.source_heat,nullif(x.source_position,0),x.progression_type
  from jsonb_to_recordset(coalesce(p_progression_edges,'[]'::jsonb)) x(target_heat_id text,target_position integer,source_round integer,source_heat text,source_position integer,progression_type text);
end; $$;

revoke all on function public.bulk_upsert_heats_safe_v3(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.bulk_upsert_heats_safe_v3(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
commit;
