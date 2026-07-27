begin;

create or replace function public.apply_score_correction_secure(
  p_score_id uuid,
  p_heat_id text default null,
  p_set_surfer boolean default false,
  p_surfer text default null,
  p_set_wave_number boolean default false,
  p_wave_number integer default null,
  p_set_score boolean default false,
  p_score numeric default null,
  p_timestamp timestamptz default now(),
  p_log_id uuid default null,
  p_log_reason text default null,
  p_log_comment text default null,
  p_log_overridden_by text default null,
  p_log_overridden_by_name text default null,
  p_log_created_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.scores%rowtype;
  v_after public.scores%rowtype;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;

  select * into v_before
  from public.scores
  where id = p_score_id::text
    and (p_heat_id is null or heat_id = trim(p_heat_id));

  if not found then
    raise exception 'score % not found', p_score_id;
  end if;

  update public.scores
     set surfer = case when p_set_surfer then coalesce(nullif(trim(coalesce(p_surfer, '')), ''), surfer) else surfer end,
         wave_number = case when p_set_wave_number then coalesce(p_wave_number, wave_number) else wave_number end,
         score = case when p_set_score then coalesce(p_score, score) else score end,
         timestamp = coalesce(p_timestamp, now())
   where id = p_score_id::text
   returning * into v_after;

  if p_log_id is not null then
    perform public.record_score_override_secure(
      p_log_id,
      v_after.heat_id,
      v_after.id::uuid,
      v_after.judge_id,
      v_after.judge_name,
      v_after.judge_station,
      v_after.judge_identity_id,
      v_after.surfer,
      v_after.wave_number,
      v_before.score,
      v_after.score,
      p_log_reason,
      p_log_comment,
      p_log_overridden_by,
      p_log_overridden_by_name,
      coalesce(p_log_created_at, p_timestamp, now())
    );
  end if;

  return to_jsonb(v_after);
end;
$$;

grant execute on function public.apply_score_correction_secure(
  uuid, text, boolean, text, boolean, integer, boolean, numeric,
  timestamptz, uuid, text, text, text, text, timestamptz
) to anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727123000_fix_local_score_correction_text_ids', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
