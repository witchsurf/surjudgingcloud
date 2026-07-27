begin;

create table if not exists public.score_deletions (
  id uuid primary key default gen_random_uuid(),
  score_id text not null,
  heat_id text not null,
  event_id bigint,
  judge_id text not null,
  judge_name text,
  judge_station text,
  judge_identity_id text,
  surfer text not null,
  wave_number integer not null,
  score numeric not null,
  score_snapshot jsonb not null,
  reason text,
  comment text,
  deleted_by text,
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_score_deletions_heat
  on public.score_deletions (heat_id, deleted_at desc);
create index if not exists idx_score_deletions_logical
  on public.score_deletions (heat_id, judge_station, surfer, wave_number);

alter table public.score_deletions enable row level security;
drop policy if exists score_deletions_read_all on public.score_deletions;
create policy score_deletions_read_all on public.score_deletions
  for select to anon, authenticated using (true);

create or replace function public.delete_score_secure(
  p_score_id text,
  p_heat_id text,
  p_reason text default 'correction',
  p_comment text default null,
  p_deleted_by text default 'chief_judge',
  p_deleted_by_name text default 'Chef Judge'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.scores%rowtype;
  v_deleted_count integer := 0;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;

  select * into v_target
  from public.scores
  where id::text = trim(p_score_id)
    and heat_id = trim(p_heat_id)
  for update;

  if not found then
    raise exception 'score % not found for heat %', p_score_id, p_heat_id;
  end if;

  with logical_rows as (
    select score.*
    from public.scores score
    where score.heat_id = v_target.heat_id
      and upper(trim(score.surfer)) = upper(trim(v_target.surfer))
      and score.wave_number = v_target.wave_number
      and coalesce(nullif(upper(trim(score.judge_station)), ''), upper(trim(score.judge_id)))
          = coalesce(nullif(upper(trim(v_target.judge_station)), ''), upper(trim(v_target.judge_id)))
    for update
  ), audited as (
    insert into public.score_deletions (
      score_id, heat_id, event_id, judge_id, judge_name, judge_station,
      judge_identity_id, surfer, wave_number, score, score_snapshot,
      reason, comment, deleted_by, deleted_by_name
    )
    select id::text, heat_id, event_id, judge_id, judge_name, judge_station,
      judge_identity_id, surfer, wave_number, score, to_jsonb(logical_rows),
      p_reason, p_comment, p_deleted_by, p_deleted_by_name
    from logical_rows
    returning score_id
  )
  delete from public.scores score
  using audited
  where score.id::text = audited.score_id;

  get diagnostics v_deleted_count = row_count;
  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'heat_id', v_target.heat_id,
    'judge_station', coalesce(v_target.judge_station, v_target.judge_id),
    'surfer', v_target.surfer,
    'wave_number', v_target.wave_number
  );
end;
$$;

grant execute on function public.delete_score_secure(text, text, text, text, text, text)
  to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727113000_audited_score_deletion', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
