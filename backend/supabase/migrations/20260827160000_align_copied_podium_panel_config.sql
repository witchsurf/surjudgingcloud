begin;

-- A podium activation already copies the official assignments to the target
-- heat. Keep the historical heat_configs snapshot aligned in the same
-- transaction so every consumer resolves the same 3/5-judge panel immediately.
create or replace function public.copy_podium_panel_to_heat(
  p_event_id bigint,
  p_podium_id text,
  p_heat_id text,
  p_assigned_by text default 'podium-panel'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat_id text := trim(coalesce(p_heat_id, ''));
  v_count integer;
  v_judges text[];
  v_judge_names jsonb;
begin
  if not exists (
    select 1 from public.heats
    where id = v_heat_id
      and event_id = p_event_id
  ) then
    raise exception 'Heat % does not belong to event %', v_heat_id, p_event_id using errcode = '23503';
  end if;

  select
    count(*)::integer,
    array_agg(panel.station order by substring(upper(trim(panel.station)) from '[0-9]+')::integer, upper(trim(panel.station))),
    jsonb_object_agg(panel.station, panel.judge_name)
  into v_count, v_judges, v_judge_names
  from public.podium_judge_assignments panel
  where panel.event_id = p_event_id
    and panel.podium_id = v_podium_id;

  if v_count = 0 then
    raise exception 'No judge panel configured for podium %', v_podium_id using errcode = '23514';
  end if;

  delete from public.heat_judge_assignments assignment
  where assignment.heat_id = v_heat_id
    and not exists (
      select 1
      from public.podium_judge_assignments panel
      where panel.event_id = p_event_id
        and panel.podium_id = v_podium_id
        and upper(trim(panel.station)) = upper(trim(assignment.station))
    );

  insert into public.heat_judge_assignments (
    heat_id,
    event_id,
    station,
    judge_id,
    judge_name,
    assigned_by
  )
  select
    v_heat_id,
    p_event_id,
    panel.station,
    panel.judge_id,
    panel.judge_name,
    coalesce(nullif(trim(p_assigned_by), ''), 'podium-panel')
  from public.podium_judge_assignments panel
  where panel.event_id = p_event_id
    and panel.podium_id = v_podium_id
  on conflict (heat_id, station)
  do update set
    event_id = excluded.event_id,
    judge_id = excluded.judge_id,
    judge_name = excluded.judge_name,
    assigned_by = excluded.assigned_by,
    updated_at = now();

  update public.heat_configs config
     set judges = v_judges,
         judge_names = coalesce(v_judge_names, '{}'::jsonb)
   where config.heat_id = v_heat_id;

  return v_count;
end;
$$;

grant execute on function public.copy_podium_panel_to_heat(bigint, text, text, text)
  to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260827160000_align_copied_podium_panel_config',
  'Atomic podium panel and heat config alignment',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
