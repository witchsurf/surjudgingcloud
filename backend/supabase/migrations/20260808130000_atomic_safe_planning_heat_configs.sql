begin;

create or replace function public.bulk_upsert_heats_safe_v2(
  p_event_id bigint,
  p_category text,
  p_overwrite boolean default false,
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_heat_configs jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heat_ids text[];
  v_config_heat_ids text[];
begin
  if jsonb_typeof(coalesce(p_heat_configs, '[]'::jsonb)) <> 'array' then
    raise exception 'heat_configs payload must be an array';
  end if;

  select coalesce(array_agg(payload.id order by payload.id), '{}'::text[])
    into v_heat_ids
  from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) as payload(id text);

  select coalesce(array_agg(payload.heat_id order by payload.heat_id), '{}'::text[])
    into v_config_heat_ids
  from jsonb_to_recordset(coalesce(p_heat_configs, '[]'::jsonb)) as payload(heat_id text);

  if v_config_heat_ids is distinct from v_heat_ids
     or exists (
       select 1
       from jsonb_to_recordset(coalesce(p_heat_configs, '[]'::jsonb)) as payload(heat_id text)
       where payload.heat_id is null
     ) then
    raise exception 'heat_configs must match the proposed heat ids exactly';
  end if;

  -- The v1 safe function performs validation, target selection, locking,
  -- blocker recalculation and the historical bulk write. A nested function
  -- call does not commit: the config upsert below remains in the same DB
  -- transaction and any error rolls all planning writes back.
  perform public.bulk_upsert_heats_safe(
    p_event_id,
    p_category,
    p_overwrite,
    p_heats,
    p_entries,
    p_mappings,
    p_participants
  );

  insert into public.heat_configs (
    heat_id,
    judges,
    surfers,
    judge_names,
    waves,
    tournament_type
  )
  select
    payload.heat_id,
    payload.judges,
    payload.surfers,
    payload.judge_names,
    payload.waves,
    payload.tournament_type
  from jsonb_to_recordset(coalesce(p_heat_configs, '[]'::jsonb)) as payload(
    heat_id text,
    judges text[],
    surfers text[],
    judge_names jsonb,
    waves integer,
    tournament_type text
  )
  on conflict (heat_id) do update
  set judges = excluded.judges,
      surfers = excluded.surfers,
      judge_names = excluded.judge_names,
      waves = excluded.waves,
      tournament_type = excluded.tournament_type;
end;
$$;

revoke all on function public.bulk_upsert_heats_safe_v2(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.bulk_upsert_heats_safe_v2(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

comment on function public.bulk_upsert_heats_safe_v2(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'Atomic safe planning including heat_configs. Requires exact config/heat identity and is_active=false through v1.';

commit;
