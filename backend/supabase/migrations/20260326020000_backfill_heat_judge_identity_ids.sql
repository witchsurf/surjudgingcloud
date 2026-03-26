do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'judges'
  ) then
    execute $sql$
      with unique_judges as (
        select
          lower(trim(name)) as normalized_name,
          min(id) as judge_id,
          count(*) as judge_count
        from public.judges
        where coalesce(active, true) = true
          and char_length(trim(coalesce(name, ''))) > 0
        group by lower(trim(name))
        having count(*) = 1
      )
      update public.heat_judge_assignments assignment
      set
        judge_id = unique_judges.judge_id,
        judge_name = coalesce(nullif(trim(assignment.judge_name), ''), assignment.station),
        updated_at = now()
      from unique_judges
      where lower(trim(coalesce(assignment.judge_name, ''))) = unique_judges.normalized_name
        and (
          assignment.judge_id is null
          or trim(assignment.judge_id) = ''
          or upper(trim(assignment.judge_id)) = upper(trim(assignment.station))
        );
    $sql$;
  end if;
end
$$;
