begin;

create or replace function public.bulk_upsert_planning_safe_v4(
  p_event_id bigint,
  p_category text,
  p_overwrite boolean default false,
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_heat_configs jsonb default '[]'::jsonb,
  p_policy jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids text[];
begin
  if p_event_id is null or nullif(trim(p_category), '') is null then raise exception 'event/category required'; end if;
  if jsonb_typeof(coalesce(p_heats,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_mappings,'[]'::jsonb)) <> 'array' then raise exception 'planning payload arrays required'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text,event_id bigint,division text,is_active boolean) where x.id is null or x.event_id is distinct from p_event_id or x.division is distinct from p_category or x.is_active is distinct from false) then raise exception 'event/category/active mismatch'; end if;
  select coalesce(array_agg(x.id order by x.id),'{}') into v_ids from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text);
  if cardinality(v_ids) <> (select count(distinct x.id) from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text)) then raise exception 'duplicate heat identity'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_heat_configs,'[]'::jsonb)) x(heat_id text) where not (x.heat_id = any(v_ids))) then raise exception 'heat/config identity mismatch'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_mappings,'[]'::jsonb)) x(heat_id text,source_round integer,source_heat integer,source_position integer,position integer) where x.heat_id is null or not (x.heat_id = any(v_ids)) or x.position < 1 or x.source_round is not null and x.source_round >= 1 and x.source_heat is null) then raise exception 'invalid slot mapping'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_heats,'[]'::jsonb)) x(id text,heat_size integer) where x.heat_size < 2) then raise exception 'single-surfer heat forbidden'; end if;

  perform public.bulk_upsert_heats_safe_v2(p_event_id,p_category,p_overwrite,p_heats,p_entries,p_mappings,p_participants,p_heat_configs);

  if jsonb_typeof(coalesce(p_policy,'{}'::jsonb)) = 'object' and p_policy <> '{}'::jsonb then
    insert into public.event_category_planning_config(event_id,category,base_format,transition_round,transition_format,version)
    values (p_event_id,p_category,coalesce(p_policy->>'base_format','elimination'),nullif(p_policy->>'transition_round','')::integer,nullif(p_policy->>'transition_format',''),coalesce(nullif(p_policy->>'version','')::integer,1))
    on conflict(event_id,category) do update set base_format=excluded.base_format,transition_round=excluded.transition_round,transition_format=excluded.transition_format,version=excluded.version;
  end if;
end; $$;

revoke all on function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
commit;
