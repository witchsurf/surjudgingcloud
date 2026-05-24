begin;

create or replace function public.validate_heat_start_dependencies(p_heat_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat record;
  v_blockers jsonb;
begin
  select h.id, h.event_id, h.division, h.round, h.heat_number
    into v_heat
  from public.heats h
  where h.id = trim(p_heat_id)
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'heat_id', trim(coalesce(p_heat_id, '')),
      'blockers', jsonb_build_array(jsonb_build_object(
        'reason', 'target_heat_missing',
        'message', 'Heat cible introuvable.'
      ))
    );
  end if;

  with mappings as (
    select
      hm.heat_id,
      hm.position,
      hm.placeholder,
      coalesce(
        hm.source_round,
        case
          when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[2]::integer
          else null
        end
      ) as source_round,
      coalesce(
        hm.source_heat,
        case
          when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[3]::integer
          else null
        end
      ) as source_heat,
      coalesce(
        hm.source_position,
        case
          when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[4]::integer
          else null
        end
      ) as source_position
    from public.heat_slot_mappings hm
    where hm.heat_id = v_heat.id
  ),
  dependency_rows as (
    select
      m.position,
      m.placeholder,
      m.source_round,
      m.source_heat,
      m.source_position,
      target_entry.participant_id as target_participant_id,
      exists (
        select 1
        from public.heat_entry_overrides override_row
        where override_row.heat_id = v_heat.id
          and override_row.position = m.position
      ) as has_manual_override,
      source_heat.id as source_heat_id,
      source_heat.status as source_status,
      exists (
        select 1
        from public.heat_realtime_config hrc
        where hrc.heat_id = source_heat.id
          and hrc.status = 'closed'
      ) as source_realtime_closed,
      ranked.participant_id as ranked_participant_id
    from mappings m
    left join public.heat_entries target_entry
      on target_entry.heat_id = v_heat.id
     and target_entry.position = m.position
    left join public.heats source_heat
      on source_heat.event_id = v_heat.event_id
     and lower(trim(coalesce(source_heat.division, ''))) = lower(trim(coalesce(v_heat.division, '')))
     and source_heat.round = m.source_round
     and source_heat.heat_number = m.source_heat
    left join lateral (
      select ranked.participant_id
      from public.fn_rank_heat_entries_from_scores(source_heat.id) ranked
      where ranked.rank_pos = m.source_position
      limit 1
    ) ranked on true
    where m.source_round is not null
      and m.source_heat is not null
      and m.source_position is not null
  ),
  blockers as (
    select
      jsonb_build_object(
        'position', d.position,
        'placeholder', d.placeholder,
        'source_round', d.source_round,
        'source_heat', d.source_heat,
        'source_position', d.source_position,
        'source_heat_id', d.source_heat_id,
        'source_status', d.source_status,
        'reason',
          case
            when d.source_heat_id is null then 'source_heat_missing'
            when not (coalesce(d.source_status, '') = 'closed' or d.source_realtime_closed) then 'source_heat_not_closed'
            when d.ranked_participant_id is not null and d.target_participant_id is null then 'qualifier_not_applied'
            else 'qualifier_missing'
          end,
        'message',
          case
            when d.source_heat_id is null then format('Source R%s H%s introuvable.', d.source_round, d.source_heat)
            when not (coalesce(d.source_status, '') = 'closed' or d.source_realtime_closed) then format('Source R%s H%s pas encore clôturée.', d.source_round, d.source_heat)
            when d.ranked_participant_id is not null and d.target_participant_id is null then format('Qualifié P%s de R%s H%s pas encore appliqué au lineup.', d.source_position, d.source_round, d.source_heat)
            else format('Qualifié P%s de R%s H%s indisponible.', d.source_position, d.source_round, d.source_heat)
          end
      ) as blocker
    from dependency_rows d
    where not d.has_manual_override
      and (
        d.source_heat_id is null
        or not (coalesce(d.source_status, '') = 'closed' or d.source_realtime_closed)
        or d.ranked_participant_id is null
        or d.target_participant_id is null
      )
  )
  select coalesce(jsonb_agg(blocker order by (blocker ->> 'position')::integer), '[]'::jsonb)
    into v_blockers
  from blockers;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'heat_id', v_heat.id,
    'blockers', v_blockers
  );
end;
$$;

create or replace function public.fn_block_unresolved_qualifier_heat_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_check jsonb;
begin
  if coalesce(new.status, '') = 'running'
     and new.timer_start_time is not null
  then
    v_check := public.validate_heat_start_dependencies(new.heat_id);

    if not coalesce((v_check ->> 'ok')::boolean, false) then
      raise exception 'HEAT_DEPENDENCIES_BLOCKED:%', v_check::text
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_unresolved_qualifier_heat_start on public.heat_realtime_config;
create trigger trg_block_unresolved_qualifier_heat_start
  before insert or update
  on public.heat_realtime_config
  for each row
  execute function public.fn_block_unresolved_qualifier_heat_start();

grant execute on function public.validate_heat_start_dependencies(text) to anon, authenticated, service_role;

insert into public.app_runtime_schema_version (id, schema_version, updated_at)
values (true, '20260524124500_block_unresolved_qualifier_heat_start', now())
on conflict (id) do update
  set schema_version = excluded.schema_version,
      updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
