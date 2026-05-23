-- Migration: Fix local score override RPC when local scores.id is text.

begin;

create or replace function public.record_score_override_secure(
  p_id uuid,
  p_heat_id text,
  p_score_id uuid,
  p_judge_id text,
  p_judge_name text default null,
  p_judge_station text default null,
  p_judge_identity_id text default null,
  p_surfer text default null,
  p_wave_number integer default null,
  p_previous_score numeric default null,
  p_new_score numeric default null,
  p_reason text default null,
  p_comment text default null,
  p_overridden_by text default null,
  p_overridden_by_name text default null,
  p_created_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_score record;
  v_result jsonb;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;
  if p_id is null then
    raise exception 'override id is required';
  end if;

  select *
    into v_score
  from public.scores
  where id = p_score_id::text
    and heat_id = trim(p_heat_id);

  if not found then
    raise exception 'score % not found for heat %', p_score_id, p_heat_id;
  end if;

  insert into public.score_overrides (
    id, heat_id, score_id, judge_id, judge_name, judge_station,
    judge_identity_id, surfer, wave_number, previous_score, new_score,
    reason, comment, overridden_by, overridden_by_name, created_at
  )
  values (
    p_id,
    trim(p_heat_id),
    p_score_id::text,
    coalesce(nullif(trim(coalesce(p_judge_id, '')), ''), v_score.judge_id),
    coalesce(nullif(trim(coalesce(p_judge_name, '')), ''), v_score.judge_name),
    coalesce(nullif(trim(coalesce(p_judge_station, '')), ''), v_score.judge_station, v_score.judge_id),
    nullif(trim(coalesce(p_judge_identity_id, '')), ''),
    coalesce(nullif(trim(coalesce(p_surfer, '')), ''), v_score.surfer),
    coalesce(p_wave_number, v_score.wave_number),
    p_previous_score,
    p_new_score,
    p_reason,
    p_comment,
    p_overridden_by,
    p_overridden_by_name,
    coalesce(p_created_at, now())
  )
  on conflict (id) do update
    set heat_id = excluded.heat_id,
        score_id = excluded.score_id,
        judge_id = excluded.judge_id,
        judge_name = excluded.judge_name,
        judge_station = excluded.judge_station,
        judge_identity_id = excluded.judge_identity_id,
        surfer = excluded.surfer,
        wave_number = excluded.wave_number,
        previous_score = excluded.previous_score,
        new_score = excluded.new_score,
        reason = excluded.reason,
        comment = excluded.comment,
        overridden_by = excluded.overridden_by,
        overridden_by_name = excluded.overridden_by_name,
        created_at = excluded.created_at
  returning to_jsonb(score_overrides.*) into v_result;

  return v_result;
end;
$$;

grant execute on function public.record_score_override_secure(uuid, text, uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text, text, timestamptz) to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260523231000_fix_local_score_override_text_ids', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
