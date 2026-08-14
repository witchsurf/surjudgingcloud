-- Read-only regression assertions. Run after applying the forward migration.
-- The fixture must contain one scored entry and at least two legitimate
-- untouched entries; no score rows are inserted by this script.
begin;
do $$
declare
  v_heat text := 'mamelles_open_cadet_r1_h2';
  v_entries integer;
  v_ranked integer;
  v_zero integer;
begin
  select count(*) into v_entries from public.heat_entries where heat_id = v_heat and participant_id is not null;
  select count(*) into v_ranked from public.fn_rank_heat_entries_from_scores(v_heat);
  select count(*) into v_zero
    from public.fn_rank_heat_entries_from_scores(v_heat) ranked
    where ranked.best_two = 0;
  if v_ranked <> v_entries then
    raise exception 'P2.7.72 invariant failed: ranked %, entries %', v_ranked, v_entries;
  end if;
  if v_zero < 2 then
    raise exception 'P2.7.72 expected at least two zero-score ranked entries, got %', v_zero;
  end if;
end $$;
rollback;
