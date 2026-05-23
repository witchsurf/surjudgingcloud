-- Migration: Robust Scores Trigger Autofill to prevent NOT NULL constraint violations during offline sync replays
-- Location: backend/supabase/migrations/20260523215500_robust_scores_trigger_autofill.sql

begin;

create or replace function public.fn_canonicalize_score_heat_id()
returns trigger
language plpgsql
as $$
declare
  v_heat record;
begin
  -- Resolve canonical heat ID first
  new.heat_id := public.fn_resolve_canonical_heat_id(
    new.heat_id,
    new.event_id,
    new.competition,
    new.division,
    new.round
  );

  -- Autofill missing fields from public.heats if they are null or empty
  if new.heat_id is not null then
    select * into v_heat
    from public.heats
    where id = new.heat_id;

    if found then
      new.competition := coalesce(nullif(trim(new.competition), ''), v_heat.competition, 'Competition');
      new.division    := coalesce(nullif(trim(new.division), ''), v_heat.division, 'Division');
      new.round       := coalesce(new.round, v_heat.round, 1);
      new.event_id    := coalesce(new.event_id, v_heat.event_id);
    end if;
  end if;

  -- Ensure fallback values just in case heats lookup didn't find anything
  new.competition := coalesce(nullif(trim(new.competition), ''), 'Competition');
  new.division    := coalesce(nullif(trim(new.division), ''), 'Division');
  new.round       := coalesce(new.round, 1);

  return new;
end;
$$;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260523215500_robust_scores_trigger_autofill', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

commit;
