do $$
declare
  has_judges_table boolean;
  judge_id_type text;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'judges'
  ) into has_judges_table;

  if not has_judges_table then
    raise notice 'Skipping heat_judge_assignments -> judges FK: public.judges does not exist.';
    return;
  end if;

  select data_type
    into judge_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'heat_judge_assignments'
    and column_name = 'judge_id';

  if judge_id_type is distinct from 'uuid' then
    raise notice 'Skipping heat_judge_assignments -> judges FK: heat_judge_assignments.judge_id is %, expected uuid.', coalesce(judge_id_type, 'unknown');
    return;
  end if;
end
$$;
