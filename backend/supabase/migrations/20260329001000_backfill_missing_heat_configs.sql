insert into public.heat_configs (
  heat_id,
  judges,
  surfers,
  judge_names,
  waves,
  tournament_type
)
select
  h.id as heat_id,
  coalesce(
    assignment_payload.judges,
    array['J1', 'J2', 'J3']::text[]
  ) as judges,
  coalesce(
    surfer_payload.surfers,
    case
      when h.heat_size = 2 then array['ROUGE', 'BLANC']::text[]
      when h.heat_size = 3 then array['ROUGE', 'BLANC', 'JAUNE']::text[]
      when h.heat_size = 4 then array['ROUGE', 'BLANC', 'JAUNE', 'BLEU']::text[]
      when h.heat_size = 5 then array['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT']::text[]
      when h.heat_size = 6 then array['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR']::text[]
      else array[]::text[]
    end
  ) as surfers,
  coalesce(assignment_payload.judge_names, '{}'::jsonb) as judge_names,
  15 as waves,
  'elimination'::text as tournament_type
from public.heats h
left join lateral (
  select
    array_agg(a.station order by a.station) as judges,
    jsonb_object_agg(a.station, a.judge_name) filter (where a.station is not null and a.judge_name is not null) as judge_names
  from public.heat_judge_assignments a
  where a.heat_id = h.id
) as assignment_payload on true
left join lateral (
  select
    array_agg(
      case upper(trim(coalesce(he.color, '')))
        when 'RED' then 'ROUGE'
        when 'WHITE' then 'BLANC'
        when 'YELLOW' then 'JAUNE'
        when 'BLUE' then 'BLEU'
        when 'GREEN' then 'VERT'
        when 'BLACK' then 'NOIR'
        else upper(trim(coalesce(he.color, '')))
      end
      order by he.position
    ) filter (where he.position is not null) as surfers
  from public.heat_entries he
  where he.heat_id = h.id
) as surfer_payload on true
left join public.heat_configs hc
  on hc.heat_id = h.id
where hc.heat_id is null
  and (
    coalesce(array_length(surfer_payload.surfers, 1), 0) > 0
    or coalesce(h.heat_size, 0) > 0
  )
on conflict (heat_id) do update
set
  judges = excluded.judges,
  surfers = excluded.surfers,
  judge_names = excluded.judge_names,
  waves = excluded.waves,
  tournament_type = excluded.tournament_type;
