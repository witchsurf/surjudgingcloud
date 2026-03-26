insert into public.heat_judge_assignments (
  heat_id,
  event_id,
  station,
  judge_id,
  judge_name,
  assigned_by
)
select
  source.heat_id,
  source.event_id,
  source.station,
  source.station,
  source.judge_name,
  'backfill_heat_configs'
from (
  select
    hc.heat_id,
    h.event_id,
    upper(trim(judge_station.station)) as station,
    coalesce(
      nullif(
        trim(
          coalesce(
            hc.judge_names ->> upper(trim(judge_station.station)),
            upper(trim(judge_station.station))
          )
        ),
        ''
      ),
      upper(trim(judge_station.station))
    ) as judge_name
  from public.heat_configs hc
  join public.heats h
    on h.id = hc.heat_id
  cross join lateral jsonb_array_elements_text(
    coalesce(to_jsonb(hc.judges), '[]'::jsonb)
  ) as judge_station(station)
) as source
where source.station <> ''
on conflict (heat_id, station) do update
set
  event_id = excluded.event_id,
  judge_id = excluded.judge_id,
  judge_name = excluded.judge_name,
  assigned_by = excluded.assigned_by,
  updated_at = now();

insert into public.heat_judge_assignments (
  heat_id,
  event_id,
  station,
  judge_id,
  judge_name,
  assigned_by
)
select
  h.id,
  ec.event_id,
  upper(trim(coalesce(judge_payload.value ->> 'id', ''))) as station,
  upper(trim(coalesce(judge_payload.value ->> 'id', ''))) as judge_id,
  coalesce(
    nullif(trim(judge_payload.value ->> 'name'), ''),
    upper(trim(coalesce(judge_payload.value ->> 'id', '')))
  ) as judge_name,
  'backfill_event_last_config'
from public.event_last_config ec
join public.heats h
  on h.event_id = ec.event_id
 and h.division = ec.division
 and h.round = ec.round
 and h.heat_number = ec.heat_number
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(ec.judges) = 'array' then ec.judges
    else '[]'::jsonb
  end
) as judge_payload(value)
where upper(trim(coalesce(judge_payload.value ->> 'id', ''))) <> ''
on conflict (heat_id, station) do update
set
  event_id = excluded.event_id,
  judge_id = excluded.judge_id,
  judge_name = excluded.judge_name,
  assigned_by = excluded.assigned_by,
  updated_at = now();
