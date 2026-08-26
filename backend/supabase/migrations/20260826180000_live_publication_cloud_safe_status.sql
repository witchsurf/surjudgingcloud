-- Cloud installations do not necessarily carry the Field-only helper
-- is_local_database(). Keep the operator RPC safe and inert in that case.

begin;

create or replace function public.get_live_publication_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity text;
  v_state public.live_sync_state%rowtype;
  v_pending integer := 0;
  v_sending integer := 0;
  v_quarantined integer := 0;
  v_oldest_pending_at timestamptz;
  v_is_local boolean := false;
begin
  if to_regprocedure('public.is_local_database()') is not null then
    execute 'select public.is_local_database()' into v_is_local;
  end if;

  if not coalesce(v_is_local, false) then
    return jsonb_build_object('configured', false, 'local_field', false);
  end if;

  select field_instance_id into v_identity
  from public.live_field_identity
  where id = true;

  if coalesce(v_identity, 'unprovisioned') = 'unprovisioned' then
    return jsonb_build_object(
      'configured', false,
      'local_field', true,
      'field_instance_id', 'unprovisioned'
    );
  end if;

  select * into v_state
  from public.live_sync_state
  where field_instance_id = v_identity;

  select
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'sending')::integer,
    count(*) filter (where status = 'quarantined')::integer,
    min(occurred_at) filter (where status in ('pending', 'sending'))
  into v_pending, v_sending, v_quarantined, v_oldest_pending_at
  from public.live_outbox
  where field_instance_id = v_identity;

  return jsonb_build_object(
    'configured', true,
    'local_field', true,
    'field_instance_id', v_identity,
    'worker_id', v_state.worker_id,
    'worker_heartbeat_at', v_state.worker_heartbeat_at,
    'last_acked_sequence', v_state.last_acked_sequence,
    'last_success_at', v_state.last_success_at,
    'last_error_at', v_state.last_error_at,
    'last_error', v_state.last_error,
    'pending_count', v_pending,
    'sending_count', v_sending,
    'quarantined_count', v_quarantined,
    'oldest_pending_at', v_oldest_pending_at
  );
end;
$$;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260826180000_live_publication_cloud_safe_status', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
