-- Enrich Field publication facts so an Internet/OBS consumer can render one
-- heat without reading any operational Field or legacy Cloud table.
begin;

create or replace function public.live_overlay_heat_payload(p_heat_id text, p_realtime jsonb)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'heat_realtime_config', coalesce(p_realtime, '{}'::jsonb),
    'heat', coalesce(to_jsonb(h), '{}'::jsonb),
    'heat_config', coalesce(to_jsonb(hc), '{}'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'color', he.color, 'position', he.position,
      'participant_id', he.participant_id, 'name', p.name, 'country', p.country
    ) order by he.position) from public.heat_entries he left join public.participants p on p.id=he.participant_id where he.heat_id=p_heat_id), '[]'::jsonb)
  ) from public.heats h left join public.heat_configs hc on hc.heat_id=h.id where h.id=p_heat_id;
$$;

create or replace function public.trg_enqueue_live_heat_realtime()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event_id bigint;
begin
  if not public.is_local_database() then return new; end if;
  select event_id into v_event_id from public.heats where id = new.heat_id;
  perform public.enqueue_live_outbox(v_event_id, 'heat', new.heat_id, 'heat.snapshot.v2',
    public.live_overlay_heat_payload(new.heat_id, to_jsonb(new)), coalesce(new.updated_at, now()));
  return new;
end;
$$;

create or replace function public.trg_enqueue_live_active_heat()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_realtime jsonb;
begin
  if not public.is_local_database() then return new; end if;
  perform public.enqueue_live_outbox(new.event_id, 'event', coalesce(new.event_id::text, new.event_name),
    'active_heat.changed.v1', jsonb_build_object('active_heat_pointer', to_jsonb(new)), coalesce(new.updated_at, now()));
  if new.active_heat_id is not null then
    select to_jsonb(hrc) into v_realtime from public.heat_realtime_config hrc where hrc.heat_id=new.active_heat_id;
    perform public.enqueue_live_outbox(new.event_id, 'heat', new.active_heat_id, 'heat.snapshot.v2',
      public.live_overlay_heat_payload(new.active_heat_id, v_realtime), coalesce(new.updated_at, now()));
  end if;
  return new;
end;
$$;

create or replace function public.trg_enqueue_live_interference()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.interference_calls%rowtype; v_event_id bigint;
begin
  if tg_op='DELETE' then v_row:=old; else v_row:=new; end if;
  if not public.is_local_database() then return coalesce(new, old); end if;
  v_event_id:=v_row.event_id; if v_event_id is null then select event_id into v_event_id from public.heats where id=v_row.heat_id; end if;
  perform public.enqueue_live_outbox(v_event_id, 'interference', v_row.id::text, 'interference.snapshot.v1', jsonb_build_object('interference_call', to_jsonb(v_row), 'deleted', tg_op='DELETE'), coalesce(v_row.updated_at, now()));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enqueue_live_interference on public.interference_calls;
create trigger trg_enqueue_live_interference after insert or update or delete on public.interference_calls for each row execute function public.trg_enqueue_live_interference();

insert into public.app_runtime_schema_version (id,schema_version,updated_at) values (true,'20260826190000_live_overlay_snapshot_contract',now()) on conflict (id) do update set schema_version=excluded.schema_version,updated_at=excluded.updated_at;
notify pgrst, 'reload schema';
commit;
