begin;

create or replace function public.fn_enrich_score_audit_from_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_audit_id uuid;
begin
  select audit.id
    into v_audit_id
  from public.competition_audit_log audit
  where audit.heat_id = new.heat_id
    and audit.entity_type = 'score'
    and audit.entity_id = new.score_id::text
    and audit.action_type in ('SCORE_CORRECTED', 'SCORE_MOVED')
    and audit.created_at >= coalesce(new.created_at, now()) - interval '2 minutes'
    and upper(trim(coalesce(audit.after_data->>'surfer', '')))
        = upper(trim(coalesce(new.surfer, '')))
    and (audit.after_data->>'wave_number')::integer is not distinct from new.wave_number
    and (audit.before_data->>'score')::numeric is not distinct from new.previous_score
    and (audit.after_data->>'score')::numeric is not distinct from new.new_score
  order by audit.created_at desc, audit.id desc
  limit 1;

  if v_audit_id is not null then
    update public.competition_audit_log
       set actor_id = coalesce(nullif(trim(new.overridden_by), ''), actor_id),
           actor_name = coalesce(nullif(trim(new.overridden_by_name), ''), actor_name),
           actor_role = 'chief_judge',
           metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
             'reason', new.reason,
             'comment', new.comment,
             'override_id', new.id
           ))
     where id = v_audit_id;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727193000_fix_score_audit_correlation', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
