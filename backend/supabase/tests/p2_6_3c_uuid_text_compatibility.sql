\set ON_ERROR_STOP on

begin;

create schema p263c_cloud_like;
create schema p263c_mac_like;

create table p263c_cloud_like.scores (
  id uuid primary key,
  heat_id text not null
);
create table p263c_cloud_like.score_overrides (
  id uuid primary key,
  heat_id text not null,
  score_id text not null
);

create table p263c_mac_like.scores (
  id text primary key,
  heat_id text not null
);
create table p263c_mac_like.score_overrides (
  id uuid primary key,
  heat_id text not null,
  score_id text not null
);

create function p263c_cloud_like.override_count(p_heat_id text)
returns bigint language sql stable as $$
  select count(*)
  from p263c_cloud_like.score_overrides score_override
  where score_override.heat_id = p_heat_id
     or exists (
       select 1
       from p263c_cloud_like.scores override_score
       where override_score.id::text = score_override.score_id
         and override_score.heat_id = p_heat_id
     );
$$;

create function p263c_mac_like.override_count(p_heat_id text)
returns bigint language sql stable as $$
  select count(*)
  from p263c_mac_like.score_overrides score_override
  where score_override.heat_id = p_heat_id
     or exists (
       select 1
       from p263c_mac_like.scores override_score
       where override_score.id::text = score_override.score_id
         and override_score.heat_id = p_heat_id
     );
$$;

insert into p263c_cloud_like.scores values
  ('00000000-0000-4000-8000-000000000001', 'HEAT-LINKED');
insert into p263c_cloud_like.score_overrides values
  ('10000000-0000-4000-8000-000000000001', 'HEAT-OTHER', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'HEAT-ORPHAN', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'HEAT-NONUUID', 'legacy-score-id'),
  ('10000000-0000-4000-8000-000000000004', 'HEAT-DIRECT', '00000000-0000-4000-8000-000000000003');

insert into p263c_mac_like.scores values
  ('00000000-0000-4000-8000-000000000001', 'HEAT-LINKED');
insert into p263c_mac_like.score_overrides
select * from p263c_cloud_like.score_overrides;

do $$
begin
  if p263c_cloud_like.override_count('HEAT-LINKED') <> 1 then
    raise exception 'Cloud-like linked override was not detected';
  end if;
  if p263c_cloud_like.override_count('HEAT-DIRECT') <> 1 then
    raise exception 'Cloud-like direct override was not detected';
  end if;
  if p263c_cloud_like.override_count('HEAT-ORPHAN') <> 1 then
    raise exception 'Cloud-like orphan direct override was not detected';
  end if;
  if p263c_cloud_like.override_count('HEAT-NONUUID') <> 1 then
    raise exception 'Cloud-like non-UUID direct override was not detected';
  end if;
  if p263c_mac_like.override_count('HEAT-LINKED') <> 1
     or p263c_mac_like.override_count('HEAT-DIRECT') <> 1
     or p263c_mac_like.override_count('HEAT-ORPHAN') <> 1
     or p263c_mac_like.override_count('HEAT-NONUUID') <> 1 then
    raise exception 'Mac-like compatibility differs from Cloud-like behavior';
  end if;
end;
$$;

rollback;

\echo 'P2.6.3C uuid/text compatibility: PASS'
