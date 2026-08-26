-- Field -> Internet live publication foundation.
--
-- This migration is deliberately Field-local only: it records immutable publication
-- facts in the same database transaction as the authoritative competition write.
-- It does not contact Cloud, change judging permissions, or make Cloud authoritative.

begin;

create table if not exists public.live_outbox (
  id uuid primary key default gen_random_uuid(),
  field_instance_id text not null default 'unprovisioned',
  event_id bigint not null references public.events(id) on delete cascade,
  sequence bigint generated always as identity,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  schema_version integer not null default 1,
  occurred_at timestamptz not null default now(),
  payload jsonb not null,
  payload_sha256 text,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  published_at timestamptz,
  cloud_ack_at timestamptz,
  constraint live_outbox_status_check check (status in ('pending', 'sending', 'published', 'quarantined')),
  constraint live_outbox_attempts_check check (attempts >= 0),
  constraint live_outbox_field_sequence_unique unique (field_instance_id, sequence)
);

create index if not exists live_outbox_pending_idx
  on public.live_outbox (status, next_attempt_at, sequence)
  where status in ('pending', 'sending');
create index if not exists live_outbox_event_sequence_idx
  on public.live_outbox (event_id, sequence);

create table if not exists public.live_sync_state (
  field_instance_id text primary key default 'unprovisioned',
  last_acked_sequence bigint,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.live_field_identity (
  id boolean primary key default true check (id),
  field_instance_id text not null default 'unprovisioned',
  updated_at timestamptz not null default now()
);
insert into public.live_field_identity (id, field_instance_id)
values (true, 'unprovisioned')
on conflict (id) do nothing;

create or replace function public.enqueue_live_outbox(
  p_event_id bigint,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb,
  p_occurred_at timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_id is null then
    return;
  end if;

  insert into public.live_outbox (
    field_instance_id,
    event_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
  ) select
    identity_row.field_instance_id,
    p_event_id, p_aggregate_type, p_aggregate_id, p_event_type, p_payload, coalesce(p_occurred_at, now())
  from public.live_field_identity identity_row
  where identity_row.id = true;
end;
$$;

create or replace function public.claim_live_outbox(p_worker_id text, p_limit integer default 50)
returns setof public.live_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A process can die after the relay accepted a request but before its local
  -- ACK commit. Releasing only stale claims gives at-least-once delivery while
  -- preserving the original outbox identity for relay-side deduplication.
  update public.live_outbox
     set status = 'pending', locked_at = null, locked_by = null,
         next_attempt_at = now(), last_error = 'stale worker claim recovered'
   where status = 'sending'
     and locked_at < now() - interval '60 seconds';

  return query
  with claimed as (
    select id
    from public.live_outbox
    where status = 'pending'
      and next_attempt_at <= now()
    order by sequence
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  update public.live_outbox outbox
     set status = 'sending',
         attempts = outbox.attempts + 1,
         locked_at = now(),
         locked_by = nullif(trim(p_worker_id), '')
    from claimed
   where outbox.id = claimed.id
  returning outbox.*;
end;
$$;

create or replace function public.ack_live_outbox(p_worker_id text, p_field_instance_id text, p_ids uuid[], p_last_sequence bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_outbox
     set status = 'published', published_at = now(), cloud_ack_at = now(),
         locked_at = null, locked_by = null, last_error = null
   where id = any(p_ids)
     and status = 'sending'
     and locked_by = nullif(trim(p_worker_id), '');

  insert into public.live_sync_state (field_instance_id, last_acked_sequence, last_success_at, last_error, updated_at)
  values (p_field_instance_id, p_last_sequence, now(), null, now())
  on conflict (field_instance_id) do update
    set last_acked_sequence = greatest(coalesce(live_sync_state.last_acked_sequence, 0), excluded.last_acked_sequence),
        last_success_at = excluded.last_success_at,
        last_error = null,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.fail_live_outbox(p_worker_id text, p_field_instance_id text, p_ids uuid[], p_error text, p_retry_after_seconds integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_delay integer := greatest(1, least(coalesce(p_retry_after_seconds, 5), 3600));
begin
  update public.live_outbox
     set status = 'pending', next_attempt_at = now() + make_interval(secs => v_delay),
         locked_at = null, locked_by = null, last_error = left(coalesce(p_error, 'unknown relay failure'), 2000)
   where id = any(p_ids)
     and status = 'sending'
     and locked_by = nullif(trim(p_worker_id), '');

  insert into public.live_sync_state (field_instance_id, last_error_at, last_error, updated_at)
  values (p_field_instance_id, now(), left(coalesce(p_error, 'unknown relay failure'), 2000), now())
  on conflict (field_instance_id) do update
    set last_error_at = excluded.last_error_at, last_error = excluded.last_error, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.trg_enqueue_live_score()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event_id bigint;
begin
  if not public.is_local_database() then return new; end if;
  v_event_id := new.event_id;
  if v_event_id is null then
    select event_id into v_event_id from public.heats where id = new.heat_id;
  end if;
  perform public.enqueue_live_outbox(v_event_id, 'score', new.id::text,
    case when tg_op = 'INSERT' then 'score.recorded.v1' else 'score.corrected.v1' end,
    jsonb_build_object('score', to_jsonb(new)), coalesce(new."timestamp", new.created_at, now()));
  return new;
end;
$$;

create or replace function public.trg_enqueue_live_heat_realtime()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event_id bigint;
begin
  if not public.is_local_database() then return new; end if;
  select event_id into v_event_id from public.heats where id = new.heat_id;
  perform public.enqueue_live_outbox(v_event_id, 'heat', new.heat_id,
    'heat.snapshot.v1', jsonb_build_object('heat_realtime_config', to_jsonb(new)), coalesce(new.updated_at, now()));
  return new;
end;
$$;

create or replace function public.trg_enqueue_live_active_heat()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_local_database() then return new; end if;
  perform public.enqueue_live_outbox(new.event_id, 'event', coalesce(new.event_id::text, new.event_name),
    'active_heat.changed.v1', jsonb_build_object('active_heat_pointer', to_jsonb(new)), coalesce(new.updated_at, now()));
  return new;
end;
$$;

create or replace function public.trg_enqueue_live_score_override()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event_id bigint;
begin
  if not public.is_local_database() then return new; end if;
  select event_id into v_event_id from public.heats where id = new.heat_id;
  perform public.enqueue_live_outbox(v_event_id, 'score', new.score_id::text,
    'score.corrected.v1', jsonb_build_object('score_override', to_jsonb(new)), coalesce(new.created_at, now()));
  return new;
end;
$$;

drop trigger if exists trg_enqueue_live_score on public.scores;
create trigger trg_enqueue_live_score
after insert or update of score, surfer, wave_number on public.scores
for each row execute function public.trg_enqueue_live_score();

drop trigger if exists trg_enqueue_live_heat_realtime on public.heat_realtime_config;
create trigger trg_enqueue_live_heat_realtime
after insert or update on public.heat_realtime_config
for each row execute function public.trg_enqueue_live_heat_realtime();

drop trigger if exists trg_enqueue_live_active_heat on public.active_heat_pointer;
create trigger trg_enqueue_live_active_heat
after insert or update of active_heat_id, podium_id on public.active_heat_pointer
for each row execute function public.trg_enqueue_live_active_heat();

drop trigger if exists trg_enqueue_live_score_override on public.score_overrides;
create trigger trg_enqueue_live_score_override
after insert or update on public.score_overrides
for each row execute function public.trg_enqueue_live_score_override();

revoke all on table public.live_outbox, public.live_sync_state, public.live_field_identity from anon, authenticated;
revoke all on function public.enqueue_live_outbox(bigint, text, text, text, jsonb, timestamptz) from public;
revoke all on function public.claim_live_outbox(text, integer) from public;
revoke all on function public.ack_live_outbox(text, text, uuid[], bigint) from public;
revoke all on function public.fail_live_outbox(text, text, uuid[], text, integer) from public;
grant execute on function public.claim_live_outbox(text, integer) to service_role;
grant execute on function public.ack_live_outbox(text, text, uuid[], bigint) to service_role;
grant execute on function public.fail_live_outbox(text, text, uuid[], text, integer) to service_role;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260826150000_field_live_outbox_foundation', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
