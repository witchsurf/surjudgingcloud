-- P2.7.75 permanent, isolated DB regression suite.
-- Every fixture uses synthetic event 90775 and is rolled back.
-- This script must never be run against event 10 fixtures or with COMMIT.
begin;

-- Synthetic rows intentionally bypass write-time field guards (timer/podium
-- ownership/canonicalization); the production read/ranking/readiness functions
-- remain fully exercised. The transaction rollback restores trigger state.
alter table public.scores disable trigger user;
alter table public.interference_calls disable trigger user;

do $$
declare
  e bigint := 90775;
  p_red bigint; p_white bigint; p_yellow bigint;
  h text; src text; dst text;
  r text[]; x numeric; blockers jsonb; v_readiness jsonb;
  n integer;
begin
  -- Synthetic event and participants.
  if exists (select 1 from public.events where id=e) then
    raise exception 'fixture event already exists: %', e;
  end if;
  insert into public.events (id,name,organizer,start_date,end_date,price,status,categories,judges)
  values (e,'P2.7.75 synthetic regression','Codex',current_date,current_date,0,'pending','[]','[]');

  insert into public.participants(event_id,category,seed,name)
  values (e,'SYNTH',1,'P2.7.75 RED') returning id into p_red;
  insert into public.participants(event_id,category,seed,name)
  values (e,'SYNTH',2,'P2.7.75 WHITE') returning id into p_white;
  insert into public.participants(event_id,category,seed,name)
  values (e,'SYNTH',3,'P2.7.75 YELLOW') returning id into p_yellow;

  -- Helper-like fixture rows (source totals are one wave, three judges).
  for h,src in select * from (values
    ('p275_a_current','p275_a_source'),('p275_b_current','p275_b_source'),
    ('p275_c_current','p275_c_source'),('p275_d_current','p275_d_source')) q(a,b)
  loop
    insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order)
    values (h,'P2.7.75','SYNTH',2,1,'open',e,3,array['RED','WHITE','YELLOW']);
    insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order)
    values (src,'P2.7.75','SYNTH',1,ascii(substring(src from 6 for 1)) - ascii('a') + 11,'closed',e,3,array['RED','WHITE','YELLOW']);
    insert into public.heat_entries(heat_id,participant_id,position,seed,color) values
      (h,p_red,1,1,'RED'),(h,p_white,2,2,'WHITE'),(h,p_yellow,3,3,'YELLOW'),
      (src,p_red,1,1,'RED'),(src,p_white,2,2,'WHITE'),(src,p_yellow,3,3,'YELLOW');
    insert into public.heat_slot_mappings(heat_id,position,placeholder,source_round,source_heat,source_position) values
      (h,1,'P1',1,ascii(substring(h from 6 for 1)) - ascii('a') + 11,1),(h,2,'P1',1,ascii(substring(h from 6 for 1)) - ascii('a') + 11,2),(h,3,'P1',1,ascii(substring(h from 6 for 1)) - ascii('a') + 11,3);
    insert into public.heat_configs(heat_id,judges,surfers) values
      (h,array['J1','J2','J3'],array['RED','WHITE','YELLOW']),
      (src,array['J1','J2','J3'],array['RED','WHITE','YELLOW']);
    insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name) values
      (h,e,'J1','J1','J1'),(h,e,'J2','J2','J2'),(h,e,'J3','J3','J3'),
      (src,e,'J1','J1','J1'),(src,e,'J2','J2','J2'),(src,e,'J3','J3','J3');
  end loop;
  insert into public.heat_realtime_config(heat_id,status)
    select id,'running' from public.heats where event_id=e
    on conflict (heat_id) do update set status='running';

  -- A: current RED only; inherited WHITE > YELLOW; all entries must rank.
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values
   ('p275_a_r1','p275_a_current','P2.7.75','SYNTH',2,'J1','J1','RED',1,7,now(),e,'J1');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values
   ('p275_a_s_w','p275_a_source','P2.7.75','SYNTH',1,'J1','J1','WHITE',1,9,now(),e,'J1'),
   ('p275_a_s_y','p275_a_source','P2.7.75','SYNTH',1,'J1','J1','YELLOW',1,6,now(),e,'J1');
  select array_agg(color order by rank_pos) into r from public.fn_rank_heat_entries_from_scores('p275_a_current');
  if r <> array['RED','WHITE','YELLOW'] then raise exception 'A failed: %',r; end if;
  select count(*) into n from public.fn_rank_heat_entries_from_scores('p275_a_current') where best_two=0;
  raise notice 'A ranking=% zero_current=% scores=% canonical=% realtime=%', r, n,
    (select count(*) from public.scores where heat_id='p275_a_current'),
    (select count(*) from public.v_scores_canonical_enriched where heat_id='p275_a_current'),
    (select status from public.heat_realtime_config where heat_id='p275_a_current');
  if n <> 2 then raise exception 'A zero-current failed: %',n; end if;

  -- B: no history; seed decides.
  select array_agg(color order by rank_pos) into r from public.fn_rank_heat_entries_from_scores('p275_b_current');
  if r <> array['RED','WHITE','YELLOW'] then raise exception 'B failed: %',r; end if;

  -- C: history beats seed (WHITE source score > YELLOW source score).
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values
   ('p275_c_w','p275_c_source','P2.7.75','SYNTH',1,'J1','J1','WHITE',1,9,now(),e,'J1'),
   ('p275_c_y','p275_c_source','P2.7.75','SYNTH',1,'J1','J1','YELLOW',1,6,now(),e,'J1');
  select array_agg(color order by rank_pos) into r from public.fn_rank_heat_entries_from_scores('p275_c_current');
  if r <> array['RED','WHITE','YELLOW'] then raise exception 'C failed: %',r; end if;

  -- D: current score beats history/seed.
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values
   ('p275_d_w','p275_d_current','P2.7.75','SYNTH',2,'J1','J1','WHITE',1,8,now(),e,'J1'),
   ('p275_d_y','p275_d_source','P2.7.75','SYNTH',1,'J1','J1','YELLOW',1,10,now(),e,'J1');
  select array_agg(color order by rank_pos) into r from public.fn_rank_heat_entries_from_scores('p275_d_current');
  if r[1] <> 'WHITE' then raise exception 'D failed: %',r; end if;

  -- E: three judges, two waves, best-two aggregate and rank.
  h := 'p275_e_full';
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values
    (h,'P2.7.75','SYNTH',1,5,'open',e,3,array['RED','WHITE','YELLOW']);
  insert into public.heat_realtime_config(heat_id,status) values (h,'running');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values
    (h,p_red,1,1,'RED'),(h,p_white,2,2,'WHITE'),(h,p_yellow,3,3,'YELLOW');
  insert into public.heat_configs(heat_id,judges,surfers) values (h,array['J1','J2','J3'],array['RED','WHITE','YELLOW']);
  insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name) values
    (h,e,'J1','J1','J1'),(h,e,'J2','J2','J2'),(h,e,'J3','J3','J3');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station)
  select 'p275_e_'||surfer||'_'||wave_number||'_'||judge_id,h,'P2.7.75','SYNTH',1,judge_id,judge_id,surfer,wave_number,score,now(),e,judge_id
  from (values ('RED',1,'J1',7::numeric),('RED',1,'J2',8),('RED',1,'J3',9),('RED',2,'J1',6),('RED',2,'J2',7),('RED',2,'J3',8),
               ('WHITE',1,'J1',5),('WHITE',1,'J2',6),('WHITE',1,'J3',7),('YELLOW',1,'J1',4),('YELLOW',1,'J2',5),('YELLOW',1,'J3',6)) s(surfer,wave_number,judge_id,score);
  select best_two into x from public.fn_rank_heat_entries_from_scores(h) where color='RED';
  if x::numeric <> 15.00 then raise exception 'E aggregate failed: %',x; end if;

  -- F: configured panel, one submitted score => readiness must block.
  h := 'p275_f_partial';
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values
    (h,'P2.7.75','SYNTH',1,6,'open',e,3,array['RED','WHITE','YELLOW']);
  insert into public.heat_realtime_config(heat_id,status) values (h,'running');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values
    (h,p_red,1,1,'RED'),(h,p_white,2,2,'WHITE'),(h,p_yellow,3,3,'YELLOW');
  insert into public.heat_configs(heat_id,judges,surfers) values (h,array['J1','J2','J3'],array['RED','WHITE','YELLOW']);
  insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name) values
    (h,e,'J1','J1','J1'),(h,e,'J2','J2','J2'),(h,e,'J3','J3','J3');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station)
    values ('p275_f_score',h,'P2.7.75','SYNTH',1,'J1','J1','RED',1,7,now(),e,'J1');
  v_readiness := public.fn_get_heat_close_readiness(h);
  if coalesce((v_readiness->>'can_close')::boolean,true) or not (v_readiness->'blockers' @> '[{"code":"MISSING_SCORES"}]') then raise exception 'F failed: %',v_readiness; end if;

  -- G: untouched legitimate entries do not create missing-score blockers once a complete scored wave exists.
  h := 'p275_g_untouched';
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values
    (h,'P2.7.75','SYNTH',1,7,'open',e,3,array['RED','WHITE','YELLOW']);
  insert into public.heat_realtime_config(heat_id,status) values (h,'running');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values
    (h,p_red,1,1,'RED'),(h,p_white,2,2,'WHITE'),(h,p_yellow,3,3,'YELLOW');
  insert into public.heat_configs(heat_id,judges,surfers) values (h,array['J1'],array['RED','WHITE','YELLOW']);
  insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name) values (h,e,'J1','J1','J1');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values ('p275_g_score',h,'P2.7.75','SYNTH',1,'J1','J1','RED',1,7,now(),e,'J1');
  v_readiness := public.fn_get_heat_close_readiness(h);
  if (v_readiness->'summary'->>'missing_score_count')::integer <> 0 then raise exception 'G failed: %',v_readiness; end if;

  -- H: INT1 exact formula: best-two 14 minus half of second wave (6) = 11.
  h := 'p275_h_int1';
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values (h,'P2.7.75','SYNTH',1,8,'open',e,3,array['RED','WHITE','YELLOW']);
  insert into public.heat_realtime_config(heat_id,status) values (h,'running');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values (h,p_red,1,1,'RED'),(h,p_white,2,2,'WHITE'),(h,p_yellow,3,3,'YELLOW');
  insert into public.heat_configs(heat_id,judges,surfers) values (h,array['J1'],array['RED','WHITE','YELLOW']);
  insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name) values (h,e,'J1','J1','J1');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values
   ('p275_h_1',h,'P2.7.75','SYNTH',1,'J1','J1','RED',1,8,now(),e,'J1'),('p275_h_2',h,'P2.7.75','SYNTH',1,'J1','J1','RED',2,6,now(),e,'J1');
  insert into public.interference_calls(event_id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,call_type) values (e,h,'P2.7.75','SYNTH',1,'J1','J1','RED',1,'INT1');
  select best_two into x from public.fn_rank_heat_entries_from_scores(h) where color='RED';
  if x::numeric <> 11.00 then raise exception 'H failed: %',x; end if;

  -- I: INT2 leaves best wave; a one-wave case is also supported.
  h := 'p275_i_int2';
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values (h,'P2.7.75','SYNTH',1,9,'open',e,3,array['RED','WHITE','YELLOW']);
  insert into public.heat_realtime_config(heat_id,status) values (h,'running');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values (h,p_red,1,1,'RED'),(h,p_white,2,2,'WHITE'),(h,p_yellow,3,3,'YELLOW');
  insert into public.heat_configs(heat_id,judges,surfers) values (h,array['J1'],array['RED','WHITE','YELLOW']);
  insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name) values (h,e,'J1','J1','J1');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station) values
   ('p275_i_1',h,'P2.7.75','SYNTH',1,'J1','J1','RED',1,8,now(),e,'J1'),('p275_i_2',h,'P2.7.75','SYNTH',1,'J1','J1','RED',2,5,now(),e,'J1');
  insert into public.interference_calls(event_id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,call_type) values (e,h,'P2.7.75','SYNTH',1,'J1','J1','RED',1,'INT2');
  select best_two into x from public.fn_rank_heat_entries_from_scores(h) where color='RED';
  if x::numeric <> 8.00 then raise exception 'I failed: %',x; end if;

  -- J: propagation must place an unscored qualifier in the exact mapped slot.
  src := 'p275_j_source'; dst := 'p275_j_destination';
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values
    (src,'P2.7.75','QUAL',1,10,'closed',e,3,array['RED','WHITE','YELLOW']),
    (dst,'P2.7.75','QUAL',2,1,'waiting',e,3,array['RED','WHITE','YELLOW']);
  insert into public.heat_realtime_config(heat_id,status) values (src,'closed'),(dst,'waiting');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values
    (src,p_red,1,1,'RED'),(src,p_white,2,2,'WHITE'),(src,p_yellow,3,3,'YELLOW');
  insert into public.heat_configs(heat_id,judges,surfers) values
    (src,array['J1'],array['RED','WHITE','YELLOW']);
  insert into public.heat_judge_assignments(heat_id,event_id,station,judge_id,judge_name)
    values (src,e,'J1','J1','J1');
  insert into public.scores(id,heat_id,competition,division,round,judge_id,judge_name,surfer,wave_number,score,timestamp,event_id,judge_station)
    values ('p275_j_red',src,'P2.7.75','QUAL',1,'J1','J1','RED',1,8,now(),e,'J1');
  insert into public.heat_slot_mappings(heat_id,position,placeholder,source_round,source_heat,source_position) values (dst,1,'QUALIFIE R1-H10 (P1)',1,10,1);
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values (dst,null,1,1,'RED');
  perform public.fn_propagate_qualifiers_for_source_heat(src);
  if not exists (select 1 from public.heat_entries where heat_id=dst and position=1 and participant_id=p_red) then raise exception 'J failed: qualifier not propagated'; end if;

  -- K: cardinality regression. Two source divisions share the same
  -- (event, round, heat_number); the current production lineage join is
  -- expected to fail this assertion until its division semantics are fixed.
  insert into public.heats(id,competition,division,round,heat_number,status,event_id,heat_size,color_order) values
    ('p275_k_source_a','P2.7.75','K_TARGET',1,20,'closed',e,1,array['RED']),
    ('p275_k_source_b','P2.7.75','K_B',1,20,'closed',e,1,array['RED']),
    ('p275_k_target','P2.7.75','K_TARGET',2,1,'waiting',e,1,array['RED']);
  insert into public.heat_realtime_config(heat_id,status) values
    ('p275_k_source_a','closed'),('p275_k_source_b','closed'),('p275_k_target','waiting');
  insert into public.heat_entries(heat_id,participant_id,position,seed,color) values
    ('p275_k_source_a',p_red,1,1,'RED'),('p275_k_source_b',p_white,1,2,'RED'),('p275_k_target',p_red,1,1,'RED');
  insert into public.heat_slot_mappings(heat_id,position,placeholder,source_round,source_heat,source_position)
    values ('p275_k_target',1,'K',1,20,1);
  select count(*) into n from public.fn_rank_heat_entries_from_scores('p275_k_target');
  if n <> 1 then raise exception 'K failed before patch: expected 1 row, got %', n; end if;

  raise notice 'P2.7.75 A-J PASS (synthetic event %, transaction will rollback)', e;
end $$;

alter table public.scores enable trigger user;
alter table public.interference_calls enable trigger user;
rollback;
