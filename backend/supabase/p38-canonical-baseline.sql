-- SurfJudging P3.8 canonical application baseline
-- Schema version: 20260820000000_p38_canonical_baseline
-- Source state: P3.7C historical migrations through
--   20260814220000_fix_exhaustive_ranking_lineage_division
-- Target: supabase/postgres:15.1.0.147
-- Scope: SurfJudging-owned objects in public plus the runtime schema marker.
-- Vendor-owned auth, storage, graphql_public and _realtime objects are initialized
-- by their official images/services and are intentionally outside this file.

-- Dumped from database version 15.1 (Ubuntu 15.1-1.pgdg20.04+1)
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    RAISE EXCEPTION 'P38_BASELINE_REQUIRES_FRESH_APPLICATION_SCHEMA';
  END IF;
END
$$;

-- The Supabase image grants broad privileges through postgres-owned default
-- ACLs. Historical SurfJudging migrations later narrowed individual objects.
-- Suspend those defaults while creating the canonical objects so the explicit
-- ACL section below is authoritative, then restore them before commit.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: activate_event_for_test(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_event_for_test(p_event_id bigint) RETURNS TABLE(event_id bigint, test_activated_at timestamp with time zone, test_activated_by uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_mode text := public.get_authoritative_deployment_mode();
  v_user_id uuid := auth.uid();
  v_enabled boolean := false;
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
begin
  if v_mode <> 'cloud' then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_CLOUD_ONLY';
  end if;
  if v_user_id is null or coalesce((v_claims ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_AUTH_REQUIRED';
  end if;
  select cloud_test_activation_enabled into v_enabled
    from public.app_deployment_config where id = true;
  if not coalesce(v_enabled, false) then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_DISABLED';
  end if;
  if not exists (select 1 from public.app_cloud_test_activators where user_id = v_user_id) then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception using errcode = 'P0002', message = 'EVENT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.user_id = v_user_id) then
    raise exception using errcode = '42501', message = 'EVENT_OWNER_REQUIRED';
  end if;
  if exists (select 1 from public.events e where e.id = p_event_id and e.paid) then
    raise exception using errcode = '22023', message = 'EVENT_ALREADY_PAID';
  end if;
  if exists (select 1 from public.events e where e.id = p_event_id and e.test_activated_at is not null) then
    raise exception using errcode = '22023', message = 'EVENT_ALREADY_TEST_ACTIVATED';
  end if;
  return query
  update public.events e
     set test_activated_at = clock_timestamp(), test_activated_by = v_user_id
   where e.id = p_event_id
  returning e.id, e.test_activated_at, e.test_activated_by;
end;
$$;


--
-- Name: activate_heat_on_podium(bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text DEFAULT 'admin'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat record;
  v_panel_size integer;
begin
  select id, competition, division, round, heat_number, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id)
    and event_id = p_event_id
  for update;

  if not found then
    raise exception 'Heat % does not belong to event %', p_heat_id, p_event_id using errcode = '23503';
  end if;

  if coalesce(v_heat.status, '') = 'closed' then
    raise exception 'Closed heat % cannot be activated', v_heat.id using errcode = '23514';
  end if;

  v_panel_size := public.copy_podium_panel_to_heat(
    p_event_id,
    v_podium_id,
    v_heat.id,
    p_assigned_by
  );

  perform public.upsert_active_heat_pointer(
    p_event_id,
    v_heat.competition,
    v_heat.id,
    now(),
    v_podium_id
  );

  update public.heats
     set status = case when status = 'waiting' then 'open' else status end,
         is_active = true,
         updated_at = now()
   where id = v_heat.id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'podium_id', v_podium_id,
    'heat_id', v_heat.id,
    'division', v_heat.division,
    'round', v_heat.round,
    'heat_number', v_heat.heat_number,
    'panel_size', v_panel_size
  );
end;
$$;


--
-- Name: admin_override_heat_entry(text, integer, text, bigint, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_override_heat_entry(p_heat_id text, p_position integer, p_color text DEFAULT NULL::text, p_participant_id bigint DEFAULT NULL::bigint, p_name text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_created_by text DEFAULT 'chief_judge'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_heat record;
  v_participant record;
  v_existing_participant_id bigint;
  v_existing_seed integer;
  v_existing_color text;
  v_existing_participant_name text;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_country text := nullif(trim(coalesce(p_country, '')), '');
  v_color text := nullif(upper(trim(coalesce(p_color, ''))), '');
  v_seed integer;
  v_surfers jsonb := '[]'::jsonb;
  v_surfer_names jsonb := '{}'::jsonb;
  v_surfer_countries jsonb := '{}'::jsonb;
  v_config_patch jsonb;
begin
  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'HEAT_ID_REQUIRED';
  end if;

  if p_position is null or p_position < 1 then
    raise exception 'POSITION_REQUIRED';
  end if;

  select h.id, h.event_id, h.division, h.round, h.heat_number, h.color_order
    into v_heat
  from public.heats h
  where h.id = trim(p_heat_id)
  limit 1;

  if not found then
    raise exception 'HEAT_NOT_FOUND:%', p_heat_id;
  end if;

  select he.participant_id, he.seed, he.color, p.name
    into v_existing_participant_id, v_existing_seed, v_existing_color, v_existing_participant_name
  from public.heat_entries he
  left join public.participants p on p.id = he.participant_id
  where he.heat_id = v_heat.id
    and he.position = p_position
  limit 1;

  v_color := coalesce(
    v_color,
    nullif(upper(trim(coalesce(v_existing_color, ''))), ''),
    nullif(upper(trim(coalesce(v_heat.color_order[p_position], ''))), '')
  );

  if p_participant_id is not null then
    select p.id, p.seed, p.name, p.country
      into v_participant
    from public.participants p
    where p.id = p_participant_id
      and (v_heat.event_id is null or p.event_id = v_heat.event_id)
    limit 1;

    if not found then
      raise exception 'PARTICIPANT_NOT_FOUND:%', p_participant_id;
    end if;
  else
    if v_name is null then
      raise exception 'PARTICIPANT_NAME_REQUIRED';
    end if;

    select p.id, p.seed, p.name, p.country
      into v_participant
    from public.participants p
    where (v_heat.event_id is null or p.event_id = v_heat.event_id)
      and lower(trim(coalesce(p.category, ''))) = lower(trim(coalesce(v_heat.division, '')))
      and lower(trim(coalesce(p.name, ''))) = lower(v_name)
    order by p.seed asc nulls last, p.id asc
    limit 1;

    if not found then
      select coalesce(max(p.seed), 0) + 1
        into v_seed
      from public.participants p
      where (v_heat.event_id is null or p.event_id = v_heat.event_id)
        and lower(trim(coalesce(p.category, ''))) = lower(trim(coalesce(v_heat.division, '')));

      insert into public.participants (event_id, category, seed, name, country, license)
      values (v_heat.event_id, v_heat.division, v_seed, v_name, v_country, null)
      returning id, seed, name, country
      into v_participant;
    end if;
  end if;

  insert into public.heat_entries (heat_id, participant_id, position, seed, color)
  values (
    v_heat.id,
    v_participant.id,
    p_position,
    coalesce(v_participant.seed, v_existing_seed, p_position),
    v_color
  )
  on conflict (heat_id, position) do update
    set participant_id = excluded.participant_id,
        seed = excluded.seed,
        color = coalesce(excluded.color, public.heat_entries.color);

  insert into public.heat_entry_overrides (
    event_id,
    heat_id,
    position,
    color,
    previous_participant_id,
    previous_participant_name,
    new_participant_id,
    new_participant_name,
    new_country,
    reason,
    created_by
  )
  values (
    v_heat.event_id,
    v_heat.id,
    p_position,
    v_color,
    v_existing_participant_id,
    v_existing_participant_name,
    v_participant.id,
    v_participant.name,
    coalesce(v_participant.country, v_country),
    nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(nullif(trim(coalesce(p_created_by, '')), ''), 'chief_judge')
  );

  with lineup as (
    select
      he.position,
      nullif(upper(trim(coalesce(he.color, v_heat.color_order[he.position], ''))), '') as color,
      p.name,
      p.country
    from public.heat_entries he
    left join public.participants p on p.id = he.participant_id
    where he.heat_id = v_heat.id
    order by he.position asc
  )
  select
    coalesce(jsonb_agg(color order by position) filter (where color is not null), '[]'::jsonb),
    coalesce(jsonb_object_agg(color, name) filter (where color is not null and name is not null), '{}'::jsonb),
    coalesce(jsonb_object_agg(color, country) filter (where color is not null and country is not null), '{}'::jsonb)
    into v_surfers, v_surfer_names, v_surfer_countries
  from lineup;

  v_config_patch := jsonb_build_object(
    'surfers', v_surfers,
    'surferNames', v_surfer_names,
    'surferCountries', v_surfer_countries,
    'surfersPerHeat', jsonb_array_length(v_surfers)
  );

  insert into public.heat_realtime_config (heat_id, config_data, updated_by)
  values (v_heat.id, v_config_patch, coalesce(nullif(trim(coalesce(p_created_by, '')), ''), 'chief_judge'))
  on conflict (heat_id) do update
    set config_data = coalesce(public.heat_realtime_config.config_data, '{}'::jsonb) || excluded.config_data,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return jsonb_build_object(
    'heat_id', v_heat.id,
    'position', p_position,
    'color', v_color,
    'participant_id', v_participant.id,
    'name', v_participant.name,
    'country', coalesce(v_participant.country, v_country),
    'config_patch', v_config_patch
  );
end;
$$;


--
-- Name: apply_score_correction_secure(uuid, text, boolean, text, boolean, integer, boolean, numeric, timestamp with time zone, uuid, text, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_score_correction_secure(p_score_id uuid, p_heat_id text DEFAULT NULL::text, p_set_surfer boolean DEFAULT false, p_surfer text DEFAULT NULL::text, p_set_wave_number boolean DEFAULT false, p_wave_number integer DEFAULT NULL::integer, p_set_score boolean DEFAULT false, p_score numeric DEFAULT NULL::numeric, p_timestamp timestamp with time zone DEFAULT now(), p_log_id uuid DEFAULT NULL::uuid, p_log_reason text DEFAULT NULL::text, p_log_comment text DEFAULT NULL::text, p_log_overridden_by text DEFAULT NULL::text, p_log_overridden_by_name text DEFAULT NULL::text, p_log_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_before public.scores%rowtype;
  v_after public.scores%rowtype;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;

  select * into v_before
  from public.scores
  where id = p_score_id::text
    and (p_heat_id is null or heat_id = trim(p_heat_id));

  if not found then
    raise exception 'score % not found', p_score_id;
  end if;

  update public.scores
     set surfer = case when p_set_surfer then coalesce(nullif(trim(coalesce(p_surfer, '')), ''), surfer) else surfer end,
         wave_number = case when p_set_wave_number then coalesce(p_wave_number, wave_number) else wave_number end,
         score = case when p_set_score then coalesce(p_score, score) else score end,
         timestamp = coalesce(p_timestamp, now())
   where id = p_score_id::text
   returning * into v_after;

  if p_log_id is not null then
    perform public.record_score_override_secure(
      p_log_id,
      v_after.heat_id,
      v_after.id::uuid,
      v_after.judge_id,
      v_after.judge_name,
      v_after.judge_station,
      v_after.judge_identity_id,
      v_after.surfer,
      v_after.wave_number,
      v_before.score,
      v_after.score,
      p_log_reason,
      p_log_comment,
      p_log_overridden_by,
      p_log_overridden_by_name,
      coalesce(p_log_created_at, p_timestamp, now())
    );
  end if;

  return to_jsonb(v_after);
end;
$$;


--
-- Name: assert_no_active_podium_judge_conflict(bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_no_active_podium_judge_conflict(p_event_id bigint, p_active_heat_id text, p_podium_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_conflict record;
begin
  if p_event_id is null or nullif(trim(coalesce(p_active_heat_id, '')), '') is null then
    return;
  end if;

  select
    current_assignment.judge_id,
    current_assignment.judge_name,
    current_assignment.station as current_station,
    other_assignment.station as other_station,
    other_pointer.podium_id as other_podium_id,
    other_pointer.active_heat_id as other_heat_id
  into v_conflict
  from public.heat_judge_assignments current_assignment
  join public.active_heat_pointer other_pointer
    on other_pointer.event_id = p_event_id
   and other_pointer.active_heat_id is not null
   and other_pointer.active_heat_id <> p_active_heat_id
   and upper(trim(coalesce(other_pointer.podium_id, 'A'))) <> upper(trim(coalesce(p_podium_id, 'A')))
  join public.heat_judge_assignments other_assignment
    on other_assignment.heat_id = other_pointer.active_heat_id
   and lower(trim(other_assignment.judge_id)) = lower(trim(current_assignment.judge_id))
  where current_assignment.heat_id = p_active_heat_id
    and public.is_official_judge_assignment_id(current_assignment.judge_id)
    and public.is_official_judge_assignment_id(other_assignment.judge_id)
  limit 1;

  if found then
    raise exception
      'Judge % is already assigned to active podium % heat %',
      coalesce(v_conflict.judge_name, v_conflict.judge_id),
      coalesce(v_conflict.other_podium_id, 'A'),
      v_conflict.other_heat_id
      using errcode = '23514';
  end if;
end;
$$;


--
-- Name: bulk_sync_scores(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_sync_scores(p_scores jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Insert or update scores from the provided JSON array
  -- We use ON CONFLICT (id) DO UPDATE to ensure existing scores (if any) are refreshed
  INSERT INTO public.scores (
    id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, event_id, created_at
  )
  SELECT
    (row->>'id')::text,
    (row->>'heat_id')::text,
    (row->>'competition')::text,
    (row->>'division')::text,
    (row->>'round')::int,
    (row->>'judge_id')::text,
    (row->>'judge_name')::text,
    (row->>'surfer')::text,
    (row->>'wave_number')::int,
    (row->>'score')::numeric,
    (row->>'timestamp')::timestamptz,
    (row->>'event_id')::bigint,
    (row->>'created_at')::timestamptz
  FROM jsonb_array_elements(p_scores) AS row
  ON CONFLICT (id) DO UPDATE SET
    heat_id = EXCLUDED.heat_id,
    competition = EXCLUDED.competition,
    division = EXCLUDED.division,
    round = EXCLUDED.round,
    judge_id = EXCLUDED.judge_id,
    judge_name = EXCLUDED.judge_name,
    surfer = EXCLUDED.surfer,
    wave_number = EXCLUDED.wave_number,
    score = EXCLUDED.score,
    timestamp = EXCLUDED.timestamp,
    event_id = EXCLUDED.event_id,
    created_at = EXCLUDED.created_at;
END;
$$;


--
-- Name: bulk_upsert_heats(jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_upsert_heats(p_heats jsonb DEFAULT '[]'::jsonb, p_entries jsonb DEFAULT '[]'::jsonb, p_mappings jsonb DEFAULT '[]'::jsonb, p_participants jsonb DEFAULT '[]'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_heat_ids text[];
begin
  if jsonb_array_length(p_heats) > 0 then
    select array_agg(id)
      into v_heat_ids
      from jsonb_to_recordset(p_heats) as t(id text);
  else
    v_heat_ids := array[]::text[];
  end if;

  if v_heat_ids is not null and array_length(v_heat_ids, 1) > 0 then
    delete from public.heat_slot_mappings where heat_id = any(v_heat_ids);
    delete from public.heat_entries where heat_id = any(v_heat_ids);
    delete from public.heat_realtime_config where heat_id = any(v_heat_ids);
    delete from public.heats where id = any(v_heat_ids);
  end if;

  if jsonb_array_length(p_participants) > 0 then
    insert into public.participants (event_id, category, seed, name, country, license)
    select event_id, category, seed, name, country, license
    from jsonb_to_recordset(p_participants)
      as t(event_id bigint, category text, seed int, name text, country text, license text)
    on conflict (event_id, category, seed) do update
      set name = excluded.name,
          country = excluded.country,
          license = excluded.license;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order, created_at)
    select id, event_id, competition, division, round, heat_number, heat_size, status, color_order, coalesce(created_at, now())
    from jsonb_to_recordset(p_heats)
      as t(id text, event_id bigint, competition text, division text, round integer, heat_number integer, heat_size integer, status text, color_order text[], created_at timestamptz)
    on conflict (id) do update set
      event_id    = excluded.event_id,
      competition = excluded.competition,
      division    = excluded.division,
      round       = excluded.round,
      heat_number = excluded.heat_number,
      heat_size   = excluded.heat_size,
      status      = excluded.status,
      color_order = excluded.color_order;
  end if;

  if jsonb_array_length(p_mappings) > 0 then
    insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    select heat_id, position, placeholder, source_round, source_heat, source_position
    from jsonb_to_recordset(p_mappings)
      as t(heat_id text, position integer, placeholder text, source_round integer, source_heat integer, source_position integer)
    on conflict (heat_id, position) do update set
      placeholder     = excluded.placeholder,
      source_round    = excluded.source_round,
      source_heat     = excluded.source_heat,
      source_position = excluded.source_position;
  end if;

  if jsonb_array_length(p_entries) > 0 then
    insert into public.heat_entries (heat_id, participant_id, position, seed, color)
    select heat_id, participant_id, position, seed, color
    from jsonb_to_recordset(p_entries)
      as t(heat_id text, participant_id bigint, position integer, seed integer, color text)
    on conflict (heat_id, position) do update set
      participant_id = excluded.participant_id,
      seed           = excluded.seed,
      color          = excluded.color;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heat_realtime_config (heat_id)
    select id
    from jsonb_to_recordset(p_heats) as t(id text)
    on conflict (heat_id) do nothing;
  end if;
end;
$$;


--
-- Name: bulk_upsert_heats(jsonb, jsonb, jsonb, jsonb, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_upsert_heats(p_heats jsonb DEFAULT '[]'::jsonb, p_entries jsonb DEFAULT '[]'::jsonb, p_mappings jsonb DEFAULT '[]'::jsonb, p_participants jsonb DEFAULT '[]'::jsonb, p_delete_ids text[] DEFAULT '{}'::text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
    delete from public.heat_slot_mappings where heat_id = any(p_delete_ids);
    delete from public.heat_entries where heat_id = any(p_delete_ids);
    delete from public.heat_realtime_config where heat_id = any(p_delete_ids);
    delete from public.heats where id = any(p_delete_ids);
  end if;

  if jsonb_array_length(p_participants) > 0 then
    insert into public.participants (event_id, category, seed, name, country, license)
    select event_id, category, seed, name, country, license
    from jsonb_to_recordset(p_participants)
      as t(event_id bigint, category text, seed int, name text, country text, license text)
    on conflict (event_id, category, seed) do update
      set name = excluded.name,
          country = excluded.country,
          license = excluded.license;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heats (id, event_id, competition, division, round, heat_number, heat_size, status, color_order, created_at)
    select id, event_id, competition, division, round, heat_number, heat_size, status, color_order, coalesce(created_at, now())
    from jsonb_to_recordset(p_heats)
      as t(id text, event_id bigint, competition text, division text, round integer, heat_number integer, heat_size integer, status text, color_order text[], created_at timestamptz)
    on conflict (id) do update set
      event_id    = excluded.event_id,
      competition = excluded.competition,
      division    = excluded.division,
      round       = excluded.round,
      heat_number = excluded.heat_number,
      heat_size   = excluded.heat_size,
      status      = excluded.status,
      color_order = excluded.color_order;
  end if;

  if jsonb_array_length(p_mappings) > 0 then
    insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
    select heat_id, position, placeholder, source_round, source_heat, source_position
    from jsonb_to_recordset(p_mappings)
      as t(heat_id text, position integer, placeholder text, source_round integer, source_heat integer, source_position integer)
    on conflict (heat_id, position) do update set
      placeholder     = excluded.placeholder,
      source_round    = excluded.source_round,
      source_heat     = excluded.source_heat,
      source_position = excluded.source_position;
  end if;

  if jsonb_array_length(p_entries) > 0 then
    insert into public.heat_entries (heat_id, participant_id, position, seed, color)
    select heat_id, participant_id, position, seed, color
    from jsonb_to_recordset(p_entries)
      as t(heat_id text, participant_id bigint, position integer, seed integer, color text)
    on conflict (heat_id, position) do update set
      participant_id = excluded.participant_id,
      seed           = excluded.seed,
      color          = excluded.color;
  end if;

  if jsonb_array_length(p_heats) > 0 then
    insert into public.heat_realtime_config (heat_id)
    select id
    from jsonb_to_recordset(p_heats) as t(id text)
    on conflict (heat_id) do nothing;
  end if;
end;
$$;


--
-- Name: bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_upsert_heats_safe(p_event_id bigint, p_category text, p_overwrite boolean DEFAULT false, p_heats jsonb DEFAULT '[]'::jsonb, p_entries jsonb DEFAULT '[]'::jsonb, p_mappings jsonb DEFAULT '[]'::jsonb, p_participants jsonb DEFAULT '[]'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_proposed_heat_ids text[];
  v_target_heat_ids text[];
  v_blocked jsonb;
begin
  if p_event_id is null then raise exception 'event_id is required'; end if;
  if nullif(p_category, '') is null then raise exception 'category is required'; end if;
  if jsonb_typeof(coalesce(p_heats, '[]'::jsonb)) <> 'array' then raise exception 'heats payload must be an array'; end if;

  select coalesce(array_agg(payload.id order by payload.id), '{}'::text[])
    into v_proposed_heat_ids
  from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb))
    as payload(id text, event_id bigint, division text, is_active boolean)
  where payload.id is not null;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb))
      as payload(id text, event_id bigint, division text, is_active boolean)
    where payload.id is null
       or payload.event_id is distinct from p_event_id
       or payload.division is distinct from p_category
       or payload.is_active is distinct from false
  ) then
    raise exception 'heat payload event/category/is_active mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || length(p_category)::text || ':' || p_category, 0));
  perform 1
  from public.heats h
  where h.event_id = p_event_id
    and h.division = p_category
    and (coalesce(p_overwrite, false) or h.id = any(v_proposed_heat_ids))
  for update;
  lock table public.scores, public.score_overrides, public.interference_calls,
    public.heat_judge_assignments, public.heat_timers, public.heat_history,
    public.active_heat_pointer in share row exclusive mode;

  select coalesce(array_agg(inventory.heat_id order by inventory.heat_id), '{}'::text[]),
         jsonb_agg(to_jsonb(inventory) order by inventory.heat_id)
           filter (where cardinality(inventory.blocker_reasons) > 0)
    into v_target_heat_ids, v_blocked
  from public.get_heat_planning_safety_inventory(
    p_event_id,
    p_category,
    v_proposed_heat_ids,
    p_overwrite
  ) inventory;

  if v_blocked is not null then
    raise exception using
      errcode = 'P0001',
      message = 'HEAT_PLANNING_BLOCKED',
      detail = v_blocked::text;
  end if;

  perform public.bulk_upsert_heats(
    coalesce(p_heats, '[]'::jsonb),
    coalesce(p_entries, '[]'::jsonb),
    coalesce(p_mappings, '[]'::jsonb),
    coalesce(p_participants, '[]'::jsonb),
    v_target_heat_ids
  );

  -- bulk_upsert_heats is retained unchanged for rollback and ignores the new
  -- field. Preserve the explicit safe payload atomically before commit.
  update public.heats heat
     set is_active = false
    from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) as payload(id text, is_active boolean)
   where heat.id = payload.id
     and payload.is_active = false;
end;
$$;


--
-- Name: bulk_upsert_heats_safe_v2(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_upsert_heats_safe_v2(p_event_id bigint, p_category text, p_overwrite boolean DEFAULT false, p_heats jsonb DEFAULT '[]'::jsonb, p_entries jsonb DEFAULT '[]'::jsonb, p_mappings jsonb DEFAULT '[]'::jsonb, p_participants jsonb DEFAULT '[]'::jsonb, p_heat_configs jsonb DEFAULT '[]'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_heat_ids text[];
  v_config_heat_ids text[];
begin
  if jsonb_typeof(coalesce(p_heat_configs, '[]'::jsonb)) <> 'array' then
    raise exception 'heat_configs payload must be an array';
  end if;

  select coalesce(array_agg(payload.id order by payload.id), '{}'::text[])
    into v_heat_ids
  from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) as payload(id text);

  select coalesce(array_agg(payload.heat_id order by payload.heat_id), '{}'::text[])
    into v_config_heat_ids
  from jsonb_to_recordset(coalesce(p_heat_configs, '[]'::jsonb)) as payload(heat_id text);

  if v_config_heat_ids is distinct from v_heat_ids
     or exists (
       select 1
       from jsonb_to_recordset(coalesce(p_heat_configs, '[]'::jsonb)) as payload(heat_id text)
       where payload.heat_id is null
     ) then
    raise exception 'heat_configs must match the proposed heat ids exactly';
  end if;

  -- The v1 safe function performs validation, target selection, locking,
  -- blocker recalculation and the historical bulk write. A nested function
  -- call does not commit: the config upsert below remains in the same DB
  -- transaction and any error rolls all planning writes back.
  perform public.bulk_upsert_heats_safe(
    p_event_id,
    p_category,
    p_overwrite,
    p_heats,
    p_entries,
    p_mappings,
    p_participants
  );

  insert into public.heat_configs (
    heat_id,
    judges,
    surfers,
    judge_names,
    waves,
    tournament_type
  )
  select
    payload.heat_id,
    payload.judges,
    payload.surfers,
    payload.judge_names,
    payload.waves,
    payload.tournament_type
  from jsonb_to_recordset(coalesce(p_heat_configs, '[]'::jsonb)) as payload(
    heat_id text,
    judges text[],
    surfers text[],
    judge_names jsonb,
    waves integer,
    tournament_type text
  )
  on conflict (heat_id) do update
  set judges = excluded.judges,
      surfers = excluded.surfers,
      judge_names = excluded.judge_names,
      waves = excluded.waves,
      tournament_type = excluded.tournament_type;
end;
$$;


--
-- Name: can_display_event(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_display_event(p_event_id bigint) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.heats h
    where h.event_id = p_event_id
      and coalesce(h.is_active, true)
  );
$$;


--
-- Name: can_display_heat(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_display_heat(p_heat_id text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.heats h
    where h.id = p_heat_id
      and coalesce(h.is_active, true)
  );
$$;


--
-- Name: check_heat_planning_safety(bigint, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_heat_planning_safety(p_event_id bigint, p_category text, p_proposed_heat_ids text[] DEFAULT '{}'::text[], p_overwrite boolean DEFAULT false) RETURNS TABLE(heat_id text, status text, is_active boolean, score_count bigint, override_count bigint, interference_count bigint, judge_assignment_count bigint, timer_count bigint, history_count bigint, active_pointer_count bigint, blocker_reasons text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select *
  from public.get_heat_planning_safety_inventory(
    p_event_id,
    p_category,
    p_proposed_heat_ids,
    p_overwrite
  );
$$;


--
-- Name: close_current_heat_and_open_next(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_current_heat_and_open_next() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  current_heat RECORD;
  next_heat RECORD;
BEGIN
  -- Trouver le heat actuellement actif
  SELECT * INTO current_heat
  FROM public.heats
  WHERE status IN ('running', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1;

  IF current_heat.id IS NULL THEN
    RAISE NOTICE '⚠️ Aucun heat actif trouvé.';
    RETURN;
  END IF;

  -- Fermer le heat courant
  UPDATE public.heats
  SET status = 'finished',
      updated_at = now()
  WHERE id = current_heat.id;

  UPDATE public.heat_realtime_config
  SET status = 'finished',
      updated_at = now(),
      updated_by = current_user
  WHERE heat_id = current_heat.id;

  -- Trouver le heat suivant
  SELECT * INTO next_heat
  FROM public.heats
  WHERE status = 'waiting'
  ORDER BY created_at ASC
  LIMIT 1;

  IF next_heat.id IS NULL THEN
    RAISE NOTICE '✅ Tous les heats sont terminés.';
    RETURN;
  END IF;

  -- Démarrer le heat suivant
  UPDATE public.heats
  SET status = 'running',
      updated_at = now()
  WHERE id = next_heat.id;

  UPDATE public.heat_realtime_config
  SET status = 'running',
      updated_at = now(),
      updated_by = current_user
  WHERE heat_id = next_heat.id;

  RAISE NOTICE '🔥 Heat % fermé, Heat suivant % démarré.', current_heat.id, next_heat.id;
END;
$$;


--
-- Name: close_heat_on_podium(bigint, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text DEFAULT NULL::text, p_closed_by text DEFAULT 'admin'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat record;
  v_pointer_heat_id text;
  v_qualifier_slots integer := 0;
  v_rebuilt_slots integer := 0;
  v_next jsonb := null;
  v_readiness jsonb;
  v_force boolean := coalesce(current_setting('app.force_heat_close', true), 'false') = 'true';
begin
  select id, division, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id)
    and event_id = p_event_id
  for update;

  if not found then
    raise exception 'Heat % does not belong to event %', p_heat_id, p_event_id using errcode = '23503';
  end if;

  select active_heat_id
    into v_pointer_heat_id
  from public.active_heat_pointer
  where event_id = p_event_id
    and podium_id = v_podium_id
  for update;

  if v_pointer_heat_id is distinct from v_heat.id then
    raise exception 'Heat % is not active on podium % (active: %)', v_heat.id, v_podium_id, coalesce(v_pointer_heat_id, 'none')
      using errcode = '23514';
  end if;

  v_readiness := public.fn_get_heat_close_readiness(v_heat.id);
  if not coalesce((v_readiness->>'can_close')::boolean, false) and not v_force then
    raise exception 'HEAT_CLOSE_BLOCKED:%', v_readiness::text using errcode = '23514';
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now()),
         is_active = false,
         updated_at = now()
   where id = v_heat.id;

  insert into public.heat_realtime_config (
    heat_id, status, timer_start_time, updated_at, updated_by
  )
  values (
    v_heat.id, 'closed', null, now(), coalesce(nullif(trim(p_closed_by), ''), 'admin')
  )
  on conflict (heat_id)
  do update set
    status = 'closed',
    timer_start_time = null,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  v_qualifier_slots := public.fn_propagate_qualifiers_for_source_heat(v_heat.id);
  v_rebuilt_slots := public.rebuild_division_qualifiers_from_scores(p_event_id, v_heat.division);

  if nullif(trim(coalesce(p_next_heat_id, '')), '') is not null then
    v_next := public.activate_heat_on_podium(
      p_event_id, v_podium_id, trim(p_next_heat_id), p_closed_by
    );
  end if;

  return jsonb_build_object(
    'event_id', p_event_id,
    'podium_id', v_podium_id,
    'closed_heat_id', v_heat.id,
    'forced', v_force,
    'readiness', v_readiness,
    'qualifier_slots_updated', v_qualifier_slots,
    'division_slots_rebuilt', v_rebuilt_slots,
    'next', v_next
  );
end;
$$;


--
-- Name: close_heat_on_podium_strict(bigint, text, text, text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_heat_on_podium_strict(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text DEFAULT NULL::text, p_closed_by text DEFAULT 'admin'::text, p_force boolean DEFAULT false, p_force_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_readiness jsonb;
  v_result jsonb;
  v_reason text := nullif(trim(coalesce(p_force_reason, '')), '');
begin
  v_readiness := public.fn_get_heat_close_readiness(trim(p_heat_id));

  if p_force and v_reason is null then
    raise exception 'A reason is required to force heat closure' using errcode = '23514';
  end if;

  if p_force then
    perform set_config('app.force_heat_close', 'true', true);
    insert into public.competition_audit_log (
      event_id, heat_id, podium_id, action_type, entity_type, entity_id,
      actor_id, actor_name, actor_role, metadata
    ) values (
      p_event_id,
      trim(p_heat_id),
      upper(trim(coalesce(p_podium_id, 'A'))),
      'HEAT_CLOSE_FORCED',
      'heat',
      trim(p_heat_id),
      p_closed_by,
      p_closed_by,
      'chief_judge',
      jsonb_build_object('reason', v_reason, 'readiness', v_readiness)
    );
  end if;

  v_result := public.close_heat_on_podium(
    p_event_id, p_podium_id, p_heat_id, p_next_heat_id, p_closed_by
  );
  return v_result;
end;
$$;


--
-- Name: configure_cloud_test_activation(boolean, uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.configure_cloud_test_activation(p_enabled boolean, p_user_id uuid DEFAULT NULL::uuid, p_authorized boolean DEFAULT false, p_authorized_by text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if public.get_authoritative_deployment_mode() <> 'cloud' then
    raise exception using errcode = '42501', message = 'CLOUD_TEST_ACTIVATION_CLOUD_ONLY';
  end if;

  update public.app_deployment_config
     set cloud_test_activation_enabled = coalesce(p_enabled, false),
         provisioned_at = now()
   where id = true;

  if p_user_id is not null and p_authorized then
    insert into public.app_cloud_test_activators (user_id, authorized_at, authorized_by)
    values (p_user_id, now(), nullif(btrim(p_authorized_by), ''))
    on conflict (user_id) do update
      set authorized_at = excluded.authorized_at,
          authorized_by = excluded.authorized_by;
  elsif p_user_id is not null then
    delete from public.app_cloud_test_activators where user_id = p_user_id;
  end if;
end;
$$;


--
-- Name: copy_podium_panel_to_heat(bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_podium_panel_to_heat(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text DEFAULT 'podium-panel'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_heat_id text := trim(coalesce(p_heat_id, ''));
  v_count integer;
begin
  if not exists (
    select 1 from public.heats
    where id = v_heat_id
      and event_id = p_event_id
  ) then
    raise exception 'Heat % does not belong to event %', v_heat_id, p_event_id using errcode = '23503';
  end if;

  select count(*)::integer
    into v_count
  from public.podium_judge_assignments
  where event_id = p_event_id
    and podium_id = v_podium_id;

  if v_count = 0 then
    raise exception 'No judge panel configured for podium %', v_podium_id using errcode = '23514';
  end if;

  delete from public.heat_judge_assignments assignment
  where assignment.heat_id = v_heat_id
    and not exists (
      select 1
      from public.podium_judge_assignments panel
      where panel.event_id = p_event_id
        and panel.podium_id = v_podium_id
        and upper(trim(panel.station)) = upper(trim(assignment.station))
    );

  insert into public.heat_judge_assignments (
    heat_id,
    event_id,
    station,
    judge_id,
    judge_name,
    assigned_by
  )
  select
    v_heat_id,
    p_event_id,
    panel.station,
    panel.judge_id,
    panel.judge_name,
    coalesce(nullif(trim(p_assigned_by), ''), 'podium-panel')
  from public.podium_judge_assignments panel
  where panel.event_id = p_event_id
    and panel.podium_id = v_podium_id
  on conflict (heat_id, station)
  do update set
    event_id = excluded.event_id,
    judge_id = excluded.judge_id,
    judge_name = excluded.judge_name,
    assigned_by = excluded.assigned_by,
    updated_at = now();

  return v_count;
end;
$$;


--
-- Name: create_event_secure(text, text, date, date, integer, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event_secure(p_name text, p_organizer text, p_start_date date, p_end_date date, p_price integer DEFAULT 0, p_currency text DEFAULT 'XOF'::text, p_categories jsonb DEFAULT '[]'::jsonb, p_judges jsonb DEFAULT '[]'::jsonb) RETURNS TABLE(id bigint, name text, organizer text, start_date date, end_date date, price integer, currency text, method text, status text, paid boolean, paid_at timestamp with time zone, payment_ref text, categories jsonb, judges jsonb, user_id uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_mode text := public.get_authoritative_deployment_mode();
  v_user_id uuid := auth.uid();
  v_has_owner_id boolean;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'EVENT_NAME_REQUIRED';
  end if;
  if nullif(btrim(p_organizer), '') is null then
    raise exception using errcode = '22023', message = 'EVENT_ORGANIZER_REQUIRED';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'EVENT_DATES_INVALID';
  end if;
  if p_price is null or p_price < 0 then
    raise exception using errcode = '22023', message = 'EVENT_PRICE_INVALID';
  end if;
  if nullif(btrim(p_currency), '') is null then
    raise exception using errcode = '22023', message = 'EVENT_CURRENCY_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_categories, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_judges, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'EVENT_METADATA_INVALID';
  end if;

  if v_mode = 'cloud' then
    if v_user_id is null then
      raise exception using errcode = '42501', message = 'CLOUD_AUTH_REQUIRED';
    end if;
    if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
      raise exception using errcode = '42501', message = 'CLOUD_ANONYMOUS_FORBIDDEN';
    end if;
  elsif v_mode = 'field' then
    v_user_id := null;
  else
    raise exception using errcode = '55000', message = 'DEPLOYMENT_MODE_NOT_PROVISIONED';
  end if;

  select exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) into v_has_owner_id;

  if v_has_owner_id then
    return query execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref,
        categories, judges, user_id, owner_id
      ) values ($1,$2,$3,$4,$5,$6,null,'pending',false,null,null,$7,$8,$9,$9)
      returning id,name,organizer,start_date,end_date,price,currency,
                method,status,paid,paid_at,payment_ref,categories,judges,user_id,created_at
    $sql$ using btrim(p_name), btrim(p_organizer), p_start_date, p_end_date,
      p_price, upper(btrim(p_currency)), coalesce(p_categories, '[]'::jsonb),
      coalesce(p_judges, '[]'::jsonb), v_user_id;
  else
    return query execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref, categories, judges, user_id
      ) values ($1,$2,$3,$4,$5,$6,null,'pending',false,null,null,$7,$8,$9)
      returning id,name,organizer,start_date,end_date,price,currency,
                method,status,paid,paid_at,payment_ref,categories,judges,user_id,created_at
    $sql$ using btrim(p_name), btrim(p_organizer), p_start_date, p_end_date,
      p_price, upper(btrim(p_currency)), coalesce(p_categories, '[]'::jsonb),
      coalesce(p_judges, '[]'::jsonb), v_user_id;
  end if;
end;
$_$;


--
-- Name: delete_score_secure(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_score_secure(p_score_id text, p_heat_id text, p_reason text DEFAULT 'correction'::text, p_comment text DEFAULT NULL::text, p_deleted_by text DEFAULT 'chief_judge'::text, p_deleted_by_name text DEFAULT 'Chef Judge'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_target public.scores%rowtype;
  v_deleted_count integer := 0;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;

  select * into v_target
  from public.scores
  where id::text = trim(p_score_id)
    and heat_id = trim(p_heat_id)
  for update;

  if not found then
    raise exception 'score % not found for heat %', p_score_id, p_heat_id;
  end if;

  with logical_rows as (
    select score.*
    from public.scores score
    where score.heat_id = v_target.heat_id
      and upper(trim(score.surfer)) = upper(trim(v_target.surfer))
      and score.wave_number = v_target.wave_number
      and coalesce(nullif(upper(trim(score.judge_station)), ''), upper(trim(score.judge_id)))
          = coalesce(nullif(upper(trim(v_target.judge_station)), ''), upper(trim(v_target.judge_id)))
    for update
  ), audited as (
    insert into public.score_deletions (
      score_id, heat_id, event_id, judge_id, judge_name, judge_station,
      judge_identity_id, surfer, wave_number, score, score_snapshot,
      reason, comment, deleted_by, deleted_by_name
    )
    select id::text, heat_id, event_id, judge_id, judge_name, judge_station,
      judge_identity_id, surfer, wave_number, score, to_jsonb(logical_rows),
      p_reason, p_comment, p_deleted_by, p_deleted_by_name
    from logical_rows
    returning score_id
  )
  delete from public.scores score
  using audited
  where score.id::text = audited.score_id;

  get diagnostics v_deleted_count = row_count;
  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'heat_id', v_target.heat_id,
    'judge_station', coalesce(v_target.judge_station, v_target.judge_id),
    'surfer', v_target.surfer,
    'wave_number', v_target.wave_number
  );
end;
$$;


--
-- Name: enforce_active_pointer_judge_podium_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_active_pointer_judge_podium_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.assert_no_active_podium_judge_conflict(
    new.event_id,
    new.active_heat_id,
    new.podium_id
  );
  return new;
end;
$$;


--
-- Name: enforce_heat_judge_assignment_podium_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_heat_judge_assignment_podium_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_pointer record;
  v_duplicate record;
begin
  if is_official_judge_assignment_id(new.judge_id) then
    select station
    into v_duplicate
    from public.heat_judge_assignments
    where heat_id = new.heat_id
      and id <> new.id
      and lower(trim(judge_id)) = lower(trim(new.judge_id))
      and is_official_judge_assignment_id(judge_id)
    limit 1;

    if found then
      raise exception
        'Judge % is already assigned to station % on this heat',
        coalesce(new.judge_name, new.judge_id),
        v_duplicate.station
        using errcode = '23514';
    end if;
  end if;

  for v_pointer in
    select event_id, active_heat_id, podium_id
    from public.active_heat_pointer
    where active_heat_id = new.heat_id
  loop
    perform public.assert_no_active_podium_judge_conflict(
      v_pointer.event_id,
      v_pointer.active_heat_id,
      v_pointer.podium_id
    );
  end loop;

  return new;
end;
$$;


--
-- Name: event_creation_is_local_database(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_creation_is_local_database() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_headers jsonb;
  v_host text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return false;
  end;
  if v_headers is null then return false; end if;
  v_host := lower(split_part(coalesce(v_headers ->> 'host', ''), ':', 1));
  if v_host = '' then return false; end if;
  return not (v_host like '%.supabase.co' or v_host like '%.supabase.net');
end;
$$;


--
-- Name: fn_audit_active_heat_pointer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_active_heat_pointer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'UPDATE'
     and old.active_heat_id is not distinct from new.active_heat_id
     and old.podium_id is not distinct from new.podium_id then
    return new;
  end if;

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_name, actor_role, before_data, after_data
  ) values (
    new.event_id,
    new.active_heat_id,
    upper(trim(coalesce(new.podium_id, 'A'))),
    'ACTIVE_HEAT_CHANGED',
    'active_heat_pointer',
    concat(new.event_id, ':', upper(trim(coalesce(new.podium_id, 'A')))),
    'Administration',
    'chief_judge',
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;


--
-- Name: fn_audit_heat_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_heat_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_name, actor_role, before_data, after_data
  ) values (
    new.event_id,
    new.id,
    public.fn_audit_podium(new.event_id, new.id),
    'HEAT_STATUS_CHANGED',
    'heat',
    new.id,
    'Administration',
    'chief_judge',
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;


--
-- Name: fn_audit_interference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_interference() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_row public.interference_calls%rowtype;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  v_action := case
    when tg_op = 'INSERT' then 'INTERFERENCE_ADDED'
    when tg_op = 'UPDATE' then 'INTERFERENCE_UPDATED'
    else 'INTERFERENCE_REMOVED'
  end;

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_data, after_data, metadata
  ) values (
    v_row.event_id,
    v_row.heat_id,
    public.fn_audit_podium(v_row.event_id, v_row.heat_id),
    v_action,
    'interference',
    v_row.id::text,
    v_row.judge_identity_id::text,
    coalesce(v_row.judge_name, v_row.judge_id),
    case when v_row.is_head_judge_override then 'chief_judge' else 'judge' end,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    jsonb_build_object(
      'surfer', v_row.surfer,
      'wave_number', v_row.wave_number,
      'call_type', v_row.call_type
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


--
-- Name: fn_audit_podium(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_podium(p_event_id bigint, p_heat_id text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select upper(trim(coalesce(pointer.podium_id, 'A')))
  from public.active_heat_pointer pointer
  where pointer.event_id = p_event_id
    and pointer.active_heat_id = p_heat_id
  order by pointer.updated_at desc
  limit 1
$$;


--
-- Name: fn_audit_score_deletion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_score_deletion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_data, metadata, created_at
  ) values (
    new.event_id,
    new.heat_id,
    public.fn_audit_podium(new.event_id, new.heat_id),
    'SCORE_DELETED',
    'score',
    new.score_id,
    new.deleted_by,
    new.deleted_by_name,
    'chief_judge',
    new.score_snapshot,
    jsonb_build_object(
      'reason', new.reason,
      'comment', new.comment,
      'judge_station', new.judge_station,
      'surfer', new.surfer,
      'wave_number', new.wave_number
    ),
    new.deleted_at
  );
  return new;
end;
$$;


--
-- Name: fn_audit_score_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_score_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_event_id bigint;
begin
  if old.score is not distinct from new.score
     and old.surfer is not distinct from new.surfer
     and old.wave_number is not distinct from new.wave_number
     and old.heat_id is not distinct from new.heat_id then
    return new;
  end if;

  v_event_id := coalesce(
    new.event_id,
    old.event_id,
    (select heat.event_id from public.heats heat where heat.id = new.heat_id limit 1)
  );

  insert into public.competition_audit_log (
    event_id, heat_id, podium_id, action_type, entity_type, entity_id,
    actor_id, actor_name, actor_role, before_data, after_data, metadata
  ) values (
    v_event_id,
    new.heat_id,
    public.fn_audit_podium(v_event_id, new.heat_id),
    case
      when old.surfer is distinct from new.surfer
        or old.wave_number is distinct from new.wave_number
        or old.heat_id is distinct from new.heat_id
        then 'SCORE_MOVED'
      else 'SCORE_CORRECTED'
    end,
    'score',
    new.id::text,
    null,
    'Administration',
    'chief_judge',
    jsonb_build_object(
      'heat_id', old.heat_id,
      'judge_id', old.judge_id,
      'judge_name', old.judge_name,
      'judge_station', old.judge_station,
      'surfer', old.surfer,
      'wave_number', old.wave_number,
      'score', old.score
    ),
    jsonb_build_object(
      'heat_id', new.heat_id,
      'judge_id', new.judge_id,
      'judge_name', new.judge_name,
      'judge_station', new.judge_station,
      'surfer', new.surfer,
      'wave_number', new.wave_number,
      'score', new.score
    ),
    jsonb_build_object('source', 'scores_update_trigger')
  );

  return new;
end;
$$;


--
-- Name: fn_best_second_heat_entry_for_round(bigint, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_best_second_heat_entry_for_round(p_event_id bigint, p_division text, p_round integer) RETURNS TABLE(participant_id bigint, seed integer, color text, best_two numeric, source_heat integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with ranked_seconds as (
    select
      ranked.participant_id,
      ranked.seed,
      ranked.color,
      ranked.best_two,
      heat.heat_number as source_heat
    from public.heats heat
    join lateral public.fn_rank_heat_entries_from_scores(heat.id) ranked
      on ranked.rank_pos = 2
    where heat.event_id = p_event_id
      and lower(trim(coalesce(heat.division, ''))) = lower(trim(coalesce(p_division, '')))
      and heat.round = p_round
      and ranked.participant_id is not null
  )
  select
    ranked_seconds.participant_id,
    ranked_seconds.seed,
    ranked_seconds.color,
    ranked_seconds.best_two,
    ranked_seconds.source_heat
  from ranked_seconds
  order by
    ranked_seconds.best_two desc,
    ranked_seconds.source_heat asc,
    ranked_seconds.seed asc nulls last,
    ranked_seconds.participant_id asc
  limit 1;
$$;


--
-- Name: fn_block_scoring_when_closed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_block_scoring_when_closed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_status text;
begin
  -- Fetch current heat status from realtime config
  select rc.status
    into v_status
  from public.heat_realtime_config rc
  where rc.heat_id = coalesce(new.heat_id, old.heat_id)
  limit 1;

  -- Block if timer not started yet (waiting) - prevents errors before surfers are in water
  if v_status = 'waiting' then
    raise exception 'Saisie bloquée : heat non démarré (attendez que le timer démarre)'
                    using errcode = 'P0001';
  end if;

  -- Block if heat is officially closed or status is missing
  if v_status = 'closed' or v_status is null then
    raise exception 'Saisie bloquée : heat clos ou non configuré (status: %)',
                    coalesce(v_status, 'inconnu')
                    using errcode = 'P0001';
  end if;

  -- Allow scoring in: running, paused, finished
  return new;
end;
$$;


--
-- Name: fn_block_unresolved_qualifier_heat_start(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_block_unresolved_qualifier_heat_start() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_check jsonb;
begin
  if coalesce(new.status, '') = 'running'
     and new.timer_start_time is not null
  then
    v_check := public.validate_heat_start_dependencies(new.heat_id);

    if not coalesce((v_check ->> 'ok')::boolean, false) then
      raise exception 'HEAT_DEPENDENCIES_BLOCKED:%', v_check::text
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: fn_canonicalize_score_heat_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_canonicalize_score_heat_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_heat record;
begin
  -- Resolve canonical heat ID first
  new.heat_id := public.fn_resolve_canonical_heat_id(
    new.heat_id,
    new.event_id,
    new.competition,
    new.division,
    new.round
  );

  -- Autofill missing fields from public.heats if they are null or empty
  if new.heat_id is not null then
    select * into v_heat
    from public.heats
    where id = new.heat_id;

    if found then
      new.competition := coalesce(nullif(trim(new.competition), ''), v_heat.competition, 'Competition');
      new.division    := coalesce(nullif(trim(new.division), ''), v_heat.division, 'Division');
      new.round       := coalesce(new.round, v_heat.round, 1);
      new.event_id    := coalesce(new.event_id, v_heat.event_id);
    end if;
  end if;

  -- Ensure fallback values just in case heats lookup didn't find anything
  new.competition := coalesce(nullif(trim(new.competition), ''), 'Competition');
  new.division    := coalesce(nullif(trim(new.division), ''), 'Division');
  new.round       := coalesce(new.round, 1);

  return new;
end;
$$;


--
-- Name: fn_enrich_score_audit_from_override(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_enrich_score_audit_from_override() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_audit_id uuid;
begin
  select audit.id
    into v_audit_id
  from public.competition_audit_log audit
  where audit.heat_id = new.heat_id
    and audit.entity_type = 'score'
    and audit.entity_id = new.score_id::text
    and audit.action_type in ('SCORE_CORRECTED', 'SCORE_MOVED')
    and audit.created_at >= coalesce(new.created_at, now()) - interval '2 minutes'
    and upper(trim(coalesce(audit.after_data->>'surfer', '')))
        = upper(trim(coalesce(new.surfer, '')))
    and (audit.after_data->>'wave_number')::integer is not distinct from new.wave_number
    and (audit.before_data->>'score')::numeric is not distinct from new.previous_score
    and (audit.after_data->>'score')::numeric is not distinct from new.new_score
  order by audit.created_at desc, audit.id desc
  limit 1;

  if v_audit_id is not null then
    update public.competition_audit_log
       set actor_id = coalesce(nullif(trim(new.overridden_by), ''), actor_id),
           actor_name = coalesce(nullif(trim(new.overridden_by_name), ''), actor_name),
           actor_role = 'chief_judge',
           metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
             'reason', new.reason,
             'comment', new.comment,
             'override_id', new.id
           ))
     where id = v_audit_id;
  end if;

  return new;
end;
$$;


--
-- Name: fn_get_event_operations_health(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_event_operations_health(p_event_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_event_exists boolean;
  v_last_score_at timestamptz;
  v_last_audit_at timestamptz;
  v_podiums jsonb;
begin
  select exists(select 1 from public.events where id = p_event_id)
    into v_event_exists;

  if not v_event_exists then
    raise exception 'Event % not found', p_event_id using errcode = '23503';
  end if;

  select max(coalesce(score.timestamp, score.created_at))
    into v_last_score_at
  from public.scores score
  where score.event_id = p_event_id;

  select max(audit.created_at)
    into v_last_audit_at
  from public.competition_audit_log audit
  where audit.event_id = p_event_id;

  with podium_ids as (
    select unnest(array['A', 'B']) as podium_id
  )
  select jsonb_agg(
    jsonb_build_object(
      'podium_id', ids.podium_id,
      'active_heat_id', pointer.active_heat_id,
      'pointer_updated_at', pointer.updated_at,
      'heat_status', heat.status,
      'division', heat.division,
      'round', heat.round,
      'heat_number', heat.heat_number,
      'realtime_status', realtime.status,
      'realtime_updated_at', realtime.updated_at,
      'panel_count', (
        select count(*)
        from public.podium_judge_assignments panel
        where panel.event_id = p_event_id
          and panel.podium_id = ids.podium_id
      ),
      'heat_assignment_count', (
        select count(*)
        from public.heat_judge_assignments assignment
        where assignment.heat_id = pointer.active_heat_id
      )
    )
    order by ids.podium_id
  )
    into v_podiums
  from podium_ids ids
  left join public.active_heat_pointer pointer
    on pointer.event_id = p_event_id
   and upper(trim(coalesce(pointer.podium_id, 'A'))) = ids.podium_id
  left join public.heats heat
    on heat.id = pointer.active_heat_id
  left join public.heat_realtime_config realtime
    on realtime.heat_id = pointer.active_heat_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'checked_at', now(),
    'database_ok', true,
    'last_score_at', v_last_score_at,
    'last_score_age_seconds', case
      when v_last_score_at is null then null
      else greatest(extract(epoch from (now() - v_last_score_at))::bigint, 0)
    end,
    'last_audit_at', v_last_audit_at,
    'podiums', coalesce(v_podiums, '[]'::jsonb)
  );
end;
$$;


--
-- Name: fn_get_heat_close_readiness(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_heat_close_readiness(p_heat_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_heat record;
  v_score_count integer := 0;
  v_missing_score_count integer := 0;
  v_missing_lineup_count integer := 0;
  v_expected_judges integer := 0;
  v_assigned_judges integer := 0;
  v_invalid_score_count integer := 0;
  v_orphan_score_count integer := 0;
  v_pending_slots jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  select id, event_id, division, round, heat_number, heat_size, status
    into v_heat
  from public.heats
  where id = trim(p_heat_id);

  if not found then
    raise exception 'Heat % not found', p_heat_id using errcode = '23503';
  end if;

  select count(*)::integer
    into v_score_count
  from public.v_scores_canonical_enriched score
  where score.heat_id = v_heat.id
    and score.score > 0;

  select count(*)::integer,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'judge_station', slot.judge_station,
             'judge_identity_id', slot.judge_identity_id,
             'judge_display_name', slot.judge_display_name,
             'surfer', slot.surfer,
             'wave_number', slot.wave_number
           )
           order by slot.judge_display_name, slot.surfer, slot.wave_number
         ), '[]'::jsonb)
    into v_missing_score_count, v_pending_slots
  from public.v_heat_missing_score_slots slot
  where slot.heat_id = v_heat.id;

  select greatest(v_heat.heat_size - count(*) filter (where entry.participant_id is not null), 0)::integer
    into v_missing_lineup_count
  from public.heat_entries entry
  where entry.heat_id = v_heat.id;

  select coalesce(jsonb_array_length(coalesce(to_jsonb(config.judges), '[]'::jsonb)), 0)
    into v_expected_judges
  from public.heat_configs config
  where config.heat_id = v_heat.id
  limit 1;
  v_expected_judges := coalesce(v_expected_judges, 0);

  select count(distinct upper(trim(assignment.station)))::integer
    into v_assigned_judges
  from public.heat_judge_assignments assignment
  where assignment.heat_id = v_heat.id;

  if v_expected_judges = 0 and v_assigned_judges > 0 then
    v_expected_judges := v_assigned_judges;
  end if;

  select count(*)::integer
    into v_invalid_score_count
  from public.scores score
  where score.heat_id = v_heat.id
    and (score.score < 0 or score.score > 10);

  select count(*)::integer
    into v_orphan_score_count
  from public.v_scores_canonical_enriched score
  where score.heat_id = v_heat.id
    and score.score > 0
    and not exists (
      select 1
      from public.heat_entries entry
      where entry.heat_id = v_heat.id
        and public.fn_normalize_jersey_label_sql(entry.color)
            = public.fn_normalize_jersey_label_sql(score.surfer)
    );

  if v_score_count = 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'NO_SCORES',
      'count', 1,
      'message', 'Aucune note enregistrée'
    ));
  end if;

  if v_missing_score_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'MISSING_SCORES',
      'count', v_missing_score_count,
      'message', format('%s note(s) manquante(s)', v_missing_score_count),
      'details', v_pending_slots
    ));
  end if;

  if v_missing_lineup_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'UNRESOLVED_LINEUP',
      'count', v_missing_lineup_count,
      'message', format('%s place(s) du lineup non résolue(s)', v_missing_lineup_count)
    ));
  end if;

  if v_expected_judges = 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'NO_JUDGE_PANEL',
      'count', 1,
      'message', 'Aucun panel de juges enregistré sur le heat'
    ));
  elsif v_assigned_judges < v_expected_judges then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INCOMPLETE_JUDGE_PANEL',
      'count', v_expected_judges - v_assigned_judges,
      'message', format('Panel incomplet: %s/%s juge(s)', v_assigned_judges, v_expected_judges)
    ));
  end if;

  if v_invalid_score_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_SCORES',
      'count', v_invalid_score_count,
      'message', format('%s note(s) hors de la plage 0–10', v_invalid_score_count)
    ));
  end if;

  if v_orphan_score_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'ORPHAN_SCORES',
      'count', v_orphan_score_count,
      'message', format('%s note(s) liée(s) à un lycra absent du lineup', v_orphan_score_count)
    ));
  end if;

  return jsonb_build_object(
    'heat_id', v_heat.id,
    'event_id', v_heat.event_id,
    'division', v_heat.division,
    'round', v_heat.round,
    'heat_number', v_heat.heat_number,
    'status', v_heat.status,
    'can_close', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'summary', jsonb_build_object(
      'score_count', v_score_count,
      'missing_score_count', v_missing_score_count,
      'missing_lineup_count', v_missing_lineup_count,
      'expected_judges', v_expected_judges,
      'assigned_judges', v_assigned_judges,
      'invalid_score_count', v_invalid_score_count,
      'orphan_score_count', v_orphan_score_count
    )
  );
end;
$$;


--
-- Name: fn_get_heat_close_validation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_heat_close_validation(p_heat_id text) RETURNS TABLE(heat_id text, event_id bigint, has_any_scores boolean, started_wave_count integer, missing_score_count integer, pending_slots jsonb)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with normalized_heat as (
    select h.id as heat_id, h.event_id
    from public.heats h
    where h.id = p_heat_id
  ),
  started_waves as (
    select distinct
      score.heat_id,
      public.fn_normalize_jersey_label_sql(score.surfer) as surfer,
      score.wave_number
    from public.v_scores_canonical_enriched score
    where score.heat_id = p_heat_id
      and score.score > 0
  ),
  missing_slots as (
    select
      slot.heat_id,
      slot.event_id,
      slot.judge_station,
      slot.judge_identity_id,
      slot.judge_display_name,
      slot.surfer,
      slot.wave_number
    from public.v_heat_missing_score_slots slot
    where slot.heat_id = p_heat_id
  )
  select
    nh.heat_id,
    nh.event_id,
    exists (
      select 1
      from public.v_scores_canonical_enriched score
      where score.heat_id = nh.heat_id
        and score.score > 0
    ) as has_any_scores,
    coalesce((select count(*) from started_waves), 0)::integer as started_wave_count,
    coalesce((select count(*) from missing_slots), 0)::integer as missing_score_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'judge_station', slot.judge_station,
          'judge_identity_id', slot.judge_identity_id,
          'judge_display_name', slot.judge_display_name,
          'surfer', slot.surfer,
          'wave_number', slot.wave_number
        )
        order by slot.judge_display_name, slot.surfer, slot.wave_number
      )
      from missing_slots slot
    ), '[]'::jsonb) as pending_slots
  from normalized_heat nh;
$$;


--
-- Name: fn_heat_interference_summary(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_heat_interference_summary(p_heat_id text) RETURNS TABLE(surfer_color text, interference_count integer, interference_type text, is_disqualified boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with judge_count as (
    select greatest(
      count(
        distinct coalesce(
          nullif(trim(score.judge_identity_id), ''),
          upper(trim(coalesce(score.judge_station, score.judge_id)))
        )
      ),
      1
    )::int as judge_count
    from public.scores score
    where score.heat_id = trim(p_heat_id)
      and score.score > 0
  ),
  normalized_calls as (
    select
      public.fn_normalize_heat_color_sql(call.surfer) as surfer_color,
      call.wave_number,
      upper(trim(call.call_type)) as call_type,
      coalesce(call.is_head_judge_override, false) as is_head_judge_override,
      coalesce(nullif(trim(call.judge_identity_id), ''), upper(trim(coalesce(call.judge_station, call.judge_id)))) as judge_key,
      coalesce(call.updated_at, call.created_at, now()) as sort_ts
    from public.interference_calls call
    where call.heat_id = trim(p_heat_id)
      and call.wave_number is not null
      and nullif(trim(coalesce(call.surfer, '')), '') is not null
      and upper(trim(coalesce(call.call_type, ''))) in ('INT1', 'INT2')
  ),
  head_overrides as (
    select distinct on (surfer_color, wave_number)
      surfer_color,
      wave_number,
      call_type
    from normalized_calls
    where is_head_judge_override
    order by surfer_color, wave_number, sort_ts desc
  ),
  latest_by_judge as (
    select distinct on (surfer_color, wave_number, judge_key)
      surfer_color,
      wave_number,
      judge_key,
      call_type,
      sort_ts
    from normalized_calls
    order by surfer_color, wave_number, judge_key, sort_ts desc
  ),
  majorities as (
    select
      surfer_color,
      wave_number,
      count(*) filter (where call_type = 'INT1') as int1_count,
      count(*) filter (where call_type = 'INT2') as int2_count
    from latest_by_judge
    group by surfer_color, wave_number
  ),
  effective_per_wave as (
    select
      coalesce(override.surfer_color, majority.surfer_color) as surfer_color,
      coalesce(override.wave_number, majority.wave_number) as wave_number,
      case
        when override.call_type is not null then override.call_type
        when majority.int2_count >= (select floor(jc.judge_count / 2.0)::int + 1 from judge_count jc) then 'INT2'
        when majority.int1_count >= (select floor(jc.judge_count / 2.0)::int + 1 from judge_count jc) then 'INT1'
        else null
      end as effective_type
    from majorities majority
    full outer join head_overrides override
      on override.surfer_color = majority.surfer_color
     and override.wave_number = majority.wave_number
  )
  select
    effective.surfer_color,
    count(*)::int as interference_count,
    (array_agg(effective.effective_type order by effective.wave_number))[1] as interference_type,
    (count(*) >= 2) as is_disqualified
  from effective_per_wave effective
  where effective.effective_type is not null
  group by effective.surfer_color;
$$;


--
-- Name: fn_infer_heat_slot_mappings_for_heat(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_infer_heat_slot_mappings_for_heat(p_target_heat_id text) RETURNS TABLE(heat_id text, slot_position integer, placeholder text, source_round integer, source_heat integer, source_position integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_target record;
  v_previous_round integer;
  v_total_current_slots integer := 0;
  v_requested_advancers integer := 0;
  v_heat_count integer := 0;
  v_heat_ids text[] := array[]::text[];
  v_capacities integer[] := array[]::integer[];
  v_counts integer[] := array[]::integer[];
  v_assignments jsonb[] := array[]::jsonb[];
  v_refs jsonb[] := array[]::jsonb[];
  v_idx integer := 1;
  v_direction integer := 1;
  v_guard integer;
  v_ref jsonb;
  v_ref_index integer;
  v_target_index integer;
  v_assignment jsonb;
  v_output_position integer := 0;
  v_position integer;
  v_candidate_idx integer;
  v_candidate_direction integer;
  v_fallback_idx integer;
  v_fallback_direction integer;
  v_chosen_idx integer;
  v_chosen_direction integer;
  v_has_collision boolean;
  source_heat_row record;
  current_heat_row record;
begin
  select h.id, h.event_id, h.division, h.round, h.heat_number, h.heat_size
    into v_target
  from public.heats h
  where h.id = trim(p_target_heat_id)
  limit 1;

  if not found or coalesce(v_target.round, 0) <= 1 then
    return;
  end if;

  v_previous_round := v_target.round - 1;

  for current_heat_row in
    select h.id, coalesce(h.heat_size, 0) as heat_size
    from public.heats h
    where h.event_id = v_target.event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
      and h.round = v_target.round
    order by h.heat_number asc
  loop
    v_heat_ids := array_append(v_heat_ids, current_heat_row.id);
    v_capacities := array_append(v_capacities, greatest(current_heat_row.heat_size, 0));
    v_counts := array_append(v_counts, 0);
    v_assignments := array_append(v_assignments, '[]'::jsonb);
    v_total_current_slots := v_total_current_slots + greatest(current_heat_row.heat_size, 0);
  end loop;

  v_heat_count := array_length(v_heat_ids, 1);
  if coalesce(v_heat_count, 0) = 0 or v_total_current_slots <= 0 then
    return;
  end if;

  select count(*)
    into v_requested_advancers
  from public.heats h
  where h.event_id = v_target.event_id
    and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
    and h.round = v_previous_round;

  if coalesce(v_requested_advancers, 0) = 0 then
    return;
  end if;

  v_requested_advancers := greatest(1, ceil(v_total_current_slots::numeric / v_requested_advancers)::integer);

  -- Build qualifier references by rank layer first: every P1, then every P2.
  -- This preserves the initial seeding/snake intent better than filling source heat by source heat.
  for v_position in 1..v_requested_advancers loop
    for source_heat_row in
      select h.round, h.heat_number, coalesce(h.heat_size, 0) as heat_size
      from public.heats h
      where h.event_id = v_target.event_id
        and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_target.division, '')))
        and h.round = v_previous_round
      order by h.heat_number asc
    loop
      if v_position <= least(
        case
          when source_heat_row.heat_size <= 0 then 0
          when source_heat_row.heat_size <= 2 then 1
          else 2
        end,
        v_requested_advancers
      ) then
        v_refs := array_append(v_refs, jsonb_build_object(
          'source_round', source_heat_row.round,
          'source_heat', source_heat_row.heat_number,
          'source_position', v_position
        ));
      end if;
    end loop;
  end loop;

  if coalesce(array_length(v_refs, 1), 0) = 0 then
    return;
  end if;

  if coalesce(array_length(v_refs, 1), 0) < v_total_current_slots then
    v_refs := array_append(v_refs, jsonb_build_object(
      'source_round', v_previous_round,
      'source_heat', null,
      'source_position', null,
      'best_second_round', v_previous_round
    ));
  end if;

  for v_ref_index in 1..array_length(v_refs, 1) loop
    v_ref := v_refs[v_ref_index];
    v_candidate_idx := v_idx;
    v_candidate_direction := v_direction;
    v_fallback_idx := null;
    v_fallback_direction := null;
    v_chosen_idx := null;
    v_chosen_direction := null;

    -- Walk the snake from the preferred cursor and choose the first open heat
    -- that does not already contain a qualifier from the same source heat.
    for v_guard in 1..greatest(1, v_heat_count * 2) loop
      if coalesce(v_counts[v_candidate_idx], 0) < coalesce(v_capacities[v_candidate_idx], 0) then
        if v_fallback_idx is null then
          v_fallback_idx := v_candidate_idx;
          v_fallback_direction := v_candidate_direction;
        end if;

        select exists (
          select 1
          from jsonb_array_elements(coalesce(v_assignments[v_candidate_idx], '[]'::jsonb)) existing(value)
          where (existing.value ->> 'source_heat') is not null
            and (v_ref ->> 'source_heat') is not null
            and (existing.value ->> 'source_round')::integer = (v_ref ->> 'source_round')::integer
            and (existing.value ->> 'source_heat')::integer = (v_ref ->> 'source_heat')::integer
        )
          into v_has_collision;

        if not coalesce(v_has_collision, false) then
          v_chosen_idx := v_candidate_idx;
          v_chosen_direction := v_candidate_direction;
          exit;
        end if;
      end if;

      if v_heat_count <= 1 then
        v_candidate_idx := 1;
        v_candidate_direction := 1;
      elsif v_candidate_direction = 1 then
        if v_candidate_idx = v_heat_count then
          v_candidate_direction := -1;
        else
          v_candidate_idx := v_candidate_idx + 1;
        end if;
      else
        if v_candidate_idx = 1 then
          v_candidate_direction := 1;
        else
          v_candidate_idx := v_candidate_idx - 1;
        end if;
      end if;
    end loop;

    if v_chosen_idx is null then
      v_chosen_idx := v_fallback_idx;
      v_chosen_direction := v_fallback_direction;
    end if;

    if v_chosen_idx is null or coalesce(v_capacities[v_chosen_idx], 0) <= 0 then
      continue;
    end if;

    v_assignments[v_chosen_idx] := coalesce(v_assignments[v_chosen_idx], '[]'::jsonb) || jsonb_build_array(v_ref);
    v_counts[v_chosen_idx] := coalesce(v_counts[v_chosen_idx], 0) + 1;

    if v_heat_count <= 1 then
      v_idx := 1;
      v_direction := 1;
    elsif v_chosen_direction = 1 then
      if v_chosen_idx = v_heat_count then
        v_idx := v_chosen_idx;
        v_direction := -1;
      else
        v_idx := v_chosen_idx + 1;
        v_direction := v_chosen_direction;
      end if;
    else
      if v_chosen_idx = 1 then
        v_idx := v_chosen_idx;
        v_direction := 1;
      else
        v_idx := v_chosen_idx - 1;
        v_direction := v_chosen_direction;
      end if;
    end if;
  end loop;

  v_target_index := array_position(v_heat_ids, trim(p_target_heat_id));
  if v_target_index is null then
    return;
  end if;

  for v_assignment in
    select value
    from jsonb_array_elements(coalesce(v_assignments[v_target_index], '[]'::jsonb))
  loop
    v_output_position := v_output_position + 1;
    heat_id := trim(p_target_heat_id);
    slot_position := v_output_position;
    if (v_assignment ->> 'best_second_round') is not null then
      source_round := null;
      source_heat := null;
      source_position := null;
      placeholder := format('Meilleur 2e R%s', (v_assignment ->> 'best_second_round')::integer);
    else
      source_round := (v_assignment ->> 'source_round')::integer;
      source_heat := (v_assignment ->> 'source_heat')::integer;
      source_position := (v_assignment ->> 'source_position')::integer;
      placeholder := format('R%s-H%s-P%s', source_round, source_heat, source_position);
    end if;
    return next;
  end loop;
end;
$$;


--
-- Name: fn_normalize_heat_color_sql(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_normalize_heat_color_sql(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case upper(trim(coalesce(p_value, '')))
    when 'RED' then 'RED'
    when 'ROUGE' then 'RED'
    when 'WHITE' then 'WHITE'
    when 'BLANC' then 'WHITE'
    when 'YELLOW' then 'YELLOW'
    when 'JAUNE' then 'YELLOW'
    when 'BLUE' then 'BLUE'
    when 'BLEU' then 'BLUE'
    when 'GREEN' then 'GREEN'
    when 'VERT' then 'GREEN'
    when 'BLACK' then 'BLACK'
    when 'NOIR' then 'BLACK'
    else upper(trim(coalesce(p_value, '')))
  end;
$$;


--
-- Name: fn_normalize_jersey_label_sql(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_normalize_jersey_label_sql(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case upper(trim(coalesce(p_value, '')))
    when 'RED' then 'ROUGE'
    when 'ROUGE' then 'ROUGE'
    when 'WHITE' then 'BLANC'
    when 'BLANC' then 'BLANC'
    when 'YELLOW' then 'JAUNE'
    when 'JAUNE' then 'JAUNE'
    when 'BLUE' then 'BLEU'
    when 'BLEU' then 'BLEU'
    when 'GREEN' then 'VERT'
    when 'VERT' then 'VERT'
    when 'BLACK' then 'NOIR'
    when 'NOIR' then 'NOIR'
    else upper(trim(coalesce(p_value, '')))
  end;
$$;


--
-- Name: fn_propagate_qualifiers_for_source_heat(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_propagate_qualifiers_for_source_heat(p_source_heat_id text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_source record;
  v_target record;
  v_mapping record;
  v_ranked_participant_id bigint;
  v_ranked_seed integer;
  v_best_second_participant_id bigint;
  v_best_second_seed integer;
  v_best_second_loaded boolean := false;
  v_updated integer := 0;
begin
  select h.id, h.event_id, h.division, h.round, h.heat_number
    into v_source
  from public.heats h
  where h.id = trim(p_source_heat_id)
  limit 1;

  if not found then
    return 0;
  end if;

  for v_target in
    select h.id, h.color_order
    from public.heats h
    where h.event_id = v_source.event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_source.division, '')))
      and h.round = v_source.round + 1
    order by h.heat_number asc
  loop
    if not exists (
      select 1
      from public.heat_slot_mappings hm
      where hm.heat_id = v_target.id
        and (
          (
            hm.source_round is not null
            and hm.source_heat is not null
            and hm.source_position is not null
          )
          or upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
        )
    ) then
      insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
      select inferred.heat_id, inferred.slot_position, inferred.placeholder, inferred.source_round, inferred.source_heat, inferred.source_position
      from public.fn_infer_heat_slot_mappings_for_heat(v_target.id) inferred
      on conflict (heat_id, position) do update
        set placeholder = excluded.placeholder,
            source_round = excluded.source_round,
            source_heat = excluded.source_heat,
            source_position = excluded.source_position;
    end if;

    v_best_second_participant_id := null;
    v_best_second_seed := null;
    v_best_second_loaded := false;

    for v_mapping in
      with resolved_mappings as (
        select
          hm.heat_id,
          hm.position,
          coalesce(
            hm.source_round,
            (
              case
                when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+' then
                  (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[2]::integer
                else null
              end
            )
          ) as resolved_source_round,
          coalesce(
            hm.source_heat,
            (
              case
                when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+' then
                  (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[3]::integer
                else null
              end
            )
          ) as resolved_source_heat,
          coalesce(
            hm.source_position,
            (
              case
                when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+' then
                  (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[4]::integer
                else null
              end
            )
          ) as resolved_source_position,
          (
            case
              when upper(trim(coalesce(hm.placeholder, ''))) ~ 'MEILLEUR[[:space:]]*2E[[:space:]]*R[0-9]+' then
                (regexp_match(upper(trim(hm.placeholder)), 'MEILLEUR[[:space:]]*2E[[:space:]]*R([0-9]+)'))[1]::integer
              else null
            end
          ) as resolved_best_second_round
        from public.heat_slot_mappings hm
        where hm.heat_id = v_target.id
      )
      select
        resolved_mappings.heat_id,
        resolved_mappings.position,
        resolved_mappings.resolved_source_position as source_position,
        resolved_mappings.resolved_best_second_round as best_second_round
      from resolved_mappings
      where (
        resolved_mappings.resolved_source_round = v_source.round
        and resolved_mappings.resolved_source_heat = v_source.heat_number
      )
      or resolved_mappings.resolved_best_second_round = v_source.round
      order by resolved_mappings.position asc
    loop
      v_ranked_participant_id := null;
      v_ranked_seed := null;

      if v_mapping.best_second_round is not null then
        if not v_best_second_loaded then
          select best_second.participant_id, best_second.seed
            into v_best_second_participant_id, v_best_second_seed
          from public.fn_best_second_heat_entry_for_round(
            v_source.event_id,
            v_source.division,
            v_mapping.best_second_round
          ) best_second
          limit 1;
          v_best_second_loaded := true;
        end if;

        v_ranked_participant_id := v_best_second_participant_id;
        v_ranked_seed := v_best_second_seed;
      else
        select ranked.participant_id, ranked.seed
          into v_ranked_participant_id, v_ranked_seed
        from public.fn_rank_heat_entries_from_scores(v_source.id) ranked
        where ranked.rank_pos = v_mapping.source_position
        limit 1;
      end if;

      insert into public.heat_entries (heat_id, participant_id, position, seed, color)
      values (
        v_target.id,
        v_ranked_participant_id,
        v_mapping.position,
        coalesce(v_ranked_seed, v_mapping.position),
        coalesce(v_target.color_order[v_mapping.position], case v_mapping.position
          when 1 then 'RED'
          when 2 then 'WHITE'
          when 3 then 'YELLOW'
          when 4 then 'BLUE'
          when 5 then 'GREEN'
          when 6 then 'BLACK'
          else null
        end)
      )
      on conflict (heat_id, position) do update
        set participant_id = excluded.participant_id,
            seed = excluded.seed,
            color = coalesce(excluded.color, public.heat_entries.color);

      v_updated := v_updated + 1;
    end loop;
  end loop;

  return v_updated;
end;
$$;


--
-- Name: fn_rank_heat_entries_exhaustive(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_rank_heat_entries_exhaustive(p_heat_id text) RETURNS TABLE(rank_pos integer, participant_id bigint, seed integer, color text, best_two numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with target as (
    select h.event_id, h.division
    from public.heats h where h.id = trim(p_heat_id)
  ),
  entries as (
    select e.heat_id, e.participant_id, e.seed, e.position, e.color
    from public.heat_entries e
    where e.heat_id = trim(p_heat_id) and e.participant_id is not null
  ),
  scored as (
    select s.color, s.best_two
    from public.fn_rank_heat_entries_scored_only(trim(p_heat_id)) s
  ),
  lineage as (
    select e.position, previous.best_two as previous_round_total
    from entries e
    left join public.heat_slot_mappings mapping
      on mapping.heat_id = e.heat_id and mapping.position = e.position
    left join public.heats source_heat
      on source_heat.event_id = (select event_id from target)
     and lower(trim(source_heat.division)) = lower(trim((select division from target)))
     and source_heat.round = mapping.source_round
     and source_heat.heat_number = mapping.source_heat
    left join lateral (
      select ranked.best_two
      from public.fn_rank_heat_entries_scored_only(source_heat.id) ranked
      where ranked.rank_pos = mapping.source_position
      limit 1
    ) previous on true
  ),
  candidates as (
    select e.participant_id, e.seed, e.position, e.color,
      coalesce(scored.best_two, 0::numeric) as current_total,
      lineage.previous_round_total
    from entries e
    left join scored on public.fn_normalize_jersey_label_sql(scored.color) = public.fn_normalize_jersey_label_sql(e.color)
    left join lineage on lineage.position = e.position
  ),
  ranked as (
    select candidates.*, dense_rank() over (
      order by candidates.current_total desc,
        candidates.previous_round_total desc nulls last,
        candidates.seed asc nulls last, candidates.position asc,
        public.fn_normalize_jersey_label_sql(candidates.color) asc
    )::integer as computed_rank
    from candidates
  )
  select computed_rank, participant_id, seed, color, current_total
  from ranked order by computed_rank, position;
$$;


--
-- Name: fn_rank_heat_entries_from_scores(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_rank_heat_entries_from_scores(p_heat_id text) RETURNS TABLE(rank_pos integer, participant_id bigint, seed integer, color text, best_two numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select * from public.fn_rank_heat_entries_exhaustive(trim(p_heat_id));
$$;


--
-- Name: fn_rank_heat_entries_scored_only(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_rank_heat_entries_scored_only(p_heat_id text) RETURNS TABLE(rank_pos integer, participant_id bigint, seed integer, color text, best_two numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with judge_count as (
    select greatest(
      count(
        distinct coalesce(
          nullif(trim(score.judge_identity_id), ''),
          upper(trim(coalesce(score.judge_station, score.judge_id)))
        )
      ),
      1
    )::int as judge_count
    from public.scores score
    where score.heat_id = trim(p_heat_id)
      and score.score > 0
  ),
  latest_scores as (
    select
      score.heat_id,
      public.fn_normalize_heat_color_sql(score.surfer) as surfer_color,
      coalesce(
        nullif(trim(score.judge_identity_id), ''),
        upper(trim(coalesce(score.judge_station, score.judge_id)))
      ) as judge_key,
      score.wave_number,
      score.score,
      row_number() over (
        partition by
          score.heat_id,
          public.fn_normalize_heat_color_sql(score.surfer),
          score.wave_number,
          coalesce(
            nullif(trim(score.judge_identity_id), ''),
            upper(trim(coalesce(score.judge_station, score.judge_id)))
          )
        order by
          coalesce(score.timestamp, score.created_at) desc,
          score.created_at desc,
          score.id desc
      ) as row_rank
    from public.scores score
    where score.heat_id = trim(p_heat_id)
      and score.score > 0
  ),
  wave_scores as (
    select
      latest_scores.heat_id,
      latest_scores.surfer_color,
      latest_scores.wave_number,
      round(
        case
          when (select jc.judge_count from judge_count jc) >= 5
           and count(*) >= (select jc.judge_count from judge_count jc)
            then ((sum(latest_scores.score) - min(latest_scores.score) - max(latest_scores.score)) / greatest(count(*) - 2, 1))::numeric
          else avg(latest_scores.score)::numeric
        end,
        2
      ) as wave_avg
    from latest_scores
    where latest_scores.row_rank = 1
      and latest_scores.judge_key is not null
      and latest_scores.judge_key <> ''
    group by latest_scores.heat_id, latest_scores.surfer_color, latest_scores.wave_number
  ),
  ranked_waves as (
    select
      wave_scores.*,
      row_number() over (
        partition by wave_scores.heat_id, wave_scores.surfer_color
        order by wave_scores.wave_avg desc, wave_scores.wave_number asc
      ) as wave_rank
    from wave_scores
  ),
  best_two_raw as (
    select
      ranked_waves.heat_id,
      ranked_waves.surfer_color,
      round(sum(ranked_waves.wave_avg)::numeric, 2) as best_two_raw
    from ranked_waves
    where ranked_waves.wave_rank <= 2
    group by ranked_waves.heat_id, ranked_waves.surfer_color
  ),
  best_wave as (
    select
      ranked_waves.heat_id,
      ranked_waves.surfer_color,
      max(ranked_waves.wave_avg) as best_wave_avg
    from ranked_waves
    group by ranked_waves.heat_id, ranked_waves.surfer_color
  ),
  adjusted_scores as (
    select
      raw.heat_id,
      raw.surfer_color,
      case
        when coalesce(summary.is_disqualified, false) then 0::numeric
        when summary.interference_type = 'INT1' then round((raw.best_two_raw - (coalesce(second_wave.wave_avg, 0) / 2.0))::numeric, 2)
        when summary.interference_type = 'INT2' then round(coalesce(best.best_wave_avg, 0)::numeric, 2)
        else raw.best_two_raw
      end as best_two
    from best_two_raw raw
    left join public.fn_heat_interference_summary(trim(p_heat_id)) summary
      on summary.surfer_color = raw.surfer_color
    left join ranked_waves second_wave
      on second_wave.heat_id = raw.heat_id
     and second_wave.surfer_color = raw.surfer_color
     and second_wave.wave_rank = 2
    left join best_wave best
      on best.heat_id = raw.heat_id
     and best.surfer_color = raw.surfer_color
  ),
  ranked_scores as (
    select
      adjusted.heat_id,
      adjusted.surfer_color,
      adjusted.best_two,
      dense_rank() over (
        partition by adjusted.heat_id
        order by adjusted.best_two desc, adjusted.surfer_color asc
      ) as rank_pos
    from adjusted_scores adjusted
  )
  select
    ranked.rank_pos,
    entry.participant_id,
    entry.seed,
    entry.color,
    ranked.best_two
  from ranked_scores ranked
  join public.heat_entries entry
    on entry.heat_id = ranked.heat_id
   and public.fn_normalize_heat_color_sql(entry.color) = ranked.surfer_color
  where entry.participant_id is not null;
$$;


--
-- Name: fn_resolve_canonical_heat_id(text, bigint, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_resolve_canonical_heat_id(p_heat_id text, p_event_id bigint DEFAULT NULL::bigint, p_competition text DEFAULT NULL::text, p_division text DEFAULT NULL::text, p_round integer DEFAULT NULL::integer) RETURNS text
    LANGUAGE plpgsql
    AS $_$
declare
  source_heat record;
  canonical_heat_id text;
  target_event_id bigint;
  target_competition text;
  target_division text;
  target_round integer;
  target_heat_number integer;
begin
  if p_heat_id is null or trim(p_heat_id) = '' then
    return p_heat_id;
  end if;

  select
    h.id,
    h.event_id,
    h.competition,
    h.division,
    h.round,
    h.heat_number
  into source_heat
  from public.heats h
  where h.id = p_heat_id;

  target_event_id := coalesce(p_event_id, source_heat.event_id);
  target_competition := coalesce(nullif(trim(p_competition), ''), source_heat.competition);
  target_division := coalesce(nullif(trim(p_division), ''), source_heat.division);
  target_round := coalesce(p_round, source_heat.round);
  target_heat_number := coalesce(
    source_heat.heat_number,
    nullif(substring(lower(p_heat_id) from '_h([0-9]+)$'), '')::integer
  );

  if found then
    select candidate.id
    into canonical_heat_id
    from public.heats candidate
    where (
        target_event_id is not null
        and candidate.event_id = target_event_id
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
      or (
        target_event_id is null
        and lower(regexp_replace(coalesce(candidate.competition, ''), '[^a-z0-9]+', '', 'g')) =
            lower(regexp_replace(coalesce(target_competition, ''), '[^a-z0-9]+', '', 'g'))
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
    order by candidate.event_id desc, candidate.id desc
    limit 1;

    return coalesce(canonical_heat_id, p_heat_id);
  end if;

  if target_division is not null and target_round is not null and target_heat_number is not null then
    select candidate.id
    into canonical_heat_id
    from public.heats candidate
    where (
        target_event_id is not null
        and candidate.event_id = target_event_id
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
      or (
        target_event_id is null
        and target_competition is not null
        and lower(regexp_replace(coalesce(candidate.competition, ''), '[^a-z0-9]+', '', 'g')) =
            lower(regexp_replace(coalesce(target_competition, ''), '[^a-z0-9]+', '', 'g'))
        and lower(trim(coalesce(candidate.division, ''))) = lower(trim(coalesce(target_division, '')))
        and candidate.round = target_round
        and candidate.heat_number = target_heat_number
      )
    order by candidate.event_id desc, candidate.id desc
    limit 1;
  end if;

  return coalesce(canonical_heat_id, p_heat_id);
end;
$_$;


--
-- Name: fn_sync_active_heat_pointer_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_active_heat_pointer_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  heat_row record;
begin
  if new.active_heat_id is not null then
    select h.event_id, h.competition
      into heat_row
    from public.heats h
    where h.id = new.active_heat_id;

    if found then
      new.event_id := heat_row.event_id;
      if coalesce(trim(new.event_name), '') = '' then
        new.event_name := heat_row.competition;
      end if;
    end if;
  end if;

  if new.event_id is not null then
    select e.name
      into new.event_name
    from public.events e
    where e.id = new.event_id;
  end if;

  return new;
end;
$$;


--
-- Name: fn_sync_heat_judge_assignment_event_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_heat_judge_assignment_event_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.heat_id is not null then
    select h.event_id
      into new.event_id
    from public.heats h
    where h.id = new.heat_id;
  end if;

  return new;
end;
$$;


--
-- Name: fn_sync_heat_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_heat_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.heat_realtime_config (
      heat_id,
      status,
      updated_at,
      updated_by
    )
    values (
      new.id,
      new.status,
      now(),
      coalesce(current_user, 'system')
    )
    on conflict (heat_id)
    do update set
      status = excluded.status,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  end if;

  return new;
end;
$$;


--
-- Name: fn_sync_scores_event_id_from_heat(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_scores_event_id_from_heat() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.heat_id is not null then
    select h.event_id
      into new.event_id
    from public.heats h
    where h.id = new.heat_id;
  end if;

  return new;
end;
$$;


--
-- Name: fn_touch_heat_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_touch_heat_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_heat_id text;
BEGIN
  v_heat_id := COALESCE(NEW.heat_id, OLD.heat_id);
  IF v_heat_id IS NOT NULL AND v_heat_id <> '' THEN
    UPDATE public.heats
       SET updated_at = now()
     WHERE id = v_heat_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: fn_unified_heat_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_unified_heat_transition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event_id bigint;
  v_event_name text;
  v_division text;
  v_round integer;
  v_heat_no integer;
  v_next_heat_id text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Strictly lock progression to explicit 'closed' status changes (manual close).
  if new.status <> 'closed' then
    return new;
  end if;

  if coalesce(old.status, '') = new.status then
    return new;
  end if;

  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;

  select h.event_id, h.competition, h.division, h.round, h.heat_number
    into v_event_id, v_event_name, v_division, v_round, v_heat_no
    from public.heats h
   where h.id = new.heat_id
     for update nowait;

  if not found then
    return new;
  end if;

  update public.heats
     set status = 'closed',
         closed_at = coalesce(closed_at, now())
   where id = new.heat_id
     and status <> 'closed';

  perform public.fn_propagate_qualifiers_for_source_heat(new.heat_id);

  select h.id
    into v_next_heat_id
    from public.heats h
   where h.event_id = v_event_id
     and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(v_division, '')))
     and h.id <> new.heat_id
     and h.status in ('waiting', 'open')
     and (
       (h.round = v_round and h.heat_number > v_heat_no)
       or (h.round > v_round)
     )
   order by h.round asc, h.heat_number asc
   limit 1
     for update skip locked;

  if v_next_heat_id is not null then
    insert into public.heat_realtime_config (
      heat_id,
      status,
      timer_start_time,
      updated_at,
      updated_by
    )
    values (
      v_next_heat_id,
      'waiting',
      null,
      now(),
      coalesce(new.updated_by, 'system')
    )
    on conflict (heat_id)
    do update set
      status = 'waiting',
      timer_start_time = null,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    update public.heats
       set status = 'open'
     where id = v_next_heat_id
       and status in ('waiting', 'open');

    insert into public.active_heat_pointer (
      event_id,
      event_name,
      active_heat_id,
      updated_at
    )
    values (
      v_event_id,
      v_event_name,
      v_next_heat_id,
      now()
    )
    on conflict (event_id)
    do update set
      event_name = excluded.event_name,
      active_heat_id = excluded.active_heat_id,
      updated_at = excluded.updated_at;
  end if;

  return new;
exception
  when lock_not_available then
    raise notice 'Heat transition skipped (locked): %', new.heat_id;
    return new;
  when others then
    raise warning 'Error in heat transition for %: %', new.heat_id, sqlerrm;
    return new;
end;
$$;


--
-- Name: get_active_priority(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_priority() RETURNS TABLE(heat_id text, status text, priority_state jsonb, surfers jsonb, timer_remaining_seconds integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select
        hrc.heat_id::text,
        hrc.status::text,
        hrc.config_data->'priorityState' as priority_state,
        hrc.config_data->'surfers' as surfers,
        case
            when ht.is_running and ht.start_time is not null then
                greatest(0,
                    (ht.duration_minutes * 60)
                    - extract(epoch from (now() - ht.start_time))::integer
                )
            else null
        end as timer_remaining_seconds
    from public.heat_realtime_config hrc
    left join public.heat_timers ht
      on ht.heat_id = hrc.heat_id
    order by hrc.updated_at desc
    limit 1;
$$;


--
-- Name: get_active_priority(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_priority(p_podium_id text) RETURNS TABLE(heat_id text, status text, priority_state jsonb, surfers jsonb, timer_remaining_seconds integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select
        hrc.heat_id::text,
        hrc.status::text,
        hrc.config_data->'priorityState' as priority_state,
        hrc.config_data->'surfers' as surfers,
        case
            when ht.is_running and ht.start_time is not null then
                greatest(0,
                    (ht.duration_minutes * 60)
                    - extract(epoch from (now() - ht.start_time))::integer
                )
            else null
        end as timer_remaining_seconds
    from public.active_heat_pointer ahp
    join public.heat_realtime_config hrc
      on hrc.heat_id = ahp.active_heat_id
    left join public.heat_timers ht
      on ht.heat_id = hrc.heat_id
    where upper(trim(coalesce(ahp.podium_id, 'A'))) = upper(trim(coalesce(p_podium_id, 'A')))
    order by ahp.updated_at desc
    limit 1;
$$;


--
-- Name: get_active_priority(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_priority(p_event_id bigint, p_podium_id text DEFAULT 'A'::text) RETURNS TABLE(heat_id text, status text, priority_state jsonb, surfers jsonb, timer_remaining_seconds integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select
        hrc.heat_id::text,
        hrc.status::text,
        hrc.config_data->'priorityState' as priority_state,
        hrc.config_data->'surfers' as surfers,
        case
            when ht.is_running and ht.start_time is not null then
                greatest(0,
                    (ht.duration_minutes * 60)
                    - extract(epoch from (now() - ht.start_time))::integer
                )
            else null
        end as timer_remaining_seconds
    from public.active_heat_pointer ahp
    join public.heat_realtime_config hrc
      on hrc.heat_id = ahp.active_heat_id
    left join public.heat_timers ht
      on ht.heat_id = hrc.heat_id
    where ahp.event_id = p_event_id
      and upper(trim(coalesce(ahp.podium_id, 'A'))) = upper(trim(coalesce(p_podium_id, 'A')))
    order by ahp.updated_at desc
    limit 1;
$$;


--
-- Name: get_authoritative_deployment_mode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_authoritative_deployment_mode() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_mode text;
begin
  select deployment_mode into v_mode
    from public.app_deployment_config
   where id = true;
  if v_mode not in ('cloud', 'field') then
    raise exception using errcode = '55000', message = 'DEPLOYMENT_MODE_NOT_PROVISIONED';
  end if;
  return v_mode;
end;
$$;


--
-- Name: get_event_test_activation_capability(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_test_activation_capability(p_event_id bigint) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_enabled boolean := false;
begin
  if public.get_authoritative_deployment_mode() <> 'cloud' or v_user_id is null then
    return false;
  end if;
  select cloud_test_activation_enabled into v_enabled
    from public.app_deployment_config where id = true;
  if not coalesce(v_enabled, false)
     or not exists (select 1 from public.app_cloud_test_activators where user_id = v_user_id) then
    return false;
  end if;
  return exists (
    select 1 from public.events e
     where e.id = p_event_id and e.user_id = v_user_id
       and e.paid = false and e.test_activated_at is null
  );
end;
$$;


--
-- Name: get_heat_planning_safety_inventory(bigint, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_heat_planning_safety_inventory(p_event_id bigint, p_category text, p_proposed_heat_ids text[] DEFAULT '{}'::text[], p_overwrite boolean DEFAULT false) RETURNS TABLE(heat_id text, status text, is_active boolean, score_count bigint, override_count bigint, interference_count bigint, judge_assignment_count bigint, timer_count bigint, history_count bigint, active_pointer_count bigint, blocker_reasons text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with targeted as (
    select h.id, h.status, coalesce(h.is_active, false) as is_active
    from public.heats h
    where h.event_id = p_event_id
      and h.division = p_category
      and (
        coalesce(p_overwrite, false)
        or h.id = any(coalesce(p_proposed_heat_ids, '{}'::text[]))
      )
  ), inventory as (
    select
      targeted.id as heat_id,
      targeted.status,
      targeted.is_active,
      (select count(*) from public.scores s where s.heat_id = targeted.id) as score_count,
      (
        select count(*)
        from public.score_overrides score_override
        where score_override.heat_id = targeted.id
           or exists (
             select 1 from public.scores override_score
             where override_score.id::text = score_override.score_id
               and override_score.heat_id = targeted.id
           )
      ) as override_count,
      (select count(*) from public.interference_calls interference where interference.heat_id = targeted.id) as interference_count,
      (select count(*) from public.heat_judge_assignments assignment where assignment.heat_id = targeted.id) as judge_assignment_count,
      (select count(*) from public.heat_timers timer where timer.heat_id = targeted.id) as timer_count,
      (select count(*) from public.heat_history history where history.heat_id = targeted.id) as history_count,
      (select count(*) from public.active_heat_pointer pointer where pointer.active_heat_id = targeted.id) as active_pointer_count
    from targeted
  )
  select
    inventory.*,
    array_remove(array[
      case when inventory.score_count > 0 then 'scores' end,
      case when inventory.override_count > 0 then 'score_overrides' end,
      case when inventory.interference_count > 0 then 'interferences' end,
      case when inventory.judge_assignment_count > 0 then 'judge_assignments' end,
      case when inventory.timer_count > 0 then 'timers' end,
      case when inventory.history_count > 0 then 'history' end,
      case when inventory.is_active then 'is_active' end,
      case when inventory.active_pointer_count > 0 then 'active_pointer' end,
      case when inventory.status in ('running', 'paused', 'finished', 'closed') then 'status:' || inventory.status end
    ], null)::text[] as blocker_reasons
  from inventory
  order by inventory.heat_id;
$$;


--
-- Name: is_local_database(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_local_database() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  headers text;
  host_header text;
BEGIN
  -- Retrieve request headers set by Kong / PostgREST if any
  headers := current_setting('request.headers', true);
  IF headers IS NULL OR headers = '' THEN
    RETURN true; -- No HTTP headers means local direct connection, or daemon
  END IF;

  BEGIN
    host_header := headers::json->>'host';
  EXCEPTION WHEN OTHERS THEN
    RETURN true; -- Non-JSON or malformed headers means local/test environment
  END;

  IF host_header LIKE '%.supabase.co' OR host_header LIKE '%.supabase.net' THEN
    RETURN false; -- Definitely running on Supabase Cloud
  END IF;

  RETURN true; -- Default to local environment
END;
$$;


--
-- Name: is_official_judge_assignment_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_official_judge_assignment_id(p_judge_id text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  select trim(coalesce(p_judge_id, '')) <> ''
     and trim(coalesce(p_judge_id, '')) !~* '^J[0-9]+$';
$_$;


--
-- Name: rebuild_division_qualifiers_from_scores(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rebuild_division_qualifiers_from_scores(p_event_id bigint, p_division text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_heat record;
  v_total integer := 0;
begin
  for v_heat in
    select h.id
    from public.heats h
    where h.event_id = p_event_id
      and lower(trim(coalesce(h.division, ''))) = lower(trim(coalesce(p_division, '')))
      and exists (
        select 1
        from public.scores score
        where score.heat_id = h.id
          and score.score > 0
      )
    order by h.round asc, h.heat_number asc
  loop
    v_total := v_total + public.fn_propagate_qualifiers_for_source_heat(v_heat.id);
  end loop;

  return v_total;
end;
$$;


--
-- Name: record_score_override_secure(uuid, text, uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_score_override_secure(p_id uuid, p_heat_id text, p_score_id uuid, p_judge_id text, p_judge_name text DEFAULT NULL::text, p_judge_station text DEFAULT NULL::text, p_judge_identity_id text DEFAULT NULL::text, p_surfer text DEFAULT NULL::text, p_wave_number integer DEFAULT NULL::integer, p_previous_score numeric DEFAULT NULL::numeric, p_new_score numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_comment text DEFAULT NULL::text, p_overridden_by text DEFAULT NULL::text, p_overridden_by_name text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_score record;
  v_result jsonb;
begin
  if not public.is_local_database() and auth.uid() is null then
    raise exception 'authenticated admin session required';
  end if;
  if p_id is null then
    raise exception 'override id is required';
  end if;

  select *
    into v_score
  from public.scores
  where id = p_score_id::text
    and heat_id = trim(p_heat_id);

  if not found then
    raise exception 'score % not found for heat %', p_score_id, p_heat_id;
  end if;

  insert into public.score_overrides (
    id, heat_id, score_id, judge_id, judge_name, judge_station,
    judge_identity_id, surfer, wave_number, previous_score, new_score,
    reason, comment, overridden_by, overridden_by_name, created_at
  )
  values (
    p_id,
    trim(p_heat_id),
    p_score_id::text,
    coalesce(nullif(trim(coalesce(p_judge_id, '')), ''), v_score.judge_id),
    coalesce(nullif(trim(coalesce(p_judge_name, '')), ''), v_score.judge_name),
    coalesce(nullif(trim(coalesce(p_judge_station, '')), ''), v_score.judge_station, v_score.judge_id),
    nullif(trim(coalesce(p_judge_identity_id, '')), ''),
    coalesce(nullif(trim(coalesce(p_surfer, '')), ''), v_score.surfer),
    coalesce(p_wave_number, v_score.wave_number),
    p_previous_score,
    p_new_score,
    p_reason,
    p_comment,
    p_overridden_by,
    p_overridden_by_name,
    coalesce(p_created_at, now())
  )
  on conflict (id) do update
    set heat_id = excluded.heat_id,
        score_id = excluded.score_id,
        judge_id = excluded.judge_id,
        judge_name = excluded.judge_name,
        judge_station = excluded.judge_station,
        judge_identity_id = excluded.judge_identity_id,
        surfer = excluded.surfer,
        wave_number = excluded.wave_number,
        previous_score = excluded.previous_score,
        new_score = excluded.new_score,
        reason = excluded.reason,
        comment = excluded.comment,
        overridden_by = excluded.overridden_by,
        overridden_by_name = excluded.overridden_by_name,
        created_at = excluded.created_at
  returning to_jsonb(score_overrides.*) into v_result;

  return v_result;
end;
$$;


--
-- Name: refresh_judge_accuracy_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_judge_accuracy_summary() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_event_judge_accuracy_summary;
  
  -- Record the completion timestamp
  INSERT INTO public.materialized_view_refresh_queue (view_name, last_refreshed_at)
  VALUES ('v_event_judge_accuracy_summary', now())
  ON CONFLICT (view_name) DO UPDATE
  SET last_refreshed_at = now();
EXCEPTION WHEN OTHERS THEN
  -- Fallback to standard refresh if concurrent is not available (e.g. index build/lock issues)
  REFRESH MATERIALIZED VIEW public.v_event_judge_accuracy_summary;
  
  INSERT INTO public.materialized_view_refresh_queue (view_name, last_refreshed_at)
  VALUES ('v_event_judge_accuracy_summary', now())
  ON CONFLICT (view_name) DO UPDATE
  SET last_refreshed_at = now();
END;
$$;


--
-- Name: set_podium_judge_panel(bigint, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_podium_judge_panel(p_event_id bigint, p_podium_id text, p_assignments jsonb, p_assigned_by text DEFAULT 'admin'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_podium_id text := upper(trim(coalesce(p_podium_id, 'A')));
  v_assignment jsonb;
  v_station text;
  v_judge_id text;
  v_judge_name text;
  v_count integer := 0;
begin
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event % not found', p_event_id using errcode = '23503';
  end if;

  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'p_assignments must be a JSON array' using errcode = '22023';
  end if;

  delete from public.podium_judge_assignments
  where event_id = p_event_id
    and podium_id = v_podium_id;

  for v_assignment in
    select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_station := upper(trim(coalesce(v_assignment ->> 'station', '')));
    v_judge_id := trim(coalesce(v_assignment ->> 'judge_id', v_assignment ->> 'judgeId', ''));
    v_judge_name := trim(coalesce(v_assignment ->> 'judge_name', v_assignment ->> 'judgeName', ''));

    if v_station = '' or v_judge_id = '' or v_judge_name = '' then
      raise exception 'Invalid podium judge assignment: %', v_assignment using errcode = '22023';
    end if;

    insert into public.podium_judge_assignments (
      event_id,
      podium_id,
      station,
      judge_id,
      judge_name,
      assigned_by
    )
    values (
      p_event_id,
      v_podium_id,
      v_station,
      v_judge_id,
      v_judge_name,
      nullif(trim(coalesce(p_assigned_by, '')), '')
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'A podium panel must contain at least one judge' using errcode = '23514';
  end if;

  return v_count;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: touch_interference_calls_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_interference_calls_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: trg_queue_accuracy_summary_refresh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_queue_accuracy_summary_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_last_refreshed_at timestamp with time zone;
begin
  insert into public.materialized_view_refresh_queue (view_name, last_refresh_requested_at)
  values ('v_event_judge_accuracy_summary', now())
  on conflict (view_name) do update
    set last_refresh_requested_at = now()
  returning last_refreshed_at into v_last_refreshed_at;

  if public.is_local_database()
     and (
       v_last_refreshed_at is null
       or v_last_refreshed_at < now() - interval '60 seconds'
     )
     and pg_try_advisory_xact_lock(hashtext('v_event_judge_accuracy_summary_refresh'))
  then
    perform public.refresh_judge_accuracy_summary();
  end if;

  return null;
end;
$$;


--
-- Name: update_heat_realtime_config_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_heat_realtime_config_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Met à jour la ligne liée dans heat_realtime_config
  UPDATE public.heat_realtime_config
  SET
    status = NEW.status,
    updated_at = now(),
    updated_by = current_user
  WHERE heat_id = NEW.id;

  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: upsert_active_heat_pointer(bigint, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_active_heat_pointer(p_event_id bigint DEFAULT NULL::bigint, p_event_name text DEFAULT NULL::text, p_active_heat_id text DEFAULT NULL::text, p_updated_at timestamp with time zone DEFAULT now()) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.upsert_active_heat_pointer(
    p_event_id,
    p_event_name,
    p_active_heat_id,
    p_updated_at,
    'A'
  );
$$;


--
-- Name: upsert_active_heat_pointer(bigint, text, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_active_heat_pointer(p_event_id bigint DEFAULT NULL::bigint, p_event_name text DEFAULT NULL::text, p_active_heat_id text DEFAULT NULL::text, p_updated_at timestamp with time zone DEFAULT now(), p_podium_id text DEFAULT 'A'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event_name text := nullif(trim(coalesce(p_event_name, '')), '');
  v_active_heat_id text := nullif(trim(coalesce(p_active_heat_id, '')), '');
  v_podium_id text := upper(nullif(trim(coalesce(p_podium_id, '')), ''));
begin
  if v_active_heat_id is null then
    raise exception 'active_heat_id is required';
  end if;

  v_podium_id := coalesce(v_podium_id, 'A');

  if p_event_id is not null then
    update public.active_heat_pointer
       set event_id = p_event_id,
           event_name = coalesce(v_event_name, event_name),
           podium_id = v_podium_id,
           active_heat_id = v_active_heat_id,
           updated_at = coalesce(p_updated_at, now())
     where event_id = p_event_id
       and podium_id = v_podium_id;

    if found then
      return;
    end if;
  end if;

  if v_event_name is not null then
    update public.active_heat_pointer
       set event_id = coalesce(p_event_id, event_id),
           event_name = v_event_name,
           podium_id = v_podium_id,
           active_heat_id = v_active_heat_id,
           updated_at = coalesce(p_updated_at, now())
     where lower(trim(event_name)) = lower(trim(v_event_name))
       and podium_id = v_podium_id;

    if found then
      return;
    end if;
  end if;

  insert into public.active_heat_pointer (
    event_id,
    event_name,
    podium_id,
    active_heat_id,
    updated_at
  )
  values (
    p_event_id,
    coalesce(v_event_name, ''),
    v_podium_id,
    v_active_heat_id,
    coalesce(p_updated_at, now())
  );
end;
$$;


--
-- Name: upsert_event_last_config(bigint, text, text, integer, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  insert into public.event_last_config (
    event_id,
    event_name,
    division,
    round,
    heat_number,
    judges,
    updated_at,
    updated_by
  )
  values (
    p_event_id,
    coalesce(p_event_name, ''::text),
    p_division,
    coalesce(p_round, 1),
    coalesce(p_heat_number, 1),
    coalesce(p_judges, '[]'::jsonb),
    now(),
    current_user
  )
  on conflict (event_id) do update
    set event_name  = excluded.event_name,
        division    = excluded.division,
        round       = excluded.round,
        heat_number = excluded.heat_number,
        judges      = excluded.judges,
        updated_at  = now(),
        updated_by  = current_user;
$$;


--
-- Name: upsert_event_last_config(bigint, text, text, integer, integer, jsonb, text[], jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb, p_surfers text[] DEFAULT '{}'::text[], p_surfer_names jsonb DEFAULT '{}'::jsonb, p_surfer_countries jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.event_last_config (
    event_id,
    event_name,
    division,
    round,
    heat_number,
    judges,
    surfers,
    surfer_names,
    surfer_countries,
    updated_at,
    updated_by
  )
  VALUES (
    p_event_id,
    COALESCE(p_event_name, ''::text),
    p_division,
    COALESCE(p_round, 1),
    COALESCE(p_heat_number, 1),
    COALESCE(p_judges, '[]'::jsonb),
    COALESCE(p_surfers, '{}'),
    COALESCE(p_surfer_names, '{}'::jsonb),
    COALESCE(p_surfer_countries, '{}'::jsonb),
    now(),
    current_user
  )
  ON CONFLICT (event_id) DO UPDATE
    SET event_name = EXCLUDED.event_name,
        division = EXCLUDED.division,
        round = EXCLUDED.round,
        heat_number = EXCLUDED.heat_number,
        judges = EXCLUDED.judges,
        surfers = EXCLUDED.surfers,
        surfer_names = EXCLUDED.surfer_names,
        surfer_countries = EXCLUDED.surfer_countries,
        updated_at = now(),
        updated_by = current_user;
$$;


--
-- Name: upsert_heat_config_runtime(text, text[], text[], jsonb, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_heat_config_runtime(p_heat_id text, p_judges text[], p_surfers text[], p_judge_names jsonb, p_waves integer, p_tournament_type text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event_id bigint;
  v_role text := coalesce(auth.role(), '');
begin
  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'heat_id is required' using errcode = '22023';
  end if;

  select heat.event_id
    into v_event_id
  from public.heats heat
  where heat.id = p_heat_id;

  if not found then
    raise exception 'Heat % not found', p_heat_id using errcode = '23503';
  end if;

  if v_role <> 'service_role'
     and not public.is_local_database()
     and not public.user_has_event_access(v_event_id) then
    raise exception 'Access denied for heat %', p_heat_id using errcode = '42501';
  end if;

  insert into public.heat_configs (
    heat_id,
    judges,
    surfers,
    judge_names,
    waves,
    tournament_type
  ) values (
    p_heat_id,
    coalesce(p_judges, '{}'::text[]),
    coalesce(p_surfers, '{}'::text[]),
    coalesce(p_judge_names, '{}'::jsonb),
    p_waves,
    p_tournament_type
  )
  on conflict (heat_id) do update
  set judges = excluded.judges,
      surfers = excluded.surfers,
      judge_names = excluded.judge_names,
      waves = excluded.waves,
      tournament_type = excluded.tournament_type;
end;
$$;


--
-- Name: upsert_heat_realtime_config(text, text, boolean, timestamp with time zone, boolean, numeric, boolean, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_heat_realtime_config(p_heat_id text, p_status text DEFAULT NULL::text, p_set_timer_start_time boolean DEFAULT false, p_timer_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_set_timer_duration boolean DEFAULT false, p_timer_duration_minutes numeric DEFAULT NULL::numeric, p_set_config_data boolean DEFAULT false, p_config_data jsonb DEFAULT NULL::jsonb, p_updated_by text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'heat_id is required';
  end if;

  insert into public.heat_realtime_config (
    heat_id,
    status,
    timer_start_time,
    timer_duration_minutes,
    config_data,
    updated_at,
    updated_by
  )
  values (
    trim(p_heat_id),
    coalesce(nullif(trim(coalesce(p_status, '')), ''), 'waiting'),
    case when p_set_timer_start_time then p_timer_start_time else null end,
    case when p_set_timer_duration then p_timer_duration_minutes else null end,
    case when p_set_config_data then p_config_data else null end,
    now(),
    coalesce(nullif(trim(coalesce(p_updated_by, '')), ''), current_user)
  )
  on conflict (heat_id) do update
    set status = coalesce(nullif(trim(coalesce(p_status, '')), ''), heat_realtime_config.status),
        timer_start_time = case
          when p_set_timer_start_time then p_timer_start_time
          else heat_realtime_config.timer_start_time
        end,
        timer_duration_minutes = case
          when p_set_timer_duration then p_timer_duration_minutes
          else heat_realtime_config.timer_duration_minutes
        end,
        config_data = case
          when p_set_config_data then p_config_data
          else heat_realtime_config.config_data
        end,
        updated_at = now(),
        updated_by = coalesce(nullif(trim(coalesce(p_updated_by, '')), ''), heat_realtime_config.updated_by, current_user);
end;
$$;


--
-- Name: upsert_score_secure(uuid, bigint, text, text, text, integer, text, text, text, text, text, integer, numeric, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_score_secure(p_id uuid, p_event_id bigint DEFAULT NULL::bigint, p_heat_id text DEFAULT NULL::text, p_competition text DEFAULT NULL::text, p_division text DEFAULT NULL::text, p_round integer DEFAULT NULL::integer, p_judge_id text DEFAULT NULL::text, p_judge_name text DEFAULT NULL::text, p_judge_station text DEFAULT NULL::text, p_judge_identity_id text DEFAULT NULL::text, p_surfer text DEFAULT NULL::text, p_wave_number integer DEFAULT NULL::integer, p_score numeric DEFAULT NULL::numeric, p_timestamp timestamp with time zone DEFAULT now(), p_created_at timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_heat record;
  v_assignment record;
  v_heat_config record;
  v_station text := upper(trim(coalesce(p_judge_station, p_judge_id, '')));
  v_identity text := upper(trim(coalesce(p_judge_identity_id, p_judge_id, '')));
  v_allowed boolean := false;
  v_result jsonb;
begin
  if p_id is null then
    raise exception 'score id is required';
  end if;

  if nullif(trim(coalesce(p_heat_id, '')), '') is null then
    raise exception 'heat_id is required';
  end if;

  if v_station = '' then
    raise exception 'judge station is required';
  end if;

  if nullif(trim(coalesce(p_surfer, '')), '') is null then
    raise exception 'surfer is required';
  end if;

  if p_wave_number is null or p_wave_number <= 0 then
    raise exception 'wave_number must be positive';
  end if;

  if p_score is null then
    raise exception 'score is required';
  end if;

  select h.id, h.event_id, h.competition, h.division, h.round
    into v_heat
  from public.heats h
  where h.id = trim(p_heat_id);

  if not found then
    raise exception 'heat % not found', p_heat_id;
  end if;

  select station, judge_id, judge_name
    into v_assignment
  from public.heat_judge_assignments
  where heat_id = v_heat.id
    and upper(trim(station)) = v_station
  limit 1;

  if found then
    v_allowed := true;

    if nullif(trim(coalesce(v_assignment.judge_id, '')), '') is not null
       and upper(trim(v_assignment.judge_id)) <> upper(trim(v_assignment.station))
       and v_identity <> ''
       and upper(trim(v_assignment.judge_id)) <> v_identity then
      raise exception 'judge identity mismatch for station %', v_station;
    end if;
  else
    select judges
      into v_heat_config
    from public.heat_configs
    where heat_id = v_heat.id
    limit 1;

    if found and exists (
      select 1
      from unnest(coalesce(v_heat_config.judges, '{}'::text[])) as station_name
      where upper(trim(station_name)) = v_station
    ) then
      v_allowed := true;
    end if;
  end if;

  if not v_allowed then
    raise exception 'judge station % is not assigned to heat %', v_station, v_heat.id;
  end if;

  insert into public.scores (
    id,
    event_id,
    heat_id,
    competition,
    division,
    round,
    judge_id,
    judge_name,
    judge_station,
    judge_identity_id,
    surfer,
    wave_number,
    score,
    timestamp,
    created_at
  )
  values (
    p_id,
    coalesce(p_event_id, v_heat.event_id),
    v_heat.id,
    coalesce(nullif(trim(coalesce(p_competition, '')), ''), v_heat.competition, 'Competition'),
    coalesce(nullif(trim(coalesce(p_division, '')), ''), v_heat.division, 'OPEN'),
    coalesce(p_round, v_heat.round, 1),
    coalesce(nullif(trim(coalesce(p_judge_id, '')), ''), v_station),
    coalesce(
      nullif(trim(coalesce(p_judge_name, '')), ''),
      nullif(trim(coalesce(v_assignment.judge_name, '')), ''),
      v_station
    ),
    v_station,
    nullif(trim(coalesce(p_judge_identity_id, '')), ''),
    trim(p_surfer),
    p_wave_number,
    p_score,
    coalesce(p_timestamp, now()),
    coalesce(p_created_at, now())
  )
  on conflict (id) do update
    set event_id = excluded.event_id,
        heat_id = excluded.heat_id,
        competition = excluded.competition,
        division = excluded.division,
        round = excluded.round,
        judge_id = excluded.judge_id,
        judge_name = excluded.judge_name,
        judge_station = excluded.judge_station,
        judge_identity_id = excluded.judge_identity_id,
        surfer = excluded.surfer,
        wave_number = excluded.wave_number,
        score = excluded.score,
        timestamp = excluded.timestamp,
        created_at = excluded.created_at
  returning to_jsonb(scores.*) into v_result;

  return v_result;
end;
$$;


--
-- Name: user_has_event_access(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_event_access(p_event_id bigint) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    p_event_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = p_event_id
        AND (
          e.user_id = (SELECT auth.uid())
          OR e.paid = true
        )
    );
$$;


--
-- Name: user_is_judge_for_heat(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_is_judge_for_heat(p_heat_id text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.heats h
    LEFT JOIN public.events e ON e.id = h.event_id
    WHERE h.id = p_heat_id
      AND (
        h.event_id IS NULL
        OR e.user_id = (SELECT auth.uid())
        OR e.paid = true
      )
  );
$$;


--
-- Name: validate_heat_start_dependencies(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_heat_start_dependencies(p_heat_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_heat record;
  v_blockers jsonb;
begin
  select h.id, h.event_id, h.division, h.round, h.heat_number
    into v_heat
  from public.heats h
  where h.id = trim(p_heat_id)
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'heat_id', trim(coalesce(p_heat_id, '')),
      'blockers', jsonb_build_array(jsonb_build_object(
        'reason', 'target_heat_missing',
        'message', 'Heat cible introuvable.'
      ))
    );
  end if;

  with mappings as (
    select
      hm.heat_id,
      hm.position,
      hm.placeholder,
      coalesce(
        hm.source_round,
        case
          when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[2]::integer
          else null
        end
      ) as source_round,
      coalesce(
        hm.source_heat,
        case
          when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[3]::integer
          else null
        end
      ) as source_heat,
      coalesce(
        hm.source_position,
        case
          when upper(trim(coalesce(hm.placeholder, ''))) ~ 'R(P?)[0-9]+-H[0-9]+-P[0-9]+'
            then (regexp_match(upper(trim(hm.placeholder)), 'R(P?)([0-9]+)-H([0-9]+)-P([0-9]+)'))[4]::integer
          else null
        end
      ) as source_position
    from public.heat_slot_mappings hm
    where hm.heat_id = v_heat.id
  ),
  dependency_rows as (
    select
      m.position,
      m.placeholder,
      m.source_round,
      m.source_heat,
      m.source_position,
      target_entry.participant_id as target_participant_id,
      exists (
        select 1
        from public.heat_entry_overrides override_row
        where override_row.heat_id = v_heat.id
          and override_row.position = m.position
      ) as has_manual_override,
      source_heat.id as source_heat_id,
      source_heat.status as source_status,
      exists (
        select 1
        from public.heat_realtime_config hrc
        where hrc.heat_id = source_heat.id
          and hrc.status = 'closed'
      ) as source_realtime_closed,
      ranked.participant_id as ranked_participant_id
    from mappings m
    left join public.heat_entries target_entry
      on target_entry.heat_id = v_heat.id
     and target_entry.position = m.position
    left join public.heats source_heat
      on source_heat.event_id = v_heat.event_id
     and lower(trim(coalesce(source_heat.division, ''))) = lower(trim(coalesce(v_heat.division, '')))
     and source_heat.round = m.source_round
     and source_heat.heat_number = m.source_heat
    left join lateral (
      select ranked.participant_id
      from public.fn_rank_heat_entries_from_scores(source_heat.id) ranked
      where ranked.rank_pos = m.source_position
      limit 1
    ) ranked on true
    where m.source_round is not null
      and m.source_heat is not null
      and m.source_position is not null
  ),
  blockers as (
    select
      jsonb_build_object(
        'position', d.position,
        'placeholder', d.placeholder,
        'source_round', d.source_round,
        'source_heat', d.source_heat,
        'source_position', d.source_position,
        'source_heat_id', d.source_heat_id,
        'source_status', d.source_status,
        'reason',
          case
            when d.source_heat_id is null then 'source_heat_missing'
            when not (coalesce(d.source_status, '') = 'closed' or d.source_realtime_closed) then 'source_heat_not_closed'
            when d.ranked_participant_id is not null and d.target_participant_id is null then 'qualifier_not_applied'
            else 'qualifier_missing'
          end,
        'message',
          case
            when d.source_heat_id is null then format('Source R%s H%s introuvable.', d.source_round, d.source_heat)
            when not (coalesce(d.source_status, '') = 'closed' or d.source_realtime_closed) then format('Source R%s H%s pas encore clôturée.', d.source_round, d.source_heat)
            when d.ranked_participant_id is not null and d.target_participant_id is null then format('Qualifié P%s de R%s H%s pas encore appliqué au lineup.', d.source_position, d.source_round, d.source_heat)
            else format('Qualifié P%s de R%s H%s indisponible.', d.source_position, d.source_round, d.source_heat)
          end
      ) as blocker
    from dependency_rows d
    where not d.has_manual_override
      and (
        d.source_heat_id is null
        or not (coalesce(d.source_status, '') = 'closed' or d.source_realtime_closed)
        or d.ranked_participant_id is null
        or d.target_participant_id is null
      )
  )
  select coalesce(jsonb_agg(blocker order by (blocker ->> 'position')::integer), '[]'::jsonb)
    into v_blockers
  from blockers;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'heat_id', v_heat.id,
    'blockers', v_blockers
  );
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_heat_pointer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_heat_pointer (
    event_name text NOT NULL,
    active_heat_id text,
    updated_at timestamp with time zone DEFAULT now(),
    event_id bigint,
    podium_id text DEFAULT 'A'::text NOT NULL
);

ALTER TABLE ONLY public.active_heat_pointer REPLICA IDENTITY FULL;


--
-- Name: app_cloud_test_activators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_cloud_test_activators (
    user_id uuid NOT NULL,
    authorized_at timestamp with time zone DEFAULT now() NOT NULL,
    authorized_by text
);


--
-- Name: app_deployment_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_deployment_config (
    id boolean DEFAULT true NOT NULL,
    deployment_mode text NOT NULL,
    provisioned_at timestamp with time zone DEFAULT now() NOT NULL,
    cloud_test_activation_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT app_deployment_config_deployment_mode_check CHECK ((deployment_mode = ANY (ARRAY['cloud'::text, 'field'::text]))),
    CONSTRAINT app_deployment_config_id_check CHECK (id),
    CONSTRAINT app_deployment_config_singleton CHECK ((id = true))
);


--
-- Name: app_runtime_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_runtime_schema_version (
    id boolean DEFAULT true NOT NULL,
    schema_version text NOT NULL,
    schema_label text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_runtime_schema_version_singleton CHECK (id)
);


--
-- Name: competition_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id bigint,
    heat_id text,
    podium_id text,
    action_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    actor_id text,
    actor_name text,
    actor_role text,
    before_data jsonb,
    after_data jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT competition_audit_action_check CHECK ((TRIM(BOTH FROM action_type) <> ''::text)),
    CONSTRAINT competition_audit_entity_check CHECK ((TRIM(BOTH FROM entity_type) <> ''::text))
);


--
-- Name: event_last_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_last_config (
    event_id bigint NOT NULL,
    event_name text NOT NULL,
    division text NOT NULL,
    round integer DEFAULT 1 NOT NULL,
    heat_number integer DEFAULT 1 NOT NULL,
    judges jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text DEFAULT CURRENT_USER NOT NULL,
    surfers text[] DEFAULT '{}'::text[],
    surfer_names jsonb DEFAULT '{}'::jsonb,
    surfer_countries jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE ONLY public.event_last_config REPLICA IDENTITY FULL;


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    name text NOT NULL,
    organizer text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    price integer NOT NULL,
    currency text DEFAULT 'XOF'::text NOT NULL,
    method text,
    status text DEFAULT 'pending'::text NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    paid_at timestamp with time zone,
    payment_ref text,
    categories jsonb DEFAULT '[]'::jsonb NOT NULL,
    judges jsonb DEFAULT '[]'::jsonb NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    config jsonb DEFAULT '{}'::jsonb,
    test_activated_at timestamp with time zone,
    test_activated_by uuid,
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text])))
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: heat_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    heat_id text NOT NULL,
    judges text[] NOT NULL,
    surfers text[] NOT NULL,
    judge_names jsonb DEFAULT '{}'::jsonb,
    waves integer DEFAULT 15,
    tournament_type text DEFAULT 'elimination'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: heat_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_entries (
    id bigint NOT NULL,
    heat_id text,
    participant_id bigint,
    "position" integer NOT NULL,
    seed integer NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    color text
);

ALTER TABLE ONLY public.heat_entries REPLICA IDENTITY FULL;


--
-- Name: heat_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.heat_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: heat_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.heat_entries_id_seq OWNED BY public.heat_entries.id;


--
-- Name: heat_entry_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_entry_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id bigint,
    heat_id text NOT NULL,
    "position" integer NOT NULL,
    color text,
    previous_participant_id bigint,
    previous_participant_name text,
    new_participant_id bigint,
    new_participant_name text NOT NULL,
    new_country text,
    reason text,
    created_by text DEFAULT 'chief_judge'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: heat_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    heat_id text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    duration_minutes integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: heat_judge_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_judge_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    heat_id text NOT NULL,
    event_id bigint,
    station text NOT NULL,
    judge_id text NOT NULL,
    judge_name text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT heat_judge_assignments_judge_id_check CHECK ((char_length(TRIM(BOTH FROM judge_id)) > 0)),
    CONSTRAINT heat_judge_assignments_judge_name_check CHECK ((char_length(TRIM(BOTH FROM judge_name)) > 0)),
    CONSTRAINT heat_judge_assignments_station_check CHECK ((char_length(TRIM(BOTH FROM station)) > 0))
);


--
-- Name: heat_realtime_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_realtime_config (
    heat_id text NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    timer_start_time timestamp with time zone,
    timer_duration_minutes integer DEFAULT 20,
    config_data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by text DEFAULT 'system'::text,
    CONSTRAINT heat_realtime_config_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'running'::text, 'paused'::text, 'finished'::text, 'closed'::text, 'open'::text])))
);

ALTER TABLE ONLY public.heat_realtime_config REPLICA IDENTITY FULL;


--
-- Name: heat_slot_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_slot_mappings (
    id bigint NOT NULL,
    heat_id text NOT NULL,
    "position" integer NOT NULL,
    placeholder text,
    source_round integer,
    source_heat integer,
    source_position integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE ONLY public.heat_slot_mappings REPLICA IDENTITY FULL;


--
-- Name: heat_slot_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.heat_slot_mappings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: heat_slot_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.heat_slot_mappings_id_seq OWNED BY public.heat_slot_mappings.id;


--
-- Name: heat_timers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_timers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    heat_id text NOT NULL,
    is_running boolean DEFAULT false,
    start_time timestamp with time zone,
    duration_minutes integer DEFAULT 20,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: heats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heats (
    id text NOT NULL,
    competition text NOT NULL,
    division text NOT NULL,
    round integer NOT NULL,
    heat_number integer NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    event_id bigint,
    heat_size integer,
    color_order text[],
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT heats_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'open'::text, 'running'::text, 'paused'::text, 'finished'::text, 'closed'::text])))
);

ALTER TABLE ONLY public.heats REPLICA IDENTITY FULL;


--
-- Name: interference_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interference_calls (
    id bigint NOT NULL,
    event_id bigint,
    heat_id text NOT NULL,
    competition text,
    division text,
    round integer,
    judge_id text NOT NULL,
    judge_name text,
    surfer text NOT NULL,
    wave_number integer NOT NULL,
    call_type text NOT NULL,
    is_head_judge_override boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    judge_station text,
    judge_identity_id text,
    CONSTRAINT interference_calls_call_type_check CHECK ((call_type = ANY (ARRAY['INT1'::text, 'INT2'::text]))),
    CONSTRAINT interference_calls_wave_number_check CHECK ((wave_number > 0))
);

ALTER TABLE ONLY public.interference_calls REPLICA IDENTITY FULL;


--
-- Name: interference_calls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.interference_calls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: interference_calls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.interference_calls_id_seq OWNED BY public.interference_calls.id;


--
-- Name: judges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.judges (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    personal_code text DEFAULT ''::text NOT NULL,
    email text,
    phone text,
    certification_level text,
    federation text DEFAULT 'FSS'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: materialized_view_refresh_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materialized_view_refresh_queue (
    view_name text NOT NULL,
    last_refresh_requested_at timestamp with time zone DEFAULT now() NOT NULL,
    last_refreshed_at timestamp with time zone
);


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id bigint NOT NULL,
    event_id bigint,
    category text NOT NULL,
    seed integer NOT NULL,
    name text NOT NULL,
    country text,
    license text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.participants_id_seq OWNED BY public.participants.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    event_id bigint,
    user_id uuid,
    provider text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'XOF'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    transaction_ref text,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['orange_money'::text, 'wave'::text, 'stripe'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text])))
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: podium_judge_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.podium_judge_assignments (
    event_id bigint NOT NULL,
    podium_id text NOT NULL,
    station text NOT NULL,
    judge_id text NOT NULL,
    judge_name text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT podium_judge_assignments_judge_id_check CHECK ((TRIM(BOTH FROM judge_id) <> ''::text)),
    CONSTRAINT podium_judge_assignments_judge_name_check CHECK ((TRIM(BOTH FROM judge_name) <> ''::text)),
    CONSTRAINT podium_judge_assignments_podium_check CHECK (((TRIM(BOTH FROM podium_id) <> ''::text) AND (podium_id = upper(TRIM(BOTH FROM podium_id))))),
    CONSTRAINT podium_judge_assignments_station_check CHECK ((TRIM(BOTH FROM station) <> ''::text))
);


--
-- Name: score_deletions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_deletions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    score_id text NOT NULL,
    heat_id text NOT NULL,
    event_id bigint,
    judge_id text NOT NULL,
    judge_name text,
    judge_station text,
    judge_identity_id text,
    surfer text NOT NULL,
    wave_number integer NOT NULL,
    score numeric NOT NULL,
    score_snapshot jsonb NOT NULL,
    reason text,
    comment text,
    deleted_by text,
    deleted_by_name text,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: score_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    heat_id text NOT NULL,
    score_id text NOT NULL,
    judge_id text NOT NULL,
    judge_name text NOT NULL,
    surfer text NOT NULL,
    wave_number integer NOT NULL,
    previous_score numeric(4,2),
    new_score numeric(4,2) NOT NULL,
    reason text NOT NULL,
    comment text,
    overridden_by text DEFAULT 'chief_judge'::text NOT NULL,
    overridden_by_name text DEFAULT 'Chef Judge'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    judge_station text,
    judge_identity_id text,
    CONSTRAINT score_overrides_reason_check CHECK ((reason = ANY (ARRAY['correction'::text, 'omission'::text, 'probleme'::text])))
);

ALTER TABLE ONLY public.score_overrides REPLICA IDENTITY FULL;


--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id text NOT NULL,
    heat_id text NOT NULL,
    competition text NOT NULL,
    division text NOT NULL,
    round integer NOT NULL,
    judge_id text NOT NULL,
    judge_name text NOT NULL,
    surfer text NOT NULL,
    wave_number integer NOT NULL,
    score numeric(4,2) NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    event_id bigint,
    judge_station text,
    judge_identity_id text,
    CONSTRAINT scores_score_check CHECK (((score >= (0)::numeric) AND (score <= (10)::numeric)))
);

ALTER TABLE ONLY public.scores REPLICA IDENTITY FULL;


--
-- Name: v_current_heat; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_current_heat AS
 SELECT a.event_name,
    e.id AS event_id,
    a.active_heat_id AS heat_id,
    h.division,
    h.round,
    h.heat_number,
    h.status
   FROM ((public.active_heat_pointer a
     JOIN public.heats h ON ((h.id = a.active_heat_id)))
     JOIN public.events e ON ((e.name = a.event_name)));


--
-- Name: v_event_divisions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_event_divisions AS
 SELECT e.id AS event_id,
    e.name AS event_name,
    p.category AS division
   FROM (public.events e
     JOIN public.participants p ON ((p.event_id = e.id)))
  GROUP BY e.id, e.name, p.category
  ORDER BY e.name, p.category;


--
-- Name: v_scores_canonical_enriched; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_scores_canonical_enriched AS
 WITH ranked_scores AS (
         SELECT score.id,
            score.heat_id,
            score.competition,
            score.division,
            score.round,
            score.judge_id,
            score.judge_name,
            score.surfer,
            score.wave_number,
            score.score,
            score."timestamp",
            score.created_at,
            score.event_id,
            score.judge_station,
            score.judge_identity_id,
            upper(TRIM(BOTH FROM COALESCE(score.judge_station, score.judge_id))) AS judge_station_normalized,
            row_number() OVER (PARTITION BY score.heat_id, (upper(TRIM(BOTH FROM COALESCE(score.judge_station, score.judge_id)))), (upper(TRIM(BOTH FROM score.surfer))), score.wave_number ORDER BY COALESCE(score."timestamp", score.created_at) DESC, score.created_at DESC, score.id DESC) AS row_rank
           FROM public.scores score
        ), resolved_scores AS (
         SELECT ranked_scores.id,
            COALESCE(heat.event_id, ranked_scores.event_id) AS event_id,
            ranked_scores.heat_id,
            ranked_scores.competition,
            ranked_scores.division,
            ranked_scores.round,
            COALESCE(NULLIF(TRIM(BOTH FROM ranked_scores.judge_identity_id), ''::text), assignment.judge_id, ranked_scores.judge_id) AS judge_identity_id,
            ranked_scores.judge_station_normalized AS judge_station,
            COALESCE(NULLIF(TRIM(BOTH FROM ranked_scores.judge_name), ''::text), assignment.judge_name, ranked_scores.judge_id) AS judge_display_name,
            ranked_scores.surfer,
            ranked_scores.wave_number,
            ranked_scores.score,
            ranked_scores."timestamp",
            ranked_scores.created_at
           FROM ((ranked_scores
             LEFT JOIN public.heats heat ON ((heat.id = ranked_scores.heat_id)))
             LEFT JOIN public.heat_judge_assignments assignment ON (((assignment.heat_id = ranked_scores.heat_id) AND (upper(TRIM(BOTH FROM assignment.station)) = ranked_scores.judge_station_normalized))))
          WHERE (ranked_scores.row_rank = 1)
        )
 SELECT resolved_scores.id,
    resolved_scores.event_id,
    resolved_scores.heat_id,
    resolved_scores.competition,
    resolved_scores.division,
    resolved_scores.round,
    resolved_scores.judge_identity_id,
    resolved_scores.judge_station,
    resolved_scores.judge_display_name,
    resolved_scores.surfer,
    resolved_scores.wave_number,
    resolved_scores.score,
    resolved_scores."timestamp",
    resolved_scores.created_at
   FROM resolved_scores;


--
-- Name: v_event_judge_accuracy_summary; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.v_event_judge_accuracy_summary AS
 WITH canonical_scores AS (
         SELECT score.event_id,
            score.heat_id,
            score.judge_identity_id,
            score.judge_display_name,
            upper(TRIM(BOTH FROM score.surfer)) AS surfer_key,
            score.wave_number,
            score.score
           FROM public.v_scores_canonical_enriched score
          WHERE ((score.event_id IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM score.judge_identity_id), ''::text) IS NOT NULL) AND (upper(TRIM(BOTH FROM score.judge_identity_id)) <> 'CHIEF'::text))
        ), scored_waves AS (
         SELECT score.event_id,
            score.judge_identity_id,
            max(score.judge_display_name) AS judge_display_name,
            (count(*))::integer AS scored_waves
           FROM canonical_scores score
          GROUP BY score.event_id, score.judge_identity_id
        ), wave_consensus AS (
         SELECT score.event_id,
            score.judge_identity_id,
            max(score.judge_display_name) AS judge_display_name,
            score.score,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((peer.score)::double precision)) AS consensus_score
           FROM (canonical_scores score
             LEFT JOIN canonical_scores peer ON (((peer.event_id = score.event_id) AND (peer.heat_id = score.heat_id) AND (peer.surfer_key = score.surfer_key) AND (peer.wave_number = score.wave_number) AND (peer.judge_identity_id <> score.judge_identity_id))))
          GROUP BY score.event_id, score.heat_id, score.judge_identity_id, score.surfer_key, score.wave_number, score.score
        ), score_accuracy AS (
         SELECT wave.event_id,
            wave.judge_identity_id,
            max(wave.judge_display_name) AS judge_display_name,
            (count(*) FILTER (WHERE (wave.consensus_score IS NOT NULL)))::integer AS consensus_samples,
            round((COALESCE(avg(abs(((wave.score)::double precision - wave.consensus_score))) FILTER (WHERE (wave.consensus_score IS NOT NULL)), (0)::double precision))::numeric, 2) AS mean_abs_deviation,
            round((COALESCE(avg(((wave.score)::double precision - wave.consensus_score)) FILTER (WHERE (wave.consensus_score IS NOT NULL)), (0)::double precision))::numeric, 2) AS bias,
            round(COALESCE(avg(
                CASE
                    WHEN (wave.consensus_score IS NULL) THEN NULL::numeric
                    WHEN (abs(((wave.score)::double precision - wave.consensus_score)) <= (0.5)::double precision) THEN 100.0
                    ELSE 0.0
                END), (0)::numeric), 2) AS within_half_point_rate
           FROM wave_consensus wave
          GROUP BY wave.event_id, wave.judge_identity_id
        ), override_stats AS (
         SELECT heat.event_id,
            COALESCE(NULLIF(TRIM(BOTH FROM override_log.judge_identity_id), ''::text), assignment.judge_id, NULLIF(TRIM(BOTH FROM override_log.judge_id), ''::text)) AS judge_identity_id,
            max(COALESCE(NULLIF(TRIM(BOTH FROM override_log.judge_name), ''::text), assignment.judge_name, NULLIF(TRIM(BOTH FROM override_log.judge_id), ''::text))) AS judge_display_name,
            (count(*))::integer AS override_count,
            round(COALESCE(avg(abs((COALESCE(override_log.new_score, (0)::numeric) - COALESCE(override_log.previous_score, (0)::numeric)))), (0)::numeric), 2) AS average_override_delta
           FROM ((public.score_overrides override_log
             LEFT JOIN public.heats heat ON ((heat.id = override_log.heat_id)))
             LEFT JOIN public.heat_judge_assignments assignment ON (((assignment.heat_id = override_log.heat_id) AND (upper(TRIM(BOTH FROM assignment.station)) = upper(TRIM(BOTH FROM COALESCE(override_log.judge_station, override_log.judge_id)))))))
          WHERE ((heat.event_id IS NOT NULL) AND (COALESCE(NULLIF(TRIM(BOTH FROM override_log.judge_identity_id), ''::text), assignment.judge_id, NULLIF(TRIM(BOTH FROM override_log.judge_id), ''::text)) IS NOT NULL) AND (upper(TRIM(BOTH FROM COALESCE(NULLIF(TRIM(BOTH FROM override_log.judge_identity_id), ''::text), assignment.judge_id, NULLIF(TRIM(BOTH FROM override_log.judge_id), ''::text)))) <> 'CHIEF'::text))
          GROUP BY heat.event_id, COALESCE(NULLIF(TRIM(BOTH FROM override_log.judge_identity_id), ''::text), assignment.judge_id, NULLIF(TRIM(BOTH FROM override_log.judge_id), ''::text))
        ), combined AS (
         SELECT COALESCE(score_stats.event_id, override_stats.event_id) AS event_id,
            COALESCE(score_stats.judge_identity_id, override_stats.judge_identity_id) AS judge_identity_id,
            COALESCE(score_stats.judge_display_name, override_stats.judge_display_name, COALESCE(score_stats.judge_identity_id, override_stats.judge_identity_id)) AS judge_display_name,
            COALESCE(scored.scored_waves, 0) AS scored_waves,
            COALESCE(score_stats.consensus_samples, 0) AS consensus_samples,
            COALESCE(score_stats.mean_abs_deviation, (0)::numeric) AS mean_abs_deviation,
            COALESCE(score_stats.bias, (0)::numeric) AS bias,
            COALESCE(score_stats.within_half_point_rate, (0)::numeric) AS within_half_point_rate,
            COALESCE(override_stats.override_count, 0) AS override_count,
            COALESCE(round(
                CASE
                    WHEN (COALESCE(scored.scored_waves, 0) > 0) THEN (((COALESCE(override_stats.override_count, 0))::numeric / (scored.scored_waves)::numeric) * (100)::numeric)
                    ELSE (0)::numeric
                END, 2), (0)::numeric) AS override_rate,
            COALESCE(override_stats.average_override_delta, (0)::numeric) AS average_override_delta
           FROM ((score_accuracy score_stats
             FULL JOIN override_stats ON (((override_stats.event_id = score_stats.event_id) AND (override_stats.judge_identity_id = score_stats.judge_identity_id))))
             LEFT JOIN scored_waves scored ON (((scored.event_id = COALESCE(score_stats.event_id, override_stats.event_id)) AND (scored.judge_identity_id = COALESCE(score_stats.judge_identity_id, override_stats.judge_identity_id)))))
        )
 SELECT combined.event_id,
    combined.judge_identity_id,
    combined.judge_display_name,
    combined.scored_waves,
    combined.consensus_samples,
    combined.mean_abs_deviation,
    combined.bias,
    combined.within_half_point_rate,
    combined.override_count,
    combined.override_rate,
    combined.average_override_delta,
    round(GREATEST((0)::numeric, LEAST((100)::numeric, (((((100)::numeric - LEAST((45)::numeric, (combined.mean_abs_deviation * (30)::numeric))) - LEAST((15)::numeric, (abs(combined.bias) * (20)::numeric))) - LEAST((20)::numeric, (combined.override_rate * 0.5))) + LEAST((10)::numeric, (combined.within_half_point_rate * 0.1))))), 2) AS quality_score,
        CASE
            WHEN (GREATEST((0)::numeric, LEAST((100)::numeric, (((((100)::numeric - LEAST((45)::numeric, (combined.mean_abs_deviation * (30)::numeric))) - LEAST((15)::numeric, (abs(combined.bias) * (20)::numeric))) - LEAST((20)::numeric, (combined.override_rate * 0.5))) + LEAST((10)::numeric, (combined.within_half_point_rate * 0.1))))) >= (85)::numeric) THEN 'excellent'::text
            WHEN (GREATEST((0)::numeric, LEAST((100)::numeric, (((((100)::numeric - LEAST((45)::numeric, (combined.mean_abs_deviation * (30)::numeric))) - LEAST((15)::numeric, (abs(combined.bias) * (20)::numeric))) - LEAST((20)::numeric, (combined.override_rate * 0.5))) + LEAST((10)::numeric, (combined.within_half_point_rate * 0.1))))) >= (70)::numeric) THEN 'good'::text
            WHEN (GREATEST((0)::numeric, LEAST((100)::numeric, (((((100)::numeric - LEAST((45)::numeric, (combined.mean_abs_deviation * (30)::numeric))) - LEAST((15)::numeric, (abs(combined.bias) * (20)::numeric))) - LEAST((20)::numeric, (combined.override_rate * 0.5))) + LEAST((10)::numeric, (combined.within_half_point_rate * 0.1))))) >= (55)::numeric) THEN 'watch'::text
            ELSE 'needs_review'::text
        END AS quality_band
   FROM combined
  WHERE ((combined.event_id IS NOT NULL) AND (combined.scored_waves > 0))
  WITH NO DATA;


--
-- Name: v_event_judge_assignment_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_event_judge_assignment_coverage AS
 WITH expected_stations AS (
         SELECT heat.id AS heat_id,
            heat.event_id,
            heat.competition,
            heat.division,
            heat.round,
            heat.heat_number,
            upper(TRIM(BOTH FROM station.value)) AS station
           FROM ((public.heats heat
             JOIN public.heat_configs config ON ((config.heat_id = heat.id)))
             CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(to_jsonb(config.judges), '[]'::jsonb)) station(value))
        ), resolved_assignments AS (
         SELECT assignment_1.heat_id,
            upper(TRIM(BOTH FROM assignment_1.station)) AS station,
            NULLIF(TRIM(BOTH FROM assignment_1.judge_id), ''::text) AS judge_identity_id,
            NULLIF(TRIM(BOTH FROM assignment_1.judge_name), ''::text) AS judge_name
           FROM public.heat_judge_assignments assignment_1
        )
 SELECT expected.event_id,
    expected.competition,
    expected.division,
    expected.round,
    expected.heat_number,
    expected.heat_id,
    (count(*))::integer AS expected_station_count,
    (count(*) FILTER (WHERE ((assignment.judge_identity_id IS NOT NULL) AND (assignment.judge_name IS NOT NULL))))::integer AS assigned_station_count,
    (count(*) FILTER (WHERE ((assignment.judge_identity_id IS NULL) OR (assignment.judge_name IS NULL))))::integer AS missing_station_count,
    bool_and(((assignment.judge_identity_id IS NOT NULL) AND (assignment.judge_name IS NOT NULL))) AS is_complete
   FROM (expected_stations expected
     LEFT JOIN resolved_assignments assignment ON (((assignment.heat_id = expected.heat_id) AND (assignment.station = expected.station))))
  GROUP BY expected.event_id, expected.competition, expected.division, expected.round, expected.heat_number, expected.heat_id;


--
-- Name: v_heat_lineup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_heat_lineup AS
 SELECT h.id AS heat_id,
    h.event_id,
    COALESCE(upper(he.color), upper(h.color_order[COALESCE(he."position", hm."position")]), ''::text) AS jersey_color,
    COALESCE(p.name, hm.placeholder) AS surfer_name,
    p.country,
    he.seed,
    COALESCE(he."position", hm."position") AS "position",
    hm.placeholder,
    hm.source_round,
    hm.source_heat,
    hm.source_position
   FROM (((public.heats h
     LEFT JOIN public.heat_entries he ON ((he.heat_id = h.id)))
     LEFT JOIN public.heat_slot_mappings hm ON (((hm.heat_id = h.id) AND (hm."position" = COALESCE(he."position", hm."position")))))
     LEFT JOIN public.participants p ON ((p.id = he.participant_id)))
  ORDER BY h.id, COALESCE(he."position", hm."position");


--
-- Name: v_heat_missing_score_slots; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_heat_missing_score_slots AS
 WITH expected_judges AS (
         SELECT heat.id AS heat_id,
            heat.event_id,
            upper(TRIM(BOTH FROM station.value)) AS judge_station,
            NULLIF(TRIM(BOTH FROM assignment.judge_id), ''::text) AS judge_identity_id,
            COALESCE(NULLIF(TRIM(BOTH FROM assignment.judge_name), ''::text), upper(TRIM(BOTH FROM station.value))) AS judge_display_name
           FROM (((public.heats heat
             JOIN public.heat_configs config ON ((config.heat_id = heat.id)))
             CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(to_jsonb(config.judges), '[]'::jsonb)) station(value))
             LEFT JOIN public.heat_judge_assignments assignment ON (((assignment.heat_id = heat.id) AND (upper(TRIM(BOTH FROM assignment.station)) = upper(TRIM(BOTH FROM station.value))))))
        ), started_wave_slots AS (
         SELECT DISTINCT score.heat_id,
            score.event_id,
            public.fn_normalize_jersey_label_sql(score.surfer) AS surfer,
            score.wave_number
           FROM public.v_scores_canonical_enriched score
          WHERE (score.score > (0)::numeric)
        ), matched_scores AS (
         SELECT DISTINCT score.heat_id,
            public.fn_normalize_jersey_label_sql(score.surfer) AS surfer,
            score.wave_number,
            NULLIF(TRIM(BOTH FROM score.judge_identity_id), ''::text) AS judge_identity_id,
            upper(TRIM(BOTH FROM score.judge_station)) AS judge_station
           FROM public.v_scores_canonical_enriched score
          WHERE (score.score > (0)::numeric)
        )
 SELECT expected.event_id,
    expected.heat_id,
    expected.judge_station,
    expected.judge_identity_id,
    expected.judge_display_name,
    started.surfer,
    started.wave_number
   FROM ((expected_judges expected
     JOIN started_wave_slots started ON ((started.heat_id = expected.heat_id)))
     LEFT JOIN matched_scores matched ON (((matched.heat_id = started.heat_id) AND (matched.surfer = started.surfer) AND (matched.wave_number = started.wave_number) AND (((expected.judge_identity_id IS NOT NULL) AND (matched.judge_identity_id IS NOT NULL) AND (lower(matched.judge_identity_id) = lower(expected.judge_identity_id))) OR (matched.judge_station = expected.judge_station)))))
  WHERE (matched.heat_id IS NULL);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: heat_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_entries ALTER COLUMN id SET DEFAULT nextval('public.heat_entries_id_seq'::regclass);


--
-- Name: heat_slot_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_slot_mappings ALTER COLUMN id SET DEFAULT nextval('public.heat_slot_mappings_id_seq'::regclass);


--
-- Name: interference_calls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interference_calls ALTER COLUMN id SET DEFAULT nextval('public.interference_calls_id_seq'::regclass);


--
-- Name: participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants ALTER COLUMN id SET DEFAULT nextval('public.participants_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: app_cloud_test_activators app_cloud_test_activators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cloud_test_activators
    ADD CONSTRAINT app_cloud_test_activators_pkey PRIMARY KEY (user_id);


--
-- Name: app_deployment_config app_deployment_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_deployment_config
    ADD CONSTRAINT app_deployment_config_pkey PRIMARY KEY (id);


--
-- Name: app_runtime_schema_version app_runtime_schema_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_runtime_schema_version
    ADD CONSTRAINT app_runtime_schema_version_pkey PRIMARY KEY (id);


--
-- Name: competition_audit_log competition_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_audit_log
    ADD CONSTRAINT competition_audit_log_pkey PRIMARY KEY (id);


--
-- Name: event_last_config event_last_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_last_config
    ADD CONSTRAINT event_last_config_pkey PRIMARY KEY (event_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: heat_configs heat_configs_heat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_configs
    ADD CONSTRAINT heat_configs_heat_id_key UNIQUE (heat_id);


--
-- Name: heat_configs heat_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_configs
    ADD CONSTRAINT heat_configs_pkey PRIMARY KEY (id);


--
-- Name: heat_entries heat_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_entries
    ADD CONSTRAINT heat_entries_pkey PRIMARY KEY (id);


--
-- Name: heat_entry_overrides heat_entry_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_entry_overrides
    ADD CONSTRAINT heat_entry_overrides_pkey PRIMARY KEY (id);


--
-- Name: heat_history heat_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_history
    ADD CONSTRAINT heat_history_pkey PRIMARY KEY (id);


--
-- Name: heat_judge_assignments heat_judge_assignments_heat_station_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_judge_assignments
    ADD CONSTRAINT heat_judge_assignments_heat_station_unique UNIQUE (heat_id, station);


--
-- Name: heat_judge_assignments heat_judge_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_judge_assignments
    ADD CONSTRAINT heat_judge_assignments_pkey PRIMARY KEY (id);


--
-- Name: heat_realtime_config heat_realtime_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_realtime_config
    ADD CONSTRAINT heat_realtime_config_pkey PRIMARY KEY (heat_id);


--
-- Name: heat_slot_mappings heat_slot_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_slot_mappings
    ADD CONSTRAINT heat_slot_mappings_pkey PRIMARY KEY (id);


--
-- Name: heat_timers heat_timers_heat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_timers
    ADD CONSTRAINT heat_timers_heat_id_key UNIQUE (heat_id);


--
-- Name: heat_timers heat_timers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_timers
    ADD CONSTRAINT heat_timers_pkey PRIMARY KEY (id);


--
-- Name: heats heats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heats
    ADD CONSTRAINT heats_pkey PRIMARY KEY (id);


--
-- Name: interference_calls interference_calls_heat_id_judge_id_surfer_wave_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interference_calls
    ADD CONSTRAINT interference_calls_heat_id_judge_id_surfer_wave_number_key UNIQUE (heat_id, judge_id, surfer, wave_number);


--
-- Name: interference_calls interference_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interference_calls
    ADD CONSTRAINT interference_calls_pkey PRIMARY KEY (id);


--
-- Name: judges judges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.judges
    ADD CONSTRAINT judges_pkey PRIMARY KEY (id);


--
-- Name: materialized_view_refresh_queue materialized_view_refresh_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materialized_view_refresh_queue
    ADD CONSTRAINT materialized_view_refresh_queue_pkey PRIMARY KEY (view_name);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: podium_judge_assignments podium_judge_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podium_judge_assignments
    ADD CONSTRAINT podium_judge_assignments_pkey PRIMARY KEY (event_id, podium_id, station);


--
-- Name: score_deletions score_deletions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_deletions
    ADD CONSTRAINT score_deletions_pkey PRIMARY KEY (id);


--
-- Name: score_overrides score_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_overrides
    ADD CONSTRAINT score_overrides_pkey PRIMARY KEY (id);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: events_name_unique_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX events_name_unique_lower ON public.events USING btree (lower(TRIM(BOTH FROM name)));


--
-- Name: events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_status_idx ON public.events USING btree (status);


--
-- Name: events_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_user_id_idx ON public.events USING btree (user_id);


--
-- Name: heat_entries_heat_position_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX heat_entries_heat_position_uk ON public.heat_entries USING btree (heat_id, "position");


--
-- Name: heat_entries_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX heat_entries_participant_idx ON public.heat_entries USING btree (participant_id);


--
-- Name: heat_entry_overrides_heat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX heat_entry_overrides_heat_idx ON public.heat_entry_overrides USING btree (heat_id, created_at DESC);


--
-- Name: heat_slot_mappings_heat_position_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX heat_slot_mappings_heat_position_uk ON public.heat_slot_mappings USING btree (heat_id, "position");


--
-- Name: heat_slot_mappings_placeholder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX heat_slot_mappings_placeholder_idx ON public.heat_slot_mappings USING btree (placeholder);


--
-- Name: heats_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX heats_event_id_idx ON public.heats USING btree (event_id);


--
-- Name: idx_active_heat_pointer_event_podium_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_active_heat_pointer_event_podium_unique ON public.active_heat_pointer USING btree (event_id, podium_id);


--
-- Name: idx_active_heat_pointer_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_heat_pointer_lookup ON public.active_heat_pointer USING btree (active_heat_id);


--
-- Name: idx_active_heat_pointer_name_podium_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_active_heat_pointer_name_podium_unique ON public.active_heat_pointer USING btree (lower(TRIM(BOTH FROM event_name)), podium_id) WHERE (event_id IS NULL);


--
-- Name: idx_competition_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competition_audit_action ON public.competition_audit_log USING btree (action_type, created_at DESC);


--
-- Name: idx_competition_audit_event_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competition_audit_event_created ON public.competition_audit_log USING btree (event_id, created_at DESC);


--
-- Name: idx_competition_audit_heat_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competition_audit_heat_created ON public.competition_audit_log USING btree (heat_id, created_at DESC);


--
-- Name: idx_heat_configs_heat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_configs_heat_id ON public.heat_configs USING btree (heat_id);


--
-- Name: idx_heat_entries_heat_id_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_entries_heat_id_position ON public.heat_entries USING btree (heat_id, "position");


--
-- Name: idx_heat_history_heat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_history_heat_id ON public.heat_history USING btree (heat_id);


--
-- Name: idx_heat_judge_assignments_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_judge_assignments_event_id ON public.heat_judge_assignments USING btree (event_id);


--
-- Name: idx_heat_judge_assignments_heat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_judge_assignments_heat_id ON public.heat_judge_assignments USING btree (heat_id);


--
-- Name: idx_heat_judge_assignments_heat_judge_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_judge_assignments_heat_judge_identity ON public.heat_judge_assignments USING btree (heat_id, lower(TRIM(BOTH FROM judge_id))) WHERE ((judge_id IS NOT NULL) AND (TRIM(BOTH FROM judge_id) <> ''::text) AND (TRIM(BOTH FROM judge_id) !~* '^J[0-9]+$'::text));


--
-- Name: idx_heat_judge_assignments_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_judge_assignments_station ON public.heat_judge_assignments USING btree (station);


--
-- Name: idx_heat_timers_heat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_timers_heat_id ON public.heat_timers USING btree (heat_id);


--
-- Name: idx_heats_competition_division; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heats_competition_division ON public.heats USING btree (competition, division);


--
-- Name: idx_heats_event_division; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heats_event_division ON public.heats USING btree (event_id, division, round, heat_number);


--
-- Name: idx_heats_event_division_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heats_event_division_status ON public.heats USING btree (event_id, division, status);


--
-- Name: idx_heats_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heats_status ON public.heats USING btree (status);


--
-- Name: idx_interference_calls_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interference_calls_event_id ON public.interference_calls USING btree (event_id);


--
-- Name: idx_interference_calls_heat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interference_calls_heat_id ON public.interference_calls USING btree (heat_id);


--
-- Name: idx_interference_calls_heat_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interference_calls_heat_station ON public.interference_calls USING btree (heat_id, judge_station);


--
-- Name: idx_interference_calls_judge_identity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interference_calls_judge_identity_id ON public.interference_calls USING btree (judge_identity_id);


--
-- Name: idx_interference_calls_surfer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interference_calls_surfer ON public.interference_calls USING btree (heat_id, surfer);


--
-- Name: idx_participants_event_category_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_event_category_seed ON public.participants USING btree (event_id, category, seed);


--
-- Name: idx_podium_judges_event_podium; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_podium_judges_event_podium ON public.podium_judge_assignments USING btree (event_id, podium_id, station);


--
-- Name: idx_podium_judges_official_identity_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_podium_judges_official_identity_once ON public.podium_judge_assignments USING btree (event_id, lower(TRIM(BOTH FROM judge_id))) WHERE (TRIM(BOTH FROM judge_id) !~* '^J[0-9]+$'::text);


--
-- Name: idx_score_deletions_heat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_deletions_heat ON public.score_deletions USING btree (heat_id, deleted_at DESC);


--
-- Name: idx_score_deletions_logical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_deletions_logical ON public.score_deletions USING btree (heat_id, judge_station, surfer, wave_number);


--
-- Name: idx_score_overrides_heat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_overrides_heat_id ON public.score_overrides USING btree (heat_id, created_at DESC);


--
-- Name: idx_score_overrides_heat_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_overrides_heat_station ON public.score_overrides USING btree (heat_id, judge_station);


--
-- Name: idx_score_overrides_judge_identity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_overrides_judge_identity_id ON public.score_overrides USING btree (judge_identity_id);


--
-- Name: idx_score_overrides_score_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_overrides_score_id ON public.score_overrides USING btree (score_id);


--
-- Name: idx_scores_event_heat_wave_surfer_judge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_event_heat_wave_surfer_judge ON public.scores USING btree (event_id, heat_id, upper(TRIM(BOTH FROM surfer)), wave_number, judge_identity_id);


--
-- Name: idx_scores_heat_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_heat_id_created_at ON public.scores USING btree (heat_id, created_at);


--
-- Name: idx_scores_heat_judge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_heat_judge ON public.scores USING btree (heat_id, judge_id);


--
-- Name: idx_scores_heat_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_heat_station ON public.scores USING btree (heat_id, judge_station);


--
-- Name: idx_scores_judge_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_judge_id ON public.scores USING btree (judge_id);


--
-- Name: idx_scores_judge_identity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_judge_identity_id ON public.scores USING btree (judge_identity_id);


--
-- Name: idx_scores_surfer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_surfer ON public.scores USING btree (surfer);


--
-- Name: idx_v_event_judge_accuracy_summary_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_v_event_judge_accuracy_summary_uniq ON public.v_event_judge_accuracy_summary USING btree (event_id, judge_identity_id);


--
-- Name: participants_event_cat_seed_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX participants_event_cat_seed_uk ON public.participants USING btree (event_id, category, seed);


--
-- Name: participants_event_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_event_category_idx ON public.participants USING btree (event_id, category);


--
-- Name: payments_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_event_id_idx ON public.payments USING btree (event_id);


--
-- Name: payments_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_provider_idx ON public.payments USING btree (provider);


--
-- Name: payments_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_user_id_idx ON public.payments USING btree (user_id);


--
-- Name: scores_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scores_event_id_idx ON public.scores USING btree (event_id);


--
-- Name: active_heat_pointer enforce_active_pointer_judge_podium_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_active_pointer_judge_podium_lock BEFORE INSERT OR UPDATE OF event_id, active_heat_id, podium_id ON public.active_heat_pointer FOR EACH ROW EXECUTE FUNCTION public.enforce_active_pointer_judge_podium_lock();


--
-- Name: heat_judge_assignments enforce_heat_judge_assignment_podium_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_heat_judge_assignment_podium_lock AFTER INSERT OR UPDATE OF heat_id, event_id, station, judge_id, judge_name ON public.heat_judge_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_heat_judge_assignment_podium_lock();


--
-- Name: events set_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: heat_realtime_config set_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: heats set_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.heats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: participants set_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: heat_entries tr_touch_heats_updated_at_heat_entries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_touch_heats_updated_at_heat_entries AFTER INSERT OR DELETE OR UPDATE ON public.heat_entries FOR EACH ROW EXECUTE FUNCTION public.fn_touch_heat_updated_at();


--
-- Name: heat_slot_mappings tr_touch_heats_updated_at_heat_slot_mappings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_touch_heats_updated_at_heat_slot_mappings AFTER INSERT OR DELETE OR UPDATE ON public.heat_slot_mappings FOR EACH ROW EXECUTE FUNCTION public.fn_touch_heat_updated_at();


--
-- Name: active_heat_pointer trg_active_heat_pointer_sync_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_active_heat_pointer_sync_identity BEFORE INSERT OR UPDATE OF active_heat_id, event_id, event_name ON public.active_heat_pointer FOR EACH ROW EXECUTE FUNCTION public.fn_sync_active_heat_pointer_identity();


--
-- Name: active_heat_pointer trg_audit_active_heat_pointer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_active_heat_pointer AFTER INSERT OR UPDATE OF active_heat_id, podium_id ON public.active_heat_pointer FOR EACH ROW EXECUTE FUNCTION public.fn_audit_active_heat_pointer();


--
-- Name: heats trg_audit_heat_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_heat_status AFTER UPDATE OF status ON public.heats FOR EACH ROW EXECUTE FUNCTION public.fn_audit_heat_status();


--
-- Name: interference_calls trg_audit_interference; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_interference AFTER INSERT OR DELETE OR UPDATE ON public.interference_calls FOR EACH ROW EXECUTE FUNCTION public.fn_audit_interference();


--
-- Name: score_deletions trg_audit_score_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_score_deletion AFTER INSERT ON public.score_deletions FOR EACH ROW EXECUTE FUNCTION public.fn_audit_score_deletion();


--
-- Name: scores trg_audit_score_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_score_update AFTER UPDATE OF score, surfer, wave_number, heat_id ON public.scores FOR EACH ROW EXECUTE FUNCTION public.fn_audit_score_update();


--
-- Name: scores trg_block_scores_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_block_scores_insert BEFORE INSERT ON public.scores FOR EACH ROW EXECUTE FUNCTION public.fn_block_scoring_when_closed();


--
-- Name: scores trg_block_scores_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_block_scores_update BEFORE UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION public.fn_block_scoring_when_closed();


--
-- Name: heat_realtime_config trg_block_unresolved_qualifier_heat_start; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_block_unresolved_qualifier_heat_start BEFORE INSERT OR UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION public.fn_block_unresolved_qualifier_heat_start();


--
-- Name: score_overrides trg_enrich_score_audit_from_override; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enrich_score_audit_from_override AFTER INSERT OR UPDATE ON public.score_overrides FOR EACH ROW EXECUTE FUNCTION public.fn_enrich_score_audit_from_override();


--
-- Name: heat_judge_assignments trg_heat_judge_assignments_sync_event_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_heat_judge_assignments_sync_event_id BEFORE INSERT OR UPDATE OF heat_id, event_id ON public.heat_judge_assignments FOR EACH ROW EXECUTE FUNCTION public.fn_sync_heat_judge_assignment_event_id();


--
-- Name: interference_calls trg_interference_calls_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_interference_calls_updated_at BEFORE UPDATE ON public.interference_calls FOR EACH ROW EXECUTE FUNCTION public.touch_interference_calls_updated_at();


--
-- Name: score_overrides trg_refresh_accuracy_overrides; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refresh_accuracy_overrides AFTER INSERT OR DELETE OR UPDATE ON public.score_overrides FOR EACH STATEMENT EXECUTE FUNCTION public.trg_queue_accuracy_summary_refresh();


--
-- Name: scores trg_refresh_accuracy_scores; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refresh_accuracy_scores AFTER INSERT OR DELETE OR UPDATE ON public.scores FOR EACH STATEMENT EXECUTE FUNCTION public.trg_queue_accuracy_summary_refresh();


--
-- Name: scores trg_scores_canonicalize_heat_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scores_canonicalize_heat_id BEFORE INSERT OR UPDATE OF heat_id, competition, division, round ON public.scores FOR EACH ROW EXECUTE FUNCTION public.fn_canonicalize_score_heat_id();


--
-- Name: scores trg_scores_sync_event_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scores_sync_event_id BEFORE INSERT OR UPDATE OF heat_id, event_id ON public.scores FOR EACH ROW EXECUTE FUNCTION public.fn_sync_scores_event_id_from_heat();


--
-- Name: heats trg_sync_heat_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_heat_status AFTER UPDATE ON public.heats FOR EACH ROW EXECUTE FUNCTION public.fn_sync_heat_status();


--
-- Name: events trg_update_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: heats trg_update_heats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_heats_updated_at BEFORE UPDATE ON public.heats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: participants trg_update_participants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_participants_updated_at BEFORE UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: heat_judge_assignments update_heat_judge_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_heat_judge_assignments_updated_at BEFORE UPDATE ON public.heat_judge_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: heat_realtime_config update_heat_realtime_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_heat_realtime_config_updated_at BEFORE UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: heat_timers update_heat_timers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_heat_timers_updated_at BEFORE UPDATE ON public.heat_timers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: podium_judge_assignments update_podium_judge_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_podium_judge_assignments_updated_at BEFORE UPDATE ON public.podium_judge_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: active_heat_pointer active_heat_pointer_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_heat_pointer
    ADD CONSTRAINT active_heat_pointer_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: app_cloud_test_activators app_cloud_test_activators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_cloud_test_activators
    ADD CONSTRAINT app_cloud_test_activators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: event_last_config event_last_config_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_last_config
    ADD CONSTRAINT event_last_config_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: events events_test_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_test_activated_by_fkey FOREIGN KEY (test_activated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: heat_configs heat_configs_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_configs
    ADD CONSTRAINT heat_configs_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: heat_entries heat_entries_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_entries
    ADD CONSTRAINT heat_entries_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: heat_entries heat_entries_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_entries
    ADD CONSTRAINT heat_entries_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: heat_history heat_history_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_history
    ADD CONSTRAINT heat_history_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: heat_judge_assignments heat_judge_assignments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_judge_assignments
    ADD CONSTRAINT heat_judge_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: heat_judge_assignments heat_judge_assignments_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_judge_assignments
    ADD CONSTRAINT heat_judge_assignments_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: heat_slot_mappings heat_slot_mappings_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_slot_mappings
    ADD CONSTRAINT heat_slot_mappings_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: heat_timers heat_timers_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_timers
    ADD CONSTRAINT heat_timers_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: heats heats_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heats
    ADD CONSTRAINT heats_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: interference_calls interference_calls_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interference_calls
    ADD CONSTRAINT interference_calls_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: interference_calls interference_calls_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interference_calls
    ADD CONSTRAINT interference_calls_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: participants participants_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: payments payments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: podium_judge_assignments podium_judge_assignments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.podium_judge_assignments
    ADD CONSTRAINT podium_judge_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: scores scores_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: scores scores_heat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_heat_id_fkey FOREIGN KEY (heat_id) REFERENCES public.heats(id) ON DELETE CASCADE;


--
-- Name: judges Active judges are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Active judges are viewable by everyone" ON public.judges FOR SELECT TO anon USING ((active = true));


--
-- Name: judges Authenticated users can delete judges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can delete judges" ON public.judges FOR DELETE TO authenticated USING (true);


--
-- Name: heat_realtime_config Authenticated users can insert heat realtime config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert heat realtime config" ON public.heat_realtime_config FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: judges Authenticated users can insert judges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert judges" ON public.judges FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heat_history Authenticated users can manage heat history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can manage heat history" ON public.heat_history TO authenticated USING (true) WITH CHECK (true);


--
-- Name: heat_realtime_config Authenticated users can update heat realtime config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update heat realtime config" ON public.heat_realtime_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: judges Authenticated users can update judges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update judges" ON public.judges FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: judges Authenticated users can view all judges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view all judges" ON public.judges FOR SELECT TO authenticated USING (true);


--
-- Name: heat_history Heat history is publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Heat history is publicly readable" ON public.heat_history FOR SELECT USING (true);


--
-- Name: active_heat_pointer; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.active_heat_pointer ENABLE ROW LEVEL SECURITY;

--
-- Name: app_runtime_schema_version allow_public_read_app_runtime_schema_version; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_public_read_app_runtime_schema_version ON public.app_runtime_schema_version FOR SELECT TO authenticated, anon USING (true);


--
-- Name: active_heat_pointer allow_system_write_active_heat_pointer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_system_write_active_heat_pointer ON public.active_heat_pointer USING ((( SELECT auth.role() AS role) = ANY (ARRAY['service_role'::text, 'authenticated'::text]))) WITH CHECK ((( SELECT auth.role() AS role) = ANY (ARRAY['service_role'::text, 'authenticated'::text])));


--
-- Name: app_cloud_test_activators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_cloud_test_activators ENABLE ROW LEVEL SECURITY;

--
-- Name: app_deployment_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_deployment_config ENABLE ROW LEVEL SECURITY;

--
-- Name: app_runtime_schema_version; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_runtime_schema_version ENABLE ROW LEVEL SECURITY;

--
-- Name: events authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.events FOR DELETE TO authenticated USING (true);


--
-- Name: heat_configs authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.heat_configs FOR DELETE TO authenticated USING (true);


--
-- Name: heat_judge_assignments authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.heat_judge_assignments FOR DELETE TO authenticated USING (true);


--
-- Name: heat_realtime_config authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.heat_realtime_config FOR DELETE TO authenticated USING (true);


--
-- Name: heat_timers authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.heat_timers FOR DELETE TO authenticated USING (true);


--
-- Name: heats authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.heats FOR DELETE TO authenticated USING (true);


--
-- Name: payments authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.payments FOR DELETE TO authenticated USING (true);


--
-- Name: score_overrides authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.score_overrides FOR DELETE TO authenticated USING (true);


--
-- Name: scores authenticated_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_delete ON public.scores FOR DELETE TO authenticated USING (true);


--
-- Name: events authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.events FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heat_configs authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.heat_configs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heat_judge_assignments authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.heat_judge_assignments FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heat_realtime_config authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.heat_realtime_config FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heat_timers authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.heat_timers FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heats authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.heats FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: payments authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.payments FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: score_overrides authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.score_overrides FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: scores authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert ON public.scores FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: participants authenticated_insert_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_insert_participants ON public.participants FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: heat_configs authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read ON public.heat_configs FOR SELECT TO authenticated USING (true);


--
-- Name: heat_realtime_config authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read ON public.heat_realtime_config FOR SELECT TO authenticated USING (true);


--
-- Name: heat_timers authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read ON public.heat_timers FOR SELECT TO authenticated USING (true);


--
-- Name: payments authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read ON public.payments FOR SELECT TO authenticated USING (true);


--
-- Name: score_overrides authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read ON public.score_overrides FOR SELECT TO authenticated USING (true);


--
-- Name: events authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: heat_configs authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.heat_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: heat_judge_assignments authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.heat_judge_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: heat_realtime_config authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.heat_realtime_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: heat_timers authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.heat_timers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: heats authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.heats FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: payments authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: score_overrides authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.score_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: scores authenticated_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update ON public.scores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: participants authenticated_update_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update_participants ON public.participants FOR UPDATE TO authenticated USING (true);


--
-- Name: competition_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_audit_log competition_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competition_audit_read ON public.competition_audit_log FOR SELECT TO authenticated, anon USING (true);


--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_insert_own ON public.events FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: events events_read_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_read_authoritative_field ON public.events FOR SELECT TO authenticated, anon USING ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: events events_read_cloud_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_read_cloud_owner ON public.events FOR SELECT TO authenticated USING (((auth.uid() IS NOT NULL) AND (user_id = auth.uid())));


--
-- Name: events events_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_update_own ON public.events FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: heat_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_configs heat_configs_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_configs_insert_accessible ON public.heat_configs FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_configs heat_configs_read_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_configs_read_public ON public.heat_configs FOR SELECT USING (true);


--
-- Name: heat_configs heat_configs_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_configs_select_policy ON public.heat_configs FOR SELECT USING (true);


--
-- Name: heat_configs heat_configs_update_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_configs_update_accessible ON public.heat_configs FOR UPDATE TO authenticated USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_configs heat_configs_write_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_configs_write_policy ON public.heat_configs USING ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text))) WITH CHECK ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text)));


--
-- Name: heat_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_entries heat_entries_read_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_entries_read_public ON public.heat_entries FOR SELECT USING (true);


--
-- Name: heat_entries heat_entries_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_entries_select_policy ON public.heat_entries FOR SELECT USING (true);


--
-- Name: heat_entries heat_entries_write_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_entries_write_policy ON public.heat_entries USING ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text))) WITH CHECK ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text)));


--
-- Name: heat_entry_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_entry_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_entry_overrides heat_entry_overrides_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_entry_overrides_public_read ON public.heat_entry_overrides FOR SELECT TO authenticated, anon USING (true);


--
-- Name: heat_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_history ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_judge_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_judge_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_judge_assignments heat_judge_assignments_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_judge_assignments_select_policy ON public.heat_judge_assignments FOR SELECT USING (true);


--
-- Name: heat_judge_assignments heat_judge_assignments_write_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_judge_assignments_write_policy ON public.heat_judge_assignments USING ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text))) WITH CHECK ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text)));


--
-- Name: heat_realtime_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_realtime_config ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_slot_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_slot_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_slot_mappings heat_slot_mappings_delete_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_slot_mappings_delete_accessible ON public.heat_slot_mappings FOR DELETE TO authenticated USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_slot_mappings heat_slot_mappings_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_slot_mappings_insert_accessible ON public.heat_slot_mappings FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_slot_mappings heat_slot_mappings_read_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_slot_mappings_read_accessible ON public.heat_slot_mappings FOR SELECT USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_slot_mappings heat_slot_mappings_update_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_slot_mappings_update_accessible ON public.heat_slot_mappings FOR UPDATE TO authenticated USING (public.user_is_judge_for_heat(heat_id)) WITH CHECK (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_timers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heat_timers ENABLE ROW LEVEL SECURITY;

--
-- Name: heat_timers heat_timers_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_timers_insert_accessible ON public.heat_timers FOR INSERT TO authenticated WITH CHECK (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_timers heat_timers_read_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_timers_read_accessible ON public.heat_timers FOR SELECT USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_timers heat_timers_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_timers_select_policy ON public.heat_timers FOR SELECT USING (true);


--
-- Name: heat_timers heat_timers_update_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_timers_update_accessible ON public.heat_timers FOR UPDATE TO authenticated USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: heat_timers heat_timers_write_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heat_timers_write_policy ON public.heat_timers USING ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text))) WITH CHECK ((public.is_local_database() OR (auth.role() = 'authenticated'::text) OR (auth.role() = 'service_role'::text)));


--
-- Name: heats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.heats ENABLE ROW LEVEL SECURITY;

--
-- Name: heats heats_insert_authenticated_manageable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heats_insert_authenticated_manageable ON public.heats FOR INSERT TO authenticated WITH CHECK (((event_id IS NULL) OR public.user_has_event_access(event_id)));


--
-- Name: heats heats_read_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heats_read_public ON public.heats FOR SELECT USING (true);


--
-- Name: heats heats_update_authenticated_manageable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY heats_update_authenticated_manageable ON public.heats FOR UPDATE TO authenticated USING (((event_id IS NULL) OR public.user_has_event_access(event_id))) WITH CHECK (((event_id IS NULL) OR public.user_has_event_access(event_id)));


--
-- Name: events insert_own_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_events ON public.events FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: payments insert_own_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_payments ON public.payments FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: interference_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interference_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: interference_calls interference_calls_delete_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interference_calls_delete_all ON public.interference_calls FOR DELETE USING (true);


--
-- Name: interference_calls interference_calls_insert_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interference_calls_insert_all ON public.interference_calls FOR INSERT WITH CHECK (true);


--
-- Name: interference_calls interference_calls_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interference_calls_read_all ON public.interference_calls FOR SELECT USING (true);


--
-- Name: interference_calls interference_calls_update_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interference_calls_update_all ON public.interference_calls FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: judges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.judges ENABLE ROW LEVEL SECURITY;

--
-- Name: judges judges_delete_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY judges_delete_authoritative_field ON public.judges FOR DELETE TO anon USING ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: judges judges_insert_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY judges_insert_authoritative_field ON public.judges FOR INSERT TO anon WITH CHECK ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: judges judges_update_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY judges_update_authoritative_field ON public.judges FOR UPDATE TO anon USING ((public.get_authoritative_deployment_mode() = 'field'::text)) WITH CHECK ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

--
-- Name: participants participants_delete_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_delete_authoritative_field ON public.participants FOR DELETE TO authenticated, anon USING ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: participants participants_insert_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_insert_authoritative_field ON public.participants FOR INSERT TO authenticated, anon WITH CHECK ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: participants participants_read_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_read_public ON public.participants FOR SELECT USING (true);


--
-- Name: participants participants_update_authoritative_field; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_update_authoritative_field ON public.participants FOR UPDATE TO authenticated, anon USING ((public.get_authoritative_deployment_mode() = 'field'::text)) WITH CHECK ((public.get_authoritative_deployment_mode() = 'field'::text));


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_select_policy ON public.payments FOR SELECT USING ((public.is_local_database() OR (auth.role() = 'service_role'::text) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = payments.event_id) AND (e.user_id = auth.uid()))))));


--
-- Name: payments payments_write_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_write_policy ON public.payments USING ((public.is_local_database() OR (auth.role() = 'service_role'::text))) WITH CHECK ((public.is_local_database() OR (auth.role() = 'service_role'::text)));


--
-- Name: podium_judge_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.podium_judge_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: podium_judge_assignments podium_judge_assignments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY podium_judge_assignments_read ON public.podium_judge_assignments FOR SELECT TO authenticated, anon USING (true);


--
-- Name: active_heat_pointer public can read active_heat_pointer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read active_heat_pointer" ON public.active_heat_pointer FOR SELECT USING (true);


--
-- Name: event_last_config public can read event_last_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read event_last_config" ON public.event_last_config FOR SELECT USING (true);


--
-- Name: heat_realtime_config public can read heat_realtime_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read heat_realtime_config" ON public.heat_realtime_config FOR SELECT USING (true);


--
-- Name: score_overrides public can read score_overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read score_overrides" ON public.score_overrides FOR SELECT USING (true);


--
-- Name: scores public can read scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read scores" ON public.scores FOR SELECT USING (true);


--
-- Name: heat_judge_assignments public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read ON public.heat_judge_assignments FOR SELECT TO authenticated, anon USING (true);


--
-- Name: payments read_own_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_own_payments ON public.payments FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: score_deletions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_deletions ENABLE ROW LEVEL SECURITY;

--
-- Name: score_deletions score_deletions_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY score_deletions_read_all ON public.score_deletions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: score_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: score_overrides score_overrides_insert_owners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY score_overrides_insert_owners ON public.score_overrides FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.heats h
     JOIN public.events e ON ((e.id = h.event_id)))
  WHERE ((h.id = score_overrides.heat_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: score_overrides score_overrides_read_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY score_overrides_read_accessible ON public.score_overrides FOR SELECT USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

--
-- Name: scores scores_read_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scores_read_accessible ON public.scores FOR SELECT USING (public.user_is_judge_for_heat(heat_id));


--
-- Name: events update_own_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY update_own_events ON public.events FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION activate_event_for_test(p_event_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.activate_event_for_test(p_event_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_event_for_test(p_event_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.activate_event_for_test(p_event_id bigint) TO service_role;


--
-- Name: FUNCTION activate_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.activate_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text) TO anon;
GRANT ALL ON FUNCTION public.activate_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text) TO authenticated;
GRANT ALL ON FUNCTION public.activate_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text) TO service_role;


--
-- Name: FUNCTION admin_override_heat_entry(p_heat_id text, p_position integer, p_color text, p_participant_id bigint, p_name text, p_country text, p_reason text, p_created_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_override_heat_entry(p_heat_id text, p_position integer, p_color text, p_participant_id bigint, p_name text, p_country text, p_reason text, p_created_by text) TO anon;
GRANT ALL ON FUNCTION public.admin_override_heat_entry(p_heat_id text, p_position integer, p_color text, p_participant_id bigint, p_name text, p_country text, p_reason text, p_created_by text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_override_heat_entry(p_heat_id text, p_position integer, p_color text, p_participant_id bigint, p_name text, p_country text, p_reason text, p_created_by text) TO service_role;


--
-- Name: FUNCTION apply_score_correction_secure(p_score_id uuid, p_heat_id text, p_set_surfer boolean, p_surfer text, p_set_wave_number boolean, p_wave_number integer, p_set_score boolean, p_score numeric, p_timestamp timestamp with time zone, p_log_id uuid, p_log_reason text, p_log_comment text, p_log_overridden_by text, p_log_overridden_by_name text, p_log_created_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.apply_score_correction_secure(p_score_id uuid, p_heat_id text, p_set_surfer boolean, p_surfer text, p_set_wave_number boolean, p_wave_number integer, p_set_score boolean, p_score numeric, p_timestamp timestamp with time zone, p_log_id uuid, p_log_reason text, p_log_comment text, p_log_overridden_by text, p_log_overridden_by_name text, p_log_created_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.apply_score_correction_secure(p_score_id uuid, p_heat_id text, p_set_surfer boolean, p_surfer text, p_set_wave_number boolean, p_wave_number integer, p_set_score boolean, p_score numeric, p_timestamp timestamp with time zone, p_log_id uuid, p_log_reason text, p_log_comment text, p_log_overridden_by text, p_log_overridden_by_name text, p_log_created_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.apply_score_correction_secure(p_score_id uuid, p_heat_id text, p_set_surfer boolean, p_surfer text, p_set_wave_number boolean, p_wave_number integer, p_set_score boolean, p_score numeric, p_timestamp timestamp with time zone, p_log_id uuid, p_log_reason text, p_log_comment text, p_log_overridden_by text, p_log_overridden_by_name text, p_log_created_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION assert_no_active_podium_judge_conflict(p_event_id bigint, p_active_heat_id text, p_podium_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.assert_no_active_podium_judge_conflict(p_event_id bigint, p_active_heat_id text, p_podium_id text) TO anon;
GRANT ALL ON FUNCTION public.assert_no_active_podium_judge_conflict(p_event_id bigint, p_active_heat_id text, p_podium_id text) TO authenticated;
GRANT ALL ON FUNCTION public.assert_no_active_podium_judge_conflict(p_event_id bigint, p_active_heat_id text, p_podium_id text) TO service_role;


--
-- Name: FUNCTION bulk_sync_scores(p_scores jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bulk_sync_scores(p_scores jsonb) TO anon;
GRANT ALL ON FUNCTION public.bulk_sync_scores(p_scores jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.bulk_sync_scores(p_scores jsonb) TO service_role;


--
-- Name: FUNCTION bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) TO anon;
GRANT ALL ON FUNCTION public.bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) TO service_role;


--
-- Name: FUNCTION bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_delete_ids text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_delete_ids text[]) TO anon;
GRANT ALL ON FUNCTION public.bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_delete_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.bulk_upsert_heats(p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_delete_ids text[]) TO service_role;


--
-- Name: FUNCTION bulk_upsert_heats_safe(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bulk_upsert_heats_safe(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bulk_upsert_heats_safe(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) TO anon;
GRANT ALL ON FUNCTION public.bulk_upsert_heats_safe(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.bulk_upsert_heats_safe(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb) TO service_role;


--
-- Name: FUNCTION bulk_upsert_heats_safe_v2(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_heat_configs jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bulk_upsert_heats_safe_v2(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_heat_configs jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bulk_upsert_heats_safe_v2(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_heat_configs jsonb) TO anon;
GRANT ALL ON FUNCTION public.bulk_upsert_heats_safe_v2(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_heat_configs jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.bulk_upsert_heats_safe_v2(p_event_id bigint, p_category text, p_overwrite boolean, p_heats jsonb, p_entries jsonb, p_mappings jsonb, p_participants jsonb, p_heat_configs jsonb) TO service_role;


--
-- Name: FUNCTION can_display_event(p_event_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_display_event(p_event_id bigint) TO anon;
GRANT ALL ON FUNCTION public.can_display_event(p_event_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.can_display_event(p_event_id bigint) TO service_role;


--
-- Name: FUNCTION can_display_heat(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_display_heat(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.can_display_heat(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.can_display_heat(p_heat_id text) TO service_role;


--
-- Name: FUNCTION check_heat_planning_safety(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_heat_planning_safety(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_heat_planning_safety(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) TO anon;
GRANT ALL ON FUNCTION public.check_heat_planning_safety(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) TO authenticated;
GRANT ALL ON FUNCTION public.check_heat_planning_safety(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) TO service_role;


--
-- Name: FUNCTION close_current_heat_and_open_next(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.close_current_heat_and_open_next() TO anon;
GRANT ALL ON FUNCTION public.close_current_heat_and_open_next() TO authenticated;
GRANT ALL ON FUNCTION public.close_current_heat_and_open_next() TO service_role;


--
-- Name: FUNCTION close_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.close_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text) TO anon;
GRANT ALL ON FUNCTION public.close_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text) TO authenticated;
GRANT ALL ON FUNCTION public.close_heat_on_podium(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text) TO service_role;


--
-- Name: FUNCTION close_heat_on_podium_strict(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text, p_force boolean, p_force_reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.close_heat_on_podium_strict(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text, p_force boolean, p_force_reason text) TO anon;
GRANT ALL ON FUNCTION public.close_heat_on_podium_strict(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text, p_force boolean, p_force_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.close_heat_on_podium_strict(p_event_id bigint, p_podium_id text, p_heat_id text, p_next_heat_id text, p_closed_by text, p_force boolean, p_force_reason text) TO service_role;


--
-- Name: FUNCTION configure_cloud_test_activation(p_enabled boolean, p_user_id uuid, p_authorized boolean, p_authorized_by text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.configure_cloud_test_activation(p_enabled boolean, p_user_id uuid, p_authorized boolean, p_authorized_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configure_cloud_test_activation(p_enabled boolean, p_user_id uuid, p_authorized boolean, p_authorized_by text) TO service_role;


--
-- Name: FUNCTION copy_podium_panel_to_heat(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.copy_podium_panel_to_heat(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text) TO anon;
GRANT ALL ON FUNCTION public.copy_podium_panel_to_heat(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text) TO authenticated;
GRANT ALL ON FUNCTION public.copy_podium_panel_to_heat(p_event_id bigint, p_podium_id text, p_heat_id text, p_assigned_by text) TO service_role;


--
-- Name: FUNCTION create_event_secure(p_name text, p_organizer text, p_start_date date, p_end_date date, p_price integer, p_currency text, p_categories jsonb, p_judges jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_event_secure(p_name text, p_organizer text, p_start_date date, p_end_date date, p_price integer, p_currency text, p_categories jsonb, p_judges jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_event_secure(p_name text, p_organizer text, p_start_date date, p_end_date date, p_price integer, p_currency text, p_categories jsonb, p_judges jsonb) TO anon;
GRANT ALL ON FUNCTION public.create_event_secure(p_name text, p_organizer text, p_start_date date, p_end_date date, p_price integer, p_currency text, p_categories jsonb, p_judges jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_event_secure(p_name text, p_organizer text, p_start_date date, p_end_date date, p_price integer, p_currency text, p_categories jsonb, p_judges jsonb) TO service_role;


--
-- Name: FUNCTION delete_score_secure(p_score_id text, p_heat_id text, p_reason text, p_comment text, p_deleted_by text, p_deleted_by_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_score_secure(p_score_id text, p_heat_id text, p_reason text, p_comment text, p_deleted_by text, p_deleted_by_name text) TO anon;
GRANT ALL ON FUNCTION public.delete_score_secure(p_score_id text, p_heat_id text, p_reason text, p_comment text, p_deleted_by text, p_deleted_by_name text) TO authenticated;
GRANT ALL ON FUNCTION public.delete_score_secure(p_score_id text, p_heat_id text, p_reason text, p_comment text, p_deleted_by text, p_deleted_by_name text) TO service_role;


--
-- Name: FUNCTION enforce_active_pointer_judge_podium_lock(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_active_pointer_judge_podium_lock() TO anon;
GRANT ALL ON FUNCTION public.enforce_active_pointer_judge_podium_lock() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_active_pointer_judge_podium_lock() TO service_role;


--
-- Name: FUNCTION enforce_heat_judge_assignment_podium_lock(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_heat_judge_assignment_podium_lock() TO anon;
GRANT ALL ON FUNCTION public.enforce_heat_judge_assignment_podium_lock() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_heat_judge_assignment_podium_lock() TO service_role;


--
-- Name: FUNCTION event_creation_is_local_database(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.event_creation_is_local_database() FROM PUBLIC;
GRANT ALL ON FUNCTION public.event_creation_is_local_database() TO anon;
GRANT ALL ON FUNCTION public.event_creation_is_local_database() TO authenticated;
GRANT ALL ON FUNCTION public.event_creation_is_local_database() TO service_role;


--
-- Name: FUNCTION fn_audit_active_heat_pointer(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_audit_active_heat_pointer() TO anon;
GRANT ALL ON FUNCTION public.fn_audit_active_heat_pointer() TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_active_heat_pointer() TO service_role;


--
-- Name: FUNCTION fn_audit_heat_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_audit_heat_status() TO anon;
GRANT ALL ON FUNCTION public.fn_audit_heat_status() TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_heat_status() TO service_role;


--
-- Name: FUNCTION fn_audit_interference(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_audit_interference() TO anon;
GRANT ALL ON FUNCTION public.fn_audit_interference() TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_interference() TO service_role;


--
-- Name: FUNCTION fn_audit_podium(p_event_id bigint, p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_audit_podium(p_event_id bigint, p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_audit_podium(p_event_id bigint, p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_podium(p_event_id bigint, p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_audit_score_deletion(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_audit_score_deletion() TO anon;
GRANT ALL ON FUNCTION public.fn_audit_score_deletion() TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_score_deletion() TO service_role;


--
-- Name: FUNCTION fn_audit_score_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_audit_score_update() TO anon;
GRANT ALL ON FUNCTION public.fn_audit_score_update() TO authenticated;
GRANT ALL ON FUNCTION public.fn_audit_score_update() TO service_role;


--
-- Name: FUNCTION fn_best_second_heat_entry_for_round(p_event_id bigint, p_division text, p_round integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_best_second_heat_entry_for_round(p_event_id bigint, p_division text, p_round integer) TO anon;
GRANT ALL ON FUNCTION public.fn_best_second_heat_entry_for_round(p_event_id bigint, p_division text, p_round integer) TO authenticated;
GRANT ALL ON FUNCTION public.fn_best_second_heat_entry_for_round(p_event_id bigint, p_division text, p_round integer) TO service_role;


--
-- Name: FUNCTION fn_block_scoring_when_closed(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_block_scoring_when_closed() TO anon;
GRANT ALL ON FUNCTION public.fn_block_scoring_when_closed() TO authenticated;
GRANT ALL ON FUNCTION public.fn_block_scoring_when_closed() TO service_role;


--
-- Name: FUNCTION fn_block_unresolved_qualifier_heat_start(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_block_unresolved_qualifier_heat_start() TO anon;
GRANT ALL ON FUNCTION public.fn_block_unresolved_qualifier_heat_start() TO authenticated;
GRANT ALL ON FUNCTION public.fn_block_unresolved_qualifier_heat_start() TO service_role;


--
-- Name: FUNCTION fn_canonicalize_score_heat_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_canonicalize_score_heat_id() TO anon;
GRANT ALL ON FUNCTION public.fn_canonicalize_score_heat_id() TO authenticated;
GRANT ALL ON FUNCTION public.fn_canonicalize_score_heat_id() TO service_role;


--
-- Name: FUNCTION fn_enrich_score_audit_from_override(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_enrich_score_audit_from_override() TO anon;
GRANT ALL ON FUNCTION public.fn_enrich_score_audit_from_override() TO authenticated;
GRANT ALL ON FUNCTION public.fn_enrich_score_audit_from_override() TO service_role;


--
-- Name: FUNCTION fn_get_event_operations_health(p_event_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_get_event_operations_health(p_event_id bigint) TO anon;
GRANT ALL ON FUNCTION public.fn_get_event_operations_health(p_event_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.fn_get_event_operations_health(p_event_id bigint) TO service_role;


--
-- Name: FUNCTION fn_get_heat_close_readiness(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_get_heat_close_readiness(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_get_heat_close_readiness(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_get_heat_close_readiness(p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_get_heat_close_validation(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_get_heat_close_validation(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_get_heat_close_validation(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_get_heat_close_validation(p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_heat_interference_summary(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_heat_interference_summary(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_heat_interference_summary(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_heat_interference_summary(p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_infer_heat_slot_mappings_for_heat(p_target_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_infer_heat_slot_mappings_for_heat(p_target_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_infer_heat_slot_mappings_for_heat(p_target_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_infer_heat_slot_mappings_for_heat(p_target_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_normalize_heat_color_sql(p_value text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_normalize_heat_color_sql(p_value text) TO anon;
GRANT ALL ON FUNCTION public.fn_normalize_heat_color_sql(p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_normalize_heat_color_sql(p_value text) TO service_role;


--
-- Name: FUNCTION fn_normalize_jersey_label_sql(p_value text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_normalize_jersey_label_sql(p_value text) TO anon;
GRANT ALL ON FUNCTION public.fn_normalize_jersey_label_sql(p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_normalize_jersey_label_sql(p_value text) TO service_role;


--
-- Name: FUNCTION fn_propagate_qualifiers_for_source_heat(p_source_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_propagate_qualifiers_for_source_heat(p_source_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_propagate_qualifiers_for_source_heat(p_source_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_propagate_qualifiers_for_source_heat(p_source_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_rank_heat_entries_exhaustive(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_rank_heat_entries_exhaustive(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_rank_heat_entries_exhaustive(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_rank_heat_entries_exhaustive(p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_rank_heat_entries_from_scores(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_rank_heat_entries_from_scores(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_rank_heat_entries_from_scores(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_rank_heat_entries_from_scores(p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_rank_heat_entries_scored_only(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_rank_heat_entries_scored_only(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.fn_rank_heat_entries_scored_only(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fn_rank_heat_entries_scored_only(p_heat_id text) TO service_role;


--
-- Name: FUNCTION fn_resolve_canonical_heat_id(p_heat_id text, p_event_id bigint, p_competition text, p_division text, p_round integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_resolve_canonical_heat_id(p_heat_id text, p_event_id bigint, p_competition text, p_division text, p_round integer) TO anon;
GRANT ALL ON FUNCTION public.fn_resolve_canonical_heat_id(p_heat_id text, p_event_id bigint, p_competition text, p_division text, p_round integer) TO authenticated;
GRANT ALL ON FUNCTION public.fn_resolve_canonical_heat_id(p_heat_id text, p_event_id bigint, p_competition text, p_division text, p_round integer) TO service_role;


--
-- Name: FUNCTION fn_sync_active_heat_pointer_identity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_sync_active_heat_pointer_identity() TO anon;
GRANT ALL ON FUNCTION public.fn_sync_active_heat_pointer_identity() TO authenticated;
GRANT ALL ON FUNCTION public.fn_sync_active_heat_pointer_identity() TO service_role;


--
-- Name: FUNCTION fn_sync_heat_judge_assignment_event_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_sync_heat_judge_assignment_event_id() TO anon;
GRANT ALL ON FUNCTION public.fn_sync_heat_judge_assignment_event_id() TO authenticated;
GRANT ALL ON FUNCTION public.fn_sync_heat_judge_assignment_event_id() TO service_role;


--
-- Name: FUNCTION fn_sync_heat_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_sync_heat_status() TO anon;
GRANT ALL ON FUNCTION public.fn_sync_heat_status() TO authenticated;
GRANT ALL ON FUNCTION public.fn_sync_heat_status() TO service_role;


--
-- Name: FUNCTION fn_sync_scores_event_id_from_heat(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_sync_scores_event_id_from_heat() TO anon;
GRANT ALL ON FUNCTION public.fn_sync_scores_event_id_from_heat() TO authenticated;
GRANT ALL ON FUNCTION public.fn_sync_scores_event_id_from_heat() TO service_role;


--
-- Name: FUNCTION fn_touch_heat_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_touch_heat_updated_at() TO anon;
GRANT ALL ON FUNCTION public.fn_touch_heat_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.fn_touch_heat_updated_at() TO service_role;


--
-- Name: FUNCTION fn_unified_heat_transition(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_unified_heat_transition() TO anon;
GRANT ALL ON FUNCTION public.fn_unified_heat_transition() TO authenticated;
GRANT ALL ON FUNCTION public.fn_unified_heat_transition() TO service_role;


--
-- Name: FUNCTION get_active_priority(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_priority() TO anon;
GRANT ALL ON FUNCTION public.get_active_priority() TO authenticated;
GRANT ALL ON FUNCTION public.get_active_priority() TO service_role;


--
-- Name: FUNCTION get_active_priority(p_podium_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_priority(p_podium_id text) TO anon;
GRANT ALL ON FUNCTION public.get_active_priority(p_podium_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_priority(p_podium_id text) TO service_role;


--
-- Name: FUNCTION get_active_priority(p_event_id bigint, p_podium_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_priority(p_event_id bigint, p_podium_id text) TO anon;
GRANT ALL ON FUNCTION public.get_active_priority(p_event_id bigint, p_podium_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_priority(p_event_id bigint, p_podium_id text) TO service_role;


--
-- Name: FUNCTION get_authoritative_deployment_mode(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_authoritative_deployment_mode() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_authoritative_deployment_mode() TO service_role;
GRANT ALL ON FUNCTION public.get_authoritative_deployment_mode() TO anon;
GRANT ALL ON FUNCTION public.get_authoritative_deployment_mode() TO authenticated;


--
-- Name: FUNCTION get_event_test_activation_capability(p_event_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_event_test_activation_capability(p_event_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_event_test_activation_capability(p_event_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.get_event_test_activation_capability(p_event_id bigint) TO service_role;


--
-- Name: FUNCTION get_heat_planning_safety_inventory(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_heat_planning_safety_inventory(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_heat_planning_safety_inventory(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) TO anon;
GRANT ALL ON FUNCTION public.get_heat_planning_safety_inventory(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) TO authenticated;
GRANT ALL ON FUNCTION public.get_heat_planning_safety_inventory(p_event_id bigint, p_category text, p_proposed_heat_ids text[], p_overwrite boolean) TO service_role;


--
-- Name: FUNCTION is_local_database(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_local_database() TO anon;
GRANT ALL ON FUNCTION public.is_local_database() TO authenticated;
GRANT ALL ON FUNCTION public.is_local_database() TO service_role;


--
-- Name: FUNCTION is_official_judge_assignment_id(p_judge_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_official_judge_assignment_id(p_judge_id text) TO anon;
GRANT ALL ON FUNCTION public.is_official_judge_assignment_id(p_judge_id text) TO authenticated;
GRANT ALL ON FUNCTION public.is_official_judge_assignment_id(p_judge_id text) TO service_role;


--
-- Name: FUNCTION rebuild_division_qualifiers_from_scores(p_event_id bigint, p_division text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rebuild_division_qualifiers_from_scores(p_event_id bigint, p_division text) TO anon;
GRANT ALL ON FUNCTION public.rebuild_division_qualifiers_from_scores(p_event_id bigint, p_division text) TO authenticated;
GRANT ALL ON FUNCTION public.rebuild_division_qualifiers_from_scores(p_event_id bigint, p_division text) TO service_role;


--
-- Name: FUNCTION record_score_override_secure(p_id uuid, p_heat_id text, p_score_id uuid, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_previous_score numeric, p_new_score numeric, p_reason text, p_comment text, p_overridden_by text, p_overridden_by_name text, p_created_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.record_score_override_secure(p_id uuid, p_heat_id text, p_score_id uuid, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_previous_score numeric, p_new_score numeric, p_reason text, p_comment text, p_overridden_by text, p_overridden_by_name text, p_created_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.record_score_override_secure(p_id uuid, p_heat_id text, p_score_id uuid, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_previous_score numeric, p_new_score numeric, p_reason text, p_comment text, p_overridden_by text, p_overridden_by_name text, p_created_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.record_score_override_secure(p_id uuid, p_heat_id text, p_score_id uuid, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_previous_score numeric, p_new_score numeric, p_reason text, p_comment text, p_overridden_by text, p_overridden_by_name text, p_created_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION refresh_judge_accuracy_summary(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.refresh_judge_accuracy_summary() TO anon;
GRANT ALL ON FUNCTION public.refresh_judge_accuracy_summary() TO authenticated;
GRANT ALL ON FUNCTION public.refresh_judge_accuracy_summary() TO service_role;


--
-- Name: FUNCTION set_podium_judge_panel(p_event_id bigint, p_podium_id text, p_assignments jsonb, p_assigned_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_podium_judge_panel(p_event_id bigint, p_podium_id text, p_assignments jsonb, p_assigned_by text) TO anon;
GRANT ALL ON FUNCTION public.set_podium_judge_panel(p_event_id bigint, p_podium_id text, p_assignments jsonb, p_assigned_by text) TO authenticated;
GRANT ALL ON FUNCTION public.set_podium_judge_panel(p_event_id bigint, p_podium_id text, p_assignments jsonb, p_assigned_by text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION touch_interference_calls_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_interference_calls_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_interference_calls_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_interference_calls_updated_at() TO service_role;


--
-- Name: FUNCTION trg_queue_accuracy_summary_refresh(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_queue_accuracy_summary_refresh() TO anon;
GRANT ALL ON FUNCTION public.trg_queue_accuracy_summary_refresh() TO authenticated;
GRANT ALL ON FUNCTION public.trg_queue_accuracy_summary_refresh() TO service_role;


--
-- Name: FUNCTION update_heat_realtime_config_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_heat_realtime_config_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_heat_realtime_config_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_heat_realtime_config_updated_at() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone, p_podium_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone, p_podium_id text) TO anon;
GRANT ALL ON FUNCTION public.upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone, p_podium_id text) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_active_heat_pointer(p_event_id bigint, p_event_name text, p_active_heat_id text, p_updated_at timestamp with time zone, p_podium_id text) TO service_role;


--
-- Name: FUNCTION upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb) TO anon;
GRANT ALL ON FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb) TO service_role;


--
-- Name: FUNCTION upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb, p_surfers text[], p_surfer_names jsonb, p_surfer_countries jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb, p_surfers text[], p_surfer_names jsonb, p_surfer_countries jsonb) TO anon;
GRANT ALL ON FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb, p_surfers text[], p_surfer_names jsonb, p_surfer_countries jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_event_last_config(p_event_id bigint, p_event_name text, p_division text, p_round integer, p_heat_number integer, p_judges jsonb, p_surfers text[], p_surfer_names jsonb, p_surfer_countries jsonb) TO service_role;


--
-- Name: FUNCTION upsert_heat_config_runtime(p_heat_id text, p_judges text[], p_surfers text[], p_judge_names jsonb, p_waves integer, p_tournament_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_heat_config_runtime(p_heat_id text, p_judges text[], p_surfers text[], p_judge_names jsonb, p_waves integer, p_tournament_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_heat_config_runtime(p_heat_id text, p_judges text[], p_surfers text[], p_judge_names jsonb, p_waves integer, p_tournament_type text) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_heat_config_runtime(p_heat_id text, p_judges text[], p_surfers text[], p_judge_names jsonb, p_waves integer, p_tournament_type text) TO service_role;
GRANT ALL ON FUNCTION public.upsert_heat_config_runtime(p_heat_id text, p_judges text[], p_surfers text[], p_judge_names jsonb, p_waves integer, p_tournament_type text) TO anon;


--
-- Name: FUNCTION upsert_heat_realtime_config(p_heat_id text, p_status text, p_set_timer_start_time boolean, p_timer_start_time timestamp with time zone, p_set_timer_duration boolean, p_timer_duration_minutes numeric, p_set_config_data boolean, p_config_data jsonb, p_updated_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_heat_realtime_config(p_heat_id text, p_status text, p_set_timer_start_time boolean, p_timer_start_time timestamp with time zone, p_set_timer_duration boolean, p_timer_duration_minutes numeric, p_set_config_data boolean, p_config_data jsonb, p_updated_by text) TO anon;
GRANT ALL ON FUNCTION public.upsert_heat_realtime_config(p_heat_id text, p_status text, p_set_timer_start_time boolean, p_timer_start_time timestamp with time zone, p_set_timer_duration boolean, p_timer_duration_minutes numeric, p_set_config_data boolean, p_config_data jsonb, p_updated_by text) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_heat_realtime_config(p_heat_id text, p_status text, p_set_timer_start_time boolean, p_timer_start_time timestamp with time zone, p_set_timer_duration boolean, p_timer_duration_minutes numeric, p_set_config_data boolean, p_config_data jsonb, p_updated_by text) TO service_role;


--
-- Name: FUNCTION upsert_score_secure(p_id uuid, p_event_id bigint, p_heat_id text, p_competition text, p_division text, p_round integer, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_score numeric, p_timestamp timestamp with time zone, p_created_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_score_secure(p_id uuid, p_event_id bigint, p_heat_id text, p_competition text, p_division text, p_round integer, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_score numeric, p_timestamp timestamp with time zone, p_created_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.upsert_score_secure(p_id uuid, p_event_id bigint, p_heat_id text, p_competition text, p_division text, p_round integer, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_score numeric, p_timestamp timestamp with time zone, p_created_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_score_secure(p_id uuid, p_event_id bigint, p_heat_id text, p_competition text, p_division text, p_round integer, p_judge_id text, p_judge_name text, p_judge_station text, p_judge_identity_id text, p_surfer text, p_wave_number integer, p_score numeric, p_timestamp timestamp with time zone, p_created_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION user_has_event_access(p_event_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.user_has_event_access(p_event_id bigint) TO anon;
GRANT ALL ON FUNCTION public.user_has_event_access(p_event_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.user_has_event_access(p_event_id bigint) TO service_role;


--
-- Name: FUNCTION user_is_judge_for_heat(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.user_is_judge_for_heat(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.user_is_judge_for_heat(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.user_is_judge_for_heat(p_heat_id text) TO service_role;


--
-- Name: FUNCTION validate_heat_start_dependencies(p_heat_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_heat_start_dependencies(p_heat_id text) TO anon;
GRANT ALL ON FUNCTION public.validate_heat_start_dependencies(p_heat_id text) TO authenticated;
GRANT ALL ON FUNCTION public.validate_heat_start_dependencies(p_heat_id text) TO service_role;


--
-- Name: TABLE active_heat_pointer; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.active_heat_pointer TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.active_heat_pointer TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.active_heat_pointer TO service_role;


--
-- Name: TABLE app_cloud_test_activators; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.app_cloud_test_activators TO service_role;


--
-- Name: TABLE app_deployment_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.app_deployment_config TO service_role;


--
-- Name: TABLE app_runtime_schema_version; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.app_runtime_schema_version TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.app_runtime_schema_version TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.app_runtime_schema_version TO service_role;


--
-- Name: TABLE competition_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.competition_audit_log TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.competition_audit_log TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.competition_audit_log TO service_role;


--
-- Name: TABLE event_last_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.event_last_config TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.event_last_config TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.event_last_config TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.events TO anon;
GRANT SELECT ON TABLE public.events TO authenticated;


--
-- Name: SEQUENCE events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.events_id_seq TO service_role;


--
-- Name: TABLE heat_configs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.heat_configs TO anon;
GRANT SELECT ON TABLE public.heat_configs TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_configs TO service_role;


--
-- Name: TABLE heat_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.heat_entries TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.heat_entries TO authenticated;


--
-- Name: SEQUENCE heat_entries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.heat_entries_id_seq TO anon;
GRANT ALL ON SEQUENCE public.heat_entries_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.heat_entries_id_seq TO service_role;


--
-- Name: TABLE heat_entry_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_entry_overrides TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_entry_overrides TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_entry_overrides TO service_role;


--
-- Name: TABLE heat_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_history TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_history TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_history TO service_role;


--
-- Name: TABLE heat_judge_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_judge_assignments TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_judge_assignments TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_judge_assignments TO service_role;


--
-- Name: TABLE heat_realtime_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_realtime_config TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.heat_realtime_config TO authenticated;


--
-- Name: TABLE heat_slot_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.heat_slot_mappings TO anon;
GRANT SELECT ON TABLE public.heat_slot_mappings TO authenticated;


--
-- Name: SEQUENCE heat_slot_mappings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.heat_slot_mappings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.heat_slot_mappings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.heat_slot_mappings_id_seq TO service_role;


--
-- Name: TABLE heat_timers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.heat_timers TO anon;
GRANT SELECT ON TABLE public.heat_timers TO authenticated;


--
-- Name: TABLE heats; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.heats TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE public.heats TO authenticated;


--
-- Name: TABLE interference_calls; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.interference_calls TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.interference_calls TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.interference_calls TO service_role;


--
-- Name: SEQUENCE interference_calls_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.interference_calls_id_seq TO anon;
GRANT ALL ON SEQUENCE public.interference_calls_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.interference_calls_id_seq TO service_role;


--
-- Name: TABLE judges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.judges TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.judges TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.judges TO service_role;


--
-- Name: TABLE materialized_view_refresh_queue; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.materialized_view_refresh_queue TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.materialized_view_refresh_queue TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.materialized_view_refresh_queue TO service_role;


--
-- Name: TABLE participants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.participants TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.participants TO authenticated;


--
-- Name: SEQUENCE participants_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.participants_id_seq TO anon;
GRANT ALL ON SEQUENCE public.participants_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.participants_id_seq TO service_role;


--
-- Name: SEQUENCE payments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.payments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.payments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.payments_id_seq TO service_role;


--
-- Name: TABLE podium_judge_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.podium_judge_assignments TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.podium_judge_assignments TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.podium_judge_assignments TO service_role;


--
-- Name: TABLE score_deletions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.score_deletions TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.score_deletions TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.score_deletions TO service_role;


--
-- Name: TABLE scores; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.scores TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE public.scores TO authenticated;


--
-- Name: TABLE v_current_heat; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_current_heat TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_current_heat TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_current_heat TO service_role;


--
-- Name: TABLE v_event_divisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_divisions TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_divisions TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_divisions TO service_role;


--
-- Name: TABLE v_scores_canonical_enriched; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_scores_canonical_enriched TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_scores_canonical_enriched TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_scores_canonical_enriched TO service_role;


--
-- Name: TABLE v_event_judge_accuracy_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_judge_accuracy_summary TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_judge_accuracy_summary TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_judge_accuracy_summary TO service_role;


--
-- Name: TABLE v_event_judge_assignment_coverage; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_judge_assignment_coverage TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_judge_assignment_coverage TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_event_judge_assignment_coverage TO service_role;


--
-- Name: TABLE v_heat_lineup; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_heat_lineup TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_heat_lineup TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_heat_lineup TO service_role;


--
-- Name: TABLE v_heat_missing_score_slots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_heat_missing_score_slots TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_heat_missing_score_slots TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.v_heat_missing_score_slots TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--

-- Realtime publication membership is application-owned. The publication itself
-- is supplied by the Supabase PostgreSQL image.
DO $$
DECLARE
  p38_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'P38_BASELINE_REQUIRES_SUPABASE_REALTIME_PUBLICATION';
  END IF;

  FOREACH p38_table IN ARRAY ARRAY[
    'active_heat_pointer',
    'event_last_config',
    'heat_entries',
    'heat_realtime_config',
    'heat_slot_mappings',
    'heats',
    'interference_calls',
    'score_overrides',
    'scores'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = p38_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        p38_table
      );
    END IF;
  END LOOP;
END
$$;

INSERT INTO public.app_runtime_schema_version
  (id, schema_version, schema_label, updated_at)
VALUES
  (true, '20260820000000_p38_canonical_baseline', 'P3.8 canonical baseline', now())
ON CONFLICT (id) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    schema_label = EXCLUDED.schema_label,
    updated_at = EXCLUDED.updated_at;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

COMMIT;
