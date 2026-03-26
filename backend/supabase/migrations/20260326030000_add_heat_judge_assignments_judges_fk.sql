do $$
declare
  has_judges_table boolean;
  has_constraint boolean;
  invalid_references bigint;
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

  select exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'heat_judge_assignments'
      and constraint_name = 'heat_judge_assignments_judge_id_fkey'
  ) into has_constraint;

  if has_constraint then
    return;
  end if;

  select count(*)
    into invalid_references
  from public.heat_judge_assignments assignment
  left join public.judges judge
    on judge.id = assignment.judge_id
  where judge.id is null;

  if invalid_references > 0 then
    raise notice 'Skipping heat_judge_assignments -> judges FK: % invalid judge_id reference(s) remain.', invalid_references;
    return;
  end if;

  alter table public.heat_judge_assignments
    add constraint heat_judge_assignments_judge_id_fkey
    foreign key (judge_id)
    references public.judges(id)
    on delete restrict;
end
$$;
