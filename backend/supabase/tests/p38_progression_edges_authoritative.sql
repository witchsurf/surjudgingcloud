-- P3.8 qualifier propagation regression suite.
-- Run only on a disposable database. Everything is rolled back.
begin;

-- This suite constructs synthetic scored heats. Runtime score-entry guards are
-- not under test here; rollback restores the trigger state.
alter table public.scores disable trigger user;

do $$
declare
  e constant bigint := 93881;
  a bigint;
  b bigint;
  c bigint;
begin
  insert into public.events (id, name, organizer, start_date, end_date, price, status, categories, judges)
  values (e, 'P3.8 edge authority regression', 'test', current_date, current_date, 0, 'pending', '[]', '[]');

  insert into public.participants (event_id, category, seed, name)
    values (e, 'P38_EDGE', 1, 'A') returning id into a;
  insert into public.participants (event_id, category, seed, name) values
    (e, 'P38_EDGE', 2, 'B'), (e, 'P38_EDGE', 3, 'C');
  select id into b from public.participants where event_id = e and category = 'P38_EDGE' and name = 'B';
  select id into c from public.participants where event_id = e and category = 'P38_EDGE' and name = 'C';

  insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order) values
    ('p38e_r1_h1', e, 'P38 edge', 'P38_EDGE', 1, 1, 2, 'open', array['RED','WHITE']),
    ('p38e_r1_h2', e, 'P38 edge', 'P38_EDGE', 1, 2, 1, 'open', array['RED']),
    ('p38e_r2_h1', e, 'P38 edge', 'P38_EDGE', 2, 1, 2, 'waiting', array['RED','WHITE']),
    ('p38e_r2_h2', e, 'P38 edge', 'P38_EDGE', 2, 2, 1, 'waiting', array['RED']);
  insert into public.heat_entries (heat_id, participant_id, position, seed, color) values
    ('p38e_r1_h1', a, 1, 1, 'RED'), ('p38e_r1_h1', b, 2, 2, 'WHITE'),
    ('p38e_r1_h2', c, 1, 3, 'RED');
  insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position) values
    ('p38e_r2_h1', 1, 'QUALIFIE R1-H1 P1', 1, 1, 1),
    ('p38e_r2_h1', 2, 'QUALIFIE R1-H2 P1', 1, 2, 1),
    ('p38e_r2_h2', 1, 'QUALIFIE R1-H1 P2', 1, 1, 2);
  insert into public.heat_progression_edges (event_id, category, target_heat_id, target_position, source_round, source_heat, source_position, progression_type) values
    (e, 'P38_EDGE', 'p38e_r2_h1', 1, 1, 'p38e_r1_h1', 1, 'COMPETITION_RESULT'),
    (e, 'P38_EDGE', 'p38e_r2_h1', 2, 1, 'p38e_r1_h2', 1, 'COMPETITION_RESULT');
  insert into public.scores (id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, surfer, wave_number, score, timestamp) values
    ('93881000-0000-4000-8000-000000000001', e, 'p38e_r1_h1', 'P38 edge', 'P38_EDGE', 1, 'J1', 'J1', 'J1', 'RED', 1, 9, now()),
    ('93881000-0000-4000-8000-000000000002', e, 'p38e_r1_h1', 'P38 edge', 'P38_EDGE', 1, 'J1', 'J1', 'J1', 'WHITE', 1, 5, now());

  perform public.fn_propagate_qualifiers_for_source_heat('p38e_r1_h1');
  if not exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h1' and position = 1 and participant_id = a) then
    raise exception 'P3.8 direct: edge destination was not hydrated';
  end if;
  if exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h2' and position = 1) then
    raise exception 'P3.8 direct: mapping-only destination was hydrated';
  end if;
  if exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h1' and position = 2) then
    raise exception 'P3.8 direct: edge from unscored source was hydrated';
  end if;

  delete from public.heat_entries where heat_id in ('p38e_r2_h1', 'p38e_r2_h2');
  perform public.rebuild_division_qualifiers_from_scores(e, 'P38_EDGE');
  if not exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h1' and position = 1 and participant_id = a)
     or exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h1' and position = 2)
     or exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h2' and position = 1) then
    raise exception 'P3.8 rebuild diverged from edge-aware propagation';
  end if;

  -- The actual close path must retain the same propagation truth and its
  -- existing lifecycle behavior (close H1, activate H2 on the podium).
  delete from public.heat_entries where heat_id in ('p38e_r2_h1', 'p38e_r2_h2');
  perform public.set_podium_judge_panel(
    e, 'A', jsonb_build_array(jsonb_build_object('station', 'J1', 'judge_id', 'p38_j1', 'judge_name', 'P38 J1')), 'p38-test'
  );
  perform public.activate_heat_on_podium(e, 'A', 'p38e_r1_h1', 'p38-test');
  perform public.upsert_heat_realtime_config('p38e_r1_h1', 'running', true, now(), true, 20, false, null, 'p38-test');
  perform public.close_heat_on_podium_strict(e, 'A', 'p38e_r1_h1', null, 'p38-test', false, null);
  if not exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h1' and position = 1 and participant_id = a)
     or exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h1' and position = 2)
     or exists (select 1 from public.heat_entries where heat_id = 'p38e_r2_h2' and position = 1) then
    raise exception 'P3.8 close diverged from edge-aware propagation';
  end if;
  if not exists (select 1 from public.heats where id = 'p38e_r1_h1' and status = 'closed' and not is_active)
     or not exists (select 1 from public.active_heat_pointer where event_id = e and podium_id = 'A' and active_heat_id = 'p38e_r1_h2') then
    raise exception 'P3.8 close lifecycle regressed';
  end if;

  -- Legacy category: no progression edges, mapping behavior remains unchanged.
  insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order) values
    ('p38l_r1_h1', e, 'Legacy', 'LEGACY_EDGELESS', 1, 10, 2, 'open', array['RED','WHITE']),
    ('p38l_r2_h1', e, 'Legacy', 'LEGACY_EDGELESS', 2, 1, 1, 'waiting', array['RED']);
  insert into public.heat_entries (heat_id, participant_id, position, seed, color) values
    ('p38l_r1_h1', a, 1, 1, 'RED'), ('p38l_r1_h1', b, 2, 2, 'WHITE');
  insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    values ('p38l_r2_h1', 1, 'QUALIFIE R1-H10 P2', 1, 10, 2);
  insert into public.scores (id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, surfer, wave_number, score, timestamp) values
    ('93881000-0000-4000-8000-000000000003', e, 'p38l_r1_h1', 'Legacy', 'LEGACY_EDGELESS', 1, 'J1', 'J1', 'J1', 'RED', 1, 9, now()),
    ('93881000-0000-4000-8000-000000000004', e, 'p38l_r1_h1', 'Legacy', 'LEGACY_EDGELESS', 1, 'J1', 'J1', 'J1', 'WHITE', 1, 5, now());
  perform public.fn_propagate_qualifiers_for_source_heat('p38l_r1_h1');
  if not exists (select 1 from public.heat_entries where heat_id = 'p38l_r2_h1' and position = 1 and participant_id = b) then
    raise exception 'Legacy mapping fallback regressed';
  end if;
end
$$;

alter table public.scores enable trigger user;
rollback;
