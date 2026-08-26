-- Operator-only visibility for the Field -> Internet publication worker.
-- This adds no Cloud dependency to judging. The public read RPC returns a
-- compact diagnostic only when called against a local Field database.

begin;

alter table public.live_sync_state
  add column if not exists worker_id text,
  add column if not exists worker_heartbeat_at timestamptz;

create or replace function public.heartbeat_live_outbox_worker(
  p_worker_id text,
  p_field_instance_id text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(p_worker_id), '') is null
     or nullif(trim(p_field_instance_id), '') is null
     or p_field_instance_id = 'unprovisioned' then
    raise exception 'A provisioned Field identity and worker id are required';
  end if;

  insert into public.live_sync_state (
    field_instance_id, worker_id, worker_heartbeat_at, updated_at
  ) values (
    p_field_instance_id, p_worker_id, now(), now()
  ) on conflict (field_instance_id) do update
    set worker_id = excluded.worker_id,
        worker_heartbeat_at = excluded.worker_heartbeat_at,
        updated_at = excluded.updated_at;
end;
$$;

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
begin
  -- This RPC is intentionally harmless on Cloud, where no Field worker runs.
  if not public.is_local_database() then
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

revoke all on function public.heartbeat_live_outbox_worker(text, text) from public;
revoke all on function public.get_live_publication_status() from public;
grant execute on function public.heartbeat_live_outbox_worker(text, text) to service_role;
grant execute on function public.get_live_publication_status() to anon, authenticated;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260826170000_live_publication_operator_status', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
