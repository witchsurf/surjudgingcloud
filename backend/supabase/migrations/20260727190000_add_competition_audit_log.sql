begin;

create table if not exists public.competition_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_id bigint,
  heat_id text,
  podium_id text,
  action_type text not null,
  entity_type text not null,
  entity_id text,
  actor_id text,
  actor_name text,
  actor_role text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint competition_audit_action_check check (trim(action_type) <> ''),
  constraint competition_audit_entity_check check (trim(entity_type) <> '')
);

create index if not exists idx_competition_audit_event_created
  on public.competition_audit_log (event_id, created_at desc);
create index if not exists idx_competition_audit_heat_created
  on public.competition_audit_log (heat_id, created_at desc);
create index if not exists idx_competition_audit_action
  on public.competition_audit_log (action_type, created_at desc);

alter table public.competition_audit_log enable row level security;

drop policy if exists competition_audit_read on public.competition_audit_log;
create policy competition_audit_read
  on public.competition_audit_log
  for select
  to anon, authenticated
  using (true);

grant select on public.competition_audit_log to anon, authenticated;
grant all on public.competition_audit_log to service_role;

create or replace function public.fn_audit_podium(
  p_event_id bigint,
  p_heat_id text
) returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select upper(trim(coalesce(pointer.podium_id, 'A')))
  from public.active_heat_pointer pointer
  where pointer.event_id = p_event_id
    and pointer.active_heat_id = p_heat_id
  order by pointer.updated_at desc
  limit 1
$$;

create or replace function public.fn_audit_score_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id bigint;
begin
  if old.score is not distinct from new.score
     and old.surfer is not distinct from new.surfer
     and old.wave_number is not distinct from new.wave_number
     and old.heat_id is not distinct from new.heat_id then
    return new;
  end if;

  v_event_id := coalesce(
    new.event_id,
    old.event_id,
    (select heat.event_id from public.heats heat where heat.id = new.heat_id limit 1)
  );

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_data, after_data, metadata
  ) values (
    v_event_id,
    new.heat_id,
    public.fn_audit_podium(v_event_id, new.heat_id),
    case
      when old.surfer is distinct from new.surfer
        or old.wave_number is distinct from new.wave_number
        or old.heat_id is distinct from new.heat_id
        then 'SCORE_MOVED'
      else 'SCORE_CORRECTED'
    end,
    'score',
    new.id::text,
    null,
    'Administration',
    'chief_judge',
    jsonb_build_object(
      'heat_id', old.heat_id,
      'judge_id', old.judge_id,
      'judge_name', old.judge_name,
      'judge_station', old.judge_station,
      'surfer', old.surfer,
      'wave_number', old.wave_number,
      'score', old.score
    ),
    jsonb_build_object(
      'heat_id', new.heat_id,
      'judge_id', new.judge_id,
      'judge_name', new.judge_name,
      'judge_station', new.judge_station,
      'surfer', new.surfer,
      'wave_number', new.wave_number,
      'score', new.score
    ),
    jsonb_build_object('source', 'scores_update_trigger')
  );

  return new;
end;
$$;

drop trigger if exists trg_audit_score_update on public.scores;
create trigger trg_audit_score_update
after update of score, surfer, wave_number, heat_id on public.scores
for each row execute function public.fn_audit_score_update();

create or replace function public.fn_audit_score_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_data, metadata, created_at
  ) values (
    new.event_id,
    new.heat_id,
    public.fn_audit_podium(new.event_id, new.heat_id),
    'SCORE_DELETED',
    'score',
    new.score_id,
    new.deleted_by,
    new.deleted_by_name,
    'chief_judge',
    new.score_snapshot,
    jsonb_build_object(
      'reason', new.reason,
      'comment', new.comment,
      'judge_station', new.judge_station,
      'surfer', new.surfer,
      'wave_number', new.wave_number
    ),
    new.deleted_at
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_score_deletion on public.score_deletions;
create trigger trg_audit_score_deletion
after insert on public.score_deletions
for each row execute function public.fn_audit_score_deletion();

create or replace function public.fn_audit_interference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.interference_calls%rowtype;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  v_action := case
    when tg_op = 'INSERT' then 'INTERFERENCE_ADDED'
    when tg_op = 'UPDATE' then 'INTERFERENCE_UPDATED'
    else 'INTERFERENCE_REMOVED'
  end;

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_data, after_data, metadata
  ) values (
    v_row.event_id,
    v_row.heat_id,
    public.fn_audit_podium(v_row.event_id, v_row.heat_id),
    v_action,
    'interference',
    v_row.id::text,
    v_row.judge_identity_id::text,
    coalesce(v_row.judge_name, v_row.judge_id),
    case when v_row.is_head_judge_override then 'chief_judge' else 'judge' end,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    jsonb_build_object(
      'surfer', v_row.surfer,
      'wave_number', v_row.wave_number,
      'call_type', v_row.call_type
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_audit_interference on public.interference_calls;
create trigger trg_audit_interference
after insert or update or delete on public.interference_calls
for each row execute function public.fn_audit_interference();

create or replace function public.fn_audit_heat_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_name, actor_role, before_data, after_data
  ) values (
    new.event_id,
    new.id,
    public.fn_audit_podium(new.event_id, new.id),
    'HEAT_STATUS_CHANGED',
    'heat',
    new.id,
    'Administration',
    'chief_judge',
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_heat_status on public.heats;
create trigger trg_audit_heat_status
after update of status on public.heats
for each row execute function public.fn_audit_heat_status();

create or replace function public.fn_audit_active_heat_pointer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.active_heat_id is not distinct from new.active_heat_id
     and old.podium_id is not distinct from new.podium_id then
    return new;
  end if;

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_name, actor_role, before_data, after_data
  ) values (
    new.event_id,
    new.active_heat_id,
    upper(trim(coalesce(new.podium_id, 'A'))),
    'ACTIVE_HEAT_CHANGED',
    'active_heat_pointer',
    concat(new.event_id, ':', upper(trim(coalesce(new.podium_id, 'A')))),
    'Administration',
    'chief_judge',
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_active_heat_pointer on public.active_heat_pointer;
create trigger trg_audit_active_heat_pointer
after insert or update of active_heat_id, podium_id on public.active_heat_pointer
for each row execute function public.fn_audit_active_heat_pointer();

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727190000_add_competition_audit_log', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
