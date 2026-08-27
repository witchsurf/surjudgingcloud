begin;

-- Keep the legacy heats.is_active flag aligned with the authoritative
-- active_heat_pointer without breaking dual-podium operation.  Activations on
-- the same podium are serialized so two concurrent operator actions cannot
-- leave more than one unreferenced heat marked active.
create or replace function public.activate_heat_on_podium(
  p_event_id bigint,
  p_podium_id text,
  p_heat_id text,
  p_assigned_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat record;
  v_panel_size integer;
begin
  if v_podium_id not in ('A', 'B') then
    raise exception 'Invalid podium id %', v_podium_id using errcode = '22023';
  end if;

  -- A transaction-scoped lock also covers the first activation, when no
  -- pointer row exists yet and therefore cannot be locked FOR UPDATE.
  perform pg_advisory_xact_lock(
    hashtextextended(format('activate_heat_on_podium:%s:%s', p_event_id, v_podium_id), 0)
  );

  select id, competition, division, round, heat_number, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id)
    and event_id = p_event_id
  for update;

  if not found then
    raise exception 'Heat % does not belong to event %', p_heat_id, p_event_id using errcode = '23503';
  end if;

  if coalesce(v_heat.status, '') = 'closed' then
    raise exception 'Closed heat % cannot be activated', v_heat.id using errcode = '23514';
  end if;

  v_panel_size := public.copy_podium_panel_to_heat(
    p_event_id,
    v_podium_id,
    v_heat.id,
    p_assigned_by
  );

  perform public.upsert_active_heat_pointer(
    p_event_id,
    v_heat.competition,
    v_heat.id,
    now(),
    v_podium_id
  );

  -- Retire every stale legacy flag that is no longer backed by any podium
  -- pointer. A heat still referenced by the other podium remains active.
  update public.heats h
     set is_active = false,
         updated_at = now()
   where h.event_id = p_event_id
     and coalesce(h.is_active, false)
     and h.id <> v_heat.id
     and not exists (
       select 1
       from public.active_heat_pointer pointer
       where pointer.event_id = p_event_id
         and pointer.active_heat_id = h.id
     );

  update public.heats
     set status = case when status = 'waiting' then 'open' else status end,
         is_active = true,
         updated_at = now()
   where id = v_heat.id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'podium_id', v_podium_id,
    'heat_id', v_heat.id,
    'division', v_heat.division,
    'round', v_heat.round,
    'heat_number', v_heat.heat_number,
    'panel_size', v_panel_size
  );
end;
$$;

grant execute on function public.activate_heat_on_podium(bigint, text, text, text)
  to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (
  true,
  '20260827150000_atomic_podium_active_heat_flags',
  'Atomic podium pointer and active heat flag alignment',
  now()
)
on conflict (id) do update
set schema_version = excluded.schema_version,
    schema_label = excluded.schema_label,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
