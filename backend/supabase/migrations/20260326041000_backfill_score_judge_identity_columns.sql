do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'judges'
  ) then
    execute $sql$
      with assignment_lookup as (
        select
          heat_id,
          upper(trim(station)) as station,
          nullif(trim(judge_id), '') as judge_identity_id
        from public.heat_judge_assignments
      ),
      judge_lookup as (
        select id as judge_identity_id
        from public.judges
      ),
      score_candidates as (
        select
          score.id,
          coalesce(
            assignment_lookup.judge_identity_id,
            case when judge_lookup.judge_identity_id is not null then score.judge_id else null end
          ) as judge_identity_id
        from public.scores score
        left join assignment_lookup
          on assignment_lookup.heat_id = score.heat_id
         and assignment_lookup.station = upper(trim(coalesce(score.judge_station, score.judge_id)))
        left join judge_lookup
          on judge_lookup.judge_identity_id = score.judge_id
      ),
      override_candidates as (
        select
          log.id,
          coalesce(
            assignment_lookup.judge_identity_id,
            case when judge_lookup.judge_identity_id is not null then log.judge_id else null end
          ) as judge_identity_id
        from public.score_overrides log
        left join assignment_lookup
          on assignment_lookup.heat_id = log.heat_id
         and assignment_lookup.station = upper(trim(coalesce(log.judge_station, log.judge_id)))
        left join judge_lookup
          on judge_lookup.judge_identity_id = log.judge_id
      ),
      interference_candidates as (
        select
          call.id,
          coalesce(
            assignment_lookup.judge_identity_id,
            case when judge_lookup.judge_identity_id is not null then call.judge_id else null end
          ) as judge_identity_id
        from public.interference_calls call
        left join assignment_lookup
          on assignment_lookup.heat_id = call.heat_id
         and assignment_lookup.station = upper(trim(coalesce(call.judge_station, call.judge_id)))
        left join judge_lookup
          on judge_lookup.judge_identity_id = call.judge_id
      )
      update public.scores score
      set judge_identity_id = score_candidates.judge_identity_id,
          judge_station = upper(trim(coalesce(score.judge_station, score.judge_id)))
      from score_candidates
      where score.id = score_candidates.id
        and score_candidates.judge_identity_id is not null;

      update public.score_overrides log
      set judge_identity_id = override_candidates.judge_identity_id,
          judge_station = upper(trim(coalesce(log.judge_station, log.judge_id)))
      from override_candidates
      where log.id = override_candidates.id
        and override_candidates.judge_identity_id is not null;

      update public.interference_calls call
      set judge_identity_id = interference_candidates.judge_identity_id,
          judge_station = upper(trim(coalesce(call.judge_station, call.judge_id)))
      from interference_candidates
      where call.id = interference_candidates.id
        and interference_candidates.judge_identity_id is not null;
    $sql$;
  else
    execute $sql$
      update public.scores
      set judge_station = upper(trim(coalesce(judge_station, judge_id)))
      where judge_station is null or trim(judge_station) = '';

      update public.score_overrides
      set judge_station = upper(trim(coalesce(judge_station, judge_id)))
      where judge_station is null or trim(judge_station) = '';

      update public.interference_calls
      set judge_station = upper(trim(coalesce(judge_station, judge_id)))
      where judge_station is null or trim(judge_station) = '';
    $sql$;
  end if;
end
$$;
