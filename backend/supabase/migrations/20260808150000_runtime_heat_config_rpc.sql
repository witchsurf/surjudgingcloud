begin;

create or replace function public.upsert_heat_config_runtime(
  p_heat_id text,
  p_judges text[],
  p_surfers text[],
  p_judge_names jsonb,
  p_waves integer,
  p_tournament_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id bigint;
  v_role text := coalesce(auth.role(), '');
begin
  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'heat_id is required' using errcode = '22023';
  end if;

  select heat.event_id
    into v_event_id
  from public.heats heat
  where heat.id = p_heat_id;

  if not found then
    raise exception 'Heat % not found', p_heat_id using errcode = '23503';
  end if;

  if v_role <> 'service_role'
     and not public.is_local_database()
     and not public.user_has_event_access(v_event_id) then
    raise exception 'Access denied for heat %', p_heat_id using errcode = '42501';
  end if;

  insert into public.heat_configs (
    heat_id,
    judges,
    surfers,
    judge_names,
    waves,
    tournament_type
  ) values (
    p_heat_id,
    coalesce(p_judges, '{}'::text[]),
    coalesce(p_surfers, '{}'::text[]),
    coalesce(p_judge_names, '{}'::jsonb),
    p_waves,
    p_tournament_type
  )
  on conflict (heat_id) do update
  set judges = excluded.judges,
      surfers = excluded.surfers,
      judge_names = excluded.judge_names,
      waves = excluded.waves,
      tournament_type = excluded.tournament_type;
end;
$$;

alter function public.upsert_heat_config_runtime(text, text[], text[], jsonb, integer, text) owner to postgres;
revoke all on function public.upsert_heat_config_runtime(text, text[], text[], jsonb, integer, text) from public;
grant execute on function public.upsert_heat_config_runtime(text, text[], text[], jsonb, integer, text) to authenticated, service_role;

comment on function public.upsert_heat_config_runtime(text, text[], text[], jsonb, integer, text) is
  'Narrow runtime heat configuration upsert. Preserves the historical heat_configs payload while avoiding direct table writes.';

commit;
