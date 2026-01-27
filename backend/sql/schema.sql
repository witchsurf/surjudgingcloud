


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


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."bulk_upsert_heats"("p_heats" "jsonb" DEFAULT '[]'::"jsonb", "p_entries" "jsonb" DEFAULT '[]'::"jsonb", "p_mappings" "jsonb" DEFAULT '[]'::"jsonb", "p_participants" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."bulk_upsert_heats"("p_heats" "jsonb", "p_entries" "jsonb", "p_mappings" "jsonb", "p_participants" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_current_heat_and_open_next"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."close_current_heat_and_open_next"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_advance_on_close"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_event_id   bigint;
  v_event_name text;
  v_division   text;
  v_round      integer;
  v_heat_no    integer;
  v_next_id    text;
begin
  if tg_op = 'UPDATE'
     and new.status in ('finished','closed')
     and coalesce(old.status, '') <> new.status then

    update public.heats
       set status = 'closed'
     where id = new.heat_id
       and status <> 'closed';

    select h.event_id, h.competition, h.division, h.round, h.heat_number
      into v_event_id, v_event_name, v_division, v_round, v_heat_no
      from public.heats h
     where h.id = new.heat_id
     limit 1;

    select h.id
      into v_next_id
      from public.heats h
     where h.event_id = v_event_id
       and h.division = v_division
       and (
            (h.round = v_round and h.heat_number > v_heat_no)
         or (h.round = v_round + 1 and h.heat_number = 1)
       )
       and h.status in ('waiting','open')
     order by h.round asc, h.heat_number asc
     limit 1;

    if v_next_id is not null then
      update public.heats
         set status = 'open'
       where id = v_next_id;

      update public.heat_realtime_config
         set status = 'waiting',
             updated_at = now(),
             updated_by = current_user
       where heat_id = v_next_id;

      insert into public.active_heat_pointer(event_name, active_heat_id, updated_at)
      values (v_event_name, v_next_id, now())
      on conflict (event_name)
      do update set active_heat_id = excluded.active_heat_id,
                    updated_at      = excluded.updated_at;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_advance_on_close"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_advance_on_finished"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_next_heat_id text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('finished', 'closed')
     AND COALESCE(OLD.status, '') <> NEW.status
  THEN
    UPDATE public.heats
       SET status = 'closed'
     WHERE id = NEW.heat_id
       AND status <> 'closed';

    SELECT h.id
      INTO v_next_heat_id
      FROM public.heats h
     WHERE h.status IN ('waiting', 'open')
     ORDER BY h.id ASC
     LIMIT 1;

    IF v_next_heat_id IS NOT NULL THEN
      UPDATE public.heat_realtime_config
         SET status = 'waiting',
             updated_at = now(),
             updated_by = current_user
       WHERE heat_id = v_next_heat_id;

      INSERT INTO public.active_heat_pointer (event_name, active_heat_id, updated_at)
      VALUES (split_part(v_next_heat_id, '_', 1), v_next_heat_id, now())
      ON CONFLICT (event_name)
      DO UPDATE SET
        active_heat_id = EXCLUDED.active_heat_id,
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_advance_on_finished"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auto_transition_all_events"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_event_name text;
  v_next_heat_id text;
BEGIN
  v_event_name := split_part(NEW.heat_id, '_', 1);

  IF NEW.status = 'finished' THEN
    UPDATE public.heats
       SET status = 'closed'
     WHERE id = NEW.heat_id;

    SELECT id INTO v_next_heat_id
    FROM public.heats
    WHERE id LIKE v_event_name || '%'
      AND status IN ('waiting', 'open')
      AND id > NEW.heat_id
    ORDER BY id ASC
    LIMIT 1;

    IF v_next_heat_id IS NOT NULL THEN
      UPDATE public.heat_realtime_config
         SET status = 'waiting',
             updated_at = now(),
             updated_by = current_user
       WHERE heat_id = v_next_heat_id;

      INSERT INTO public.active_heat_pointer (event_name, active_heat_id, updated_at)
      VALUES (v_event_name, v_next_heat_id, now())
      ON CONFLICT (event_name)
      DO UPDATE SET
        active_heat_id = EXCLUDED.active_heat_id,
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_auto_transition_all_events"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_block_scoring_when_not_running"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_status text;
begin
  select rc.status
    into v_status
  from public.heat_realtime_config rc
  where rc.heat_id = coalesce(new.heat_id, old.heat_id)
  limit 1;

  if v_status is distinct from 'running' then
    raise exception 'Saisie bloquée : heat non running (%)', coalesce(v_status, 'inconnu') using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_block_scoring_when_not_running"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_gala_ondine_auto_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_next_heat_id text;
BEGIN
  IF NEW.heat_id LIKE 'Gala_ONDINE%' THEN
    IF NEW.status = 'finished' THEN
      UPDATE public.heats
         SET status = 'closed'
       WHERE id = NEW.heat_id;

      SELECT id INTO v_next_heat_id
      FROM public.heats
      WHERE id LIKE 'Gala_ONDINE%'
        AND status IN ('waiting', 'open')
        AND id > NEW.heat_id
      ORDER BY id ASC
      LIMIT 1;

      IF v_next_heat_id IS NOT NULL THEN
        UPDATE public.heat_realtime_config
           SET status = 'waiting',
               updated_at = now(),
               updated_by = current_user
         WHERE heat_id = v_next_heat_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_gala_ondine_auto_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_normalize_close"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'paused' AND OLD.status IN ('running','waiting','paused') THEN
    NEW.status := 'finished';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_normalize_close"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_close_heat_auto"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status IN ('paused', 'finished', 'closed') THEN
    PERFORM public.close_current_heat_and_open_next();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_close_heat_auto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_heat_realtime_config_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."update_heat_realtime_config_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_event_last_config"("p_event_id" bigint, "p_event_name" "text", "p_division" "text", "p_round" integer, "p_heat_number" integer, "p_judges" "jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."upsert_event_last_config"("p_event_id" bigint, "p_event_name" "text", "p_division" "text", "p_round" integer, "p_heat_number" integer, "p_judges" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."active_heat_pointer" (
    "event_name" "text" NOT NULL,
    "active_heat_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."active_heat_pointer" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_last_config" (
    "event_id" bigint NOT NULL,
    "event_name" "text" NOT NULL,
    "division" "text" NOT NULL,
    "round" integer DEFAULT 1 NOT NULL,
    "heat_number" integer DEFAULT 1 NOT NULL,
    "judges" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text" DEFAULT CURRENT_USER NOT NULL
);


ALTER TABLE "public"."event_last_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "organizer" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "price" integer NOT NULL,
    "currency" "text" DEFAULT 'XOF'::"text" NOT NULL,
    "method" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "paid" boolean DEFAULT false NOT NULL,
    "paid_at" timestamp with time zone,
    "payment_ref" "text",
    "categories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "judges" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."events_id_seq" OWNED BY "public"."events"."id";



CREATE TABLE IF NOT EXISTS "public"."heat_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "heat_id" "text" NOT NULL,
    "judges" "text"[] NOT NULL,
    "surfers" "text"[] NOT NULL,
    "judge_names" "jsonb" DEFAULT '{}'::"jsonb",
    "waves" integer DEFAULT 15,
    "tournament_type" "text" DEFAULT 'elimination'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."heat_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."heat_entries" (
    "id" bigint NOT NULL,
    "heat_id" "text",
    "participant_id" bigint,
    "position" integer NOT NULL,
    "seed" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "color" "text"
);


ALTER TABLE "public"."heat_entries" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."heat_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."heat_entries_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."heat_entries_id_seq" OWNED BY "public"."heat_entries"."id";



CREATE TABLE IF NOT EXISTS "public"."heat_realtime_config" (
    "heat_id" "text" NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "timer_start_time" timestamp with time zone,
    "timer_duration_minutes" integer DEFAULT 20,
    "config_data" "jsonb" DEFAULT '{}'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "text" DEFAULT 'system'::"text",
    CONSTRAINT "heat_realtime_config_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'running'::"text", 'paused'::"text", 'finished'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."heat_realtime_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."heat_slot_mappings" (
    "id" bigint NOT NULL,
    "heat_id" "text" NOT NULL,
    "position" integer NOT NULL,
    "placeholder" "text",
    "source_round" integer,
    "source_heat" integer,
    "source_position" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."heat_slot_mappings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."heat_slot_mappings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."heat_slot_mappings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."heat_slot_mappings_id_seq" OWNED BY "public"."heat_slot_mappings"."id";



CREATE TABLE IF NOT EXISTS "public"."heat_timers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "heat_id" "text" NOT NULL,
    "is_running" boolean DEFAULT false,
    "start_time" timestamp with time zone,
    "duration_minutes" integer DEFAULT 20,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."heat_timers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."heats" (
    "id" "text" NOT NULL,
    "competition" "text" NOT NULL,
    "division" "text" NOT NULL,
    "round" integer NOT NULL,
    "heat_number" integer NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "closed_at" timestamp with time zone,
    "event_id" bigint,
    "heat_size" integer,
    "color_order" "text"[],
    "is_active" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "heats_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'running'::"text", 'paused'::"text", 'finished'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."heats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participants" (
    "id" bigint NOT NULL,
    "event_id" bigint,
    "category" "text" NOT NULL,
    "seed" integer NOT NULL,
    "name" "text" NOT NULL,
    "country" "text",
    "license" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."participants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."participants_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."participants_id_seq" OWNED BY "public"."participants"."id";



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" bigint NOT NULL,
    "event_id" bigint,
    "user_id" "uuid",
    "provider" "text" NOT NULL,
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'XOF'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "transaction_ref" "text",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "payments_provider_check" CHECK (("provider" = ANY (ARRAY['orange_money'::"text", 'wave'::"text", 'stripe'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."payments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."payments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."payments_id_seq" OWNED BY "public"."payments"."id";



CREATE TABLE IF NOT EXISTS "public"."score_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "heat_id" "text" NOT NULL,
    "score_id" "text" NOT NULL,
    "judge_id" "text" NOT NULL,
    "judge_name" "text" NOT NULL,
    "surfer" "text" NOT NULL,
    "wave_number" integer NOT NULL,
    "previous_score" numeric(4,2),
    "new_score" numeric(4,2) NOT NULL,
    "reason" "text" NOT NULL,
    "comment" "text",
    "overridden_by" "text" DEFAULT 'chief_judge'::"text" NOT NULL,
    "overridden_by_name" "text" DEFAULT 'Chef Judge'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "score_overrides_reason_check" CHECK (("reason" = ANY (ARRAY['correction'::"text", 'omission'::"text", 'probleme'::"text"])))
);


ALTER TABLE "public"."score_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scores" (
    "id" "text" NOT NULL,
    "heat_id" "text" NOT NULL,
    "competition" "text" NOT NULL,
    "division" "text" NOT NULL,
    "round" integer NOT NULL,
    "judge_id" "text" NOT NULL,
    "judge_name" "text" NOT NULL,
    "surfer" "text" NOT NULL,
    "wave_number" integer NOT NULL,
    "score" numeric(4,2) NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "event_id" bigint,
    CONSTRAINT "scores_score_check" CHECK ((("score" >= (0)::numeric) AND ("score" <= (10)::numeric)))
);


ALTER TABLE "public"."scores" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_current_heat" AS
 SELECT "a"."event_name",
    "e"."id" AS "event_id",
    "a"."active_heat_id" AS "heat_id",
    "h"."division",
    "h"."round",
    "h"."heat_number",
    "h"."status"
   FROM (("public"."active_heat_pointer" "a"
     JOIN "public"."heats" "h" ON (("h"."id" = "a"."active_heat_id")))
     JOIN "public"."events" "e" ON (("e"."name" = "a"."event_name")));


ALTER VIEW "public"."v_current_heat" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_event_divisions" AS
 SELECT "e"."id" AS "event_id",
    "e"."name" AS "event_name",
    "p"."category" AS "division"
   FROM ("public"."events" "e"
     JOIN "public"."participants" "p" ON (("p"."event_id" = "e"."id")))
  GROUP BY "e"."id", "e"."name", "p"."category"
  ORDER BY "e"."name", "p"."category";


ALTER VIEW "public"."v_event_divisions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_heat_lineup" AS
 SELECT "h"."id" AS "heat_id",
    "h"."event_id",
    COALESCE("upper"("he"."color"), "upper"("h"."color_order"[COALESCE("he"."position", "hm"."position")]), ''::"text") AS "jersey_color",
    COALESCE("p"."name", "hm"."placeholder") AS "surfer_name",
    "p"."country",
    "he"."seed",
    COALESCE("he"."position", "hm"."position") AS "position",
    "hm"."placeholder",
    "hm"."source_round",
    "hm"."source_heat",
    "hm"."source_position"
   FROM ((("public"."heats" "h"
     LEFT JOIN "public"."heat_entries" "he" ON (("he"."heat_id" = "h"."id")))
     LEFT JOIN "public"."heat_slot_mappings" "hm" ON ((("hm"."heat_id" = "h"."id") AND ("hm"."position" = COALESCE("he"."position", "hm"."position")))))
     LEFT JOIN "public"."participants" "p" ON (("p"."id" = "he"."participant_id")))
  ORDER BY "h"."id", COALESCE("he"."position", "hm"."position");


ALTER VIEW "public"."v_heat_lineup" OWNER TO "postgres";


ALTER TABLE ONLY "public"."events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."heat_entries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."heat_entries_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."heat_slot_mappings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."heat_slot_mappings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."participants" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."participants_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."payments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."payments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."active_heat_pointer"
    ADD CONSTRAINT "active_heat_pointer_pkey" PRIMARY KEY ("event_name");



ALTER TABLE ONLY "public"."event_last_config"
    ADD CONSTRAINT "event_last_config_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heat_configs"
    ADD CONSTRAINT "heat_configs_heat_id_key" UNIQUE ("heat_id");



ALTER TABLE ONLY "public"."heat_configs"
    ADD CONSTRAINT "heat_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heat_entries"
    ADD CONSTRAINT "heat_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heat_entries"
    ADD CONSTRAINT "heat_entries_unique" UNIQUE ("heat_id", "position");



ALTER TABLE ONLY "public"."heat_realtime_config"
    ADD CONSTRAINT "heat_realtime_config_pkey" PRIMARY KEY ("heat_id");



ALTER TABLE ONLY "public"."heat_slot_mappings"
    ADD CONSTRAINT "heat_slot_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heat_slot_mappings"
    ADD CONSTRAINT "heat_slot_mappings_unique" UNIQUE ("heat_id", "position");



ALTER TABLE ONLY "public"."heat_timers"
    ADD CONSTRAINT "heat_timers_heat_id_key" UNIQUE ("heat_id");



ALTER TABLE ONLY "public"."heat_timers"
    ADD CONSTRAINT "heat_timers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heats"
    ADD CONSTRAINT "heats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."score_overrides"
    ADD CONSTRAINT "score_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_pkey" PRIMARY KEY ("id");



CREATE INDEX "events_status_idx" ON "public"."events" USING "btree" ("status");



CREATE INDEX "events_user_id_idx" ON "public"."events" USING "btree" ("user_id");



CREATE INDEX "heat_entries_heat_id_idx" ON "public"."heat_entries" USING "btree" ("heat_id");



CREATE INDEX "heat_entries_participant_idx" ON "public"."heat_entries" USING "btree" ("participant_id");



CREATE UNIQUE INDEX "heat_slot_mappings_heat_position_uk" ON "public"."heat_slot_mappings" USING "btree" ("heat_id", "position");



CREATE INDEX "heat_slot_mappings_placeholder_idx" ON "public"."heat_slot_mappings" USING "btree" ("placeholder");



CREATE INDEX "heats_event_id_idx" ON "public"."heats" USING "btree" ("event_id");



CREATE INDEX "idx_heat_configs_heat_id" ON "public"."heat_configs" USING "btree" ("heat_id");



CREATE INDEX "idx_heat_timers_heat_id" ON "public"."heat_timers" USING "btree" ("heat_id");



CREATE INDEX "idx_heats_competition_division" ON "public"."heats" USING "btree" ("competition", "division");



CREATE INDEX "idx_heats_status" ON "public"."heats" USING "btree" ("status");



CREATE INDEX "idx_score_overrides_heat_id" ON "public"."score_overrides" USING "btree" ("heat_id", "created_at" DESC);



CREATE INDEX "idx_score_overrides_score_id" ON "public"."score_overrides" USING "btree" ("score_id");



CREATE INDEX "idx_scores_heat_id" ON "public"."scores" USING "btree" ("heat_id");



CREATE INDEX "idx_scores_judge_id" ON "public"."scores" USING "btree" ("judge_id");



CREATE INDEX "idx_scores_surfer" ON "public"."scores" USING "btree" ("surfer");



CREATE UNIQUE INDEX "participants_event_cat_seed_uk" ON "public"."participants" USING "btree" ("event_id", "category", "seed");



CREATE INDEX "participants_event_category_idx" ON "public"."participants" USING "btree" ("event_id", "category");



CREATE INDEX "payments_event_id_idx" ON "public"."payments" USING "btree" ("event_id");



CREATE INDEX "payments_provider_idx" ON "public"."payments" USING "btree" ("provider");



CREATE INDEX "scores_event_id_idx" ON "public"."scores" USING "btree" ("event_id");



CREATE OR REPLACE TRIGGER "set_updated_at_trigger" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_trigger" BEFORE UPDATE ON "public"."heat_realtime_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_trigger" BEFORE UPDATE ON "public"."heats" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_trigger" BEFORE UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_advance_on_finished" AFTER UPDATE ON "public"."heat_realtime_config" FOR EACH ROW EXECUTE FUNCTION "public"."fn_advance_on_close"();



CREATE OR REPLACE TRIGGER "trg_auto_transition_heats" AFTER UPDATE ON "public"."heat_realtime_config" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_transition_all_events"();



CREATE OR REPLACE TRIGGER "trg_block_scores_insert" BEFORE INSERT ON "public"."scores" FOR EACH ROW EXECUTE FUNCTION "public"."fn_block_scoring_when_not_running"();



CREATE OR REPLACE TRIGGER "trg_block_scores_update" BEFORE UPDATE ON "public"."scores" FOR EACH ROW EXECUTE FUNCTION "public"."fn_block_scoring_when_not_running"();



CREATE OR REPLACE TRIGGER "trg_normalize_close" BEFORE UPDATE ON "public"."heat_realtime_config" FOR EACH ROW EXECUTE FUNCTION "public"."fn_normalize_close"();



CREATE OR REPLACE TRIGGER "trg_update_events_updated_at" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_update_heats_updated_at" BEFORE UPDATE ON "public"."heats" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_update_participants_updated_at" BEFORE UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "update_heat_realtime_config_trigger" AFTER UPDATE ON "public"."heats" FOR EACH ROW EXECUTE FUNCTION "public"."update_heat_realtime_config_updated_at"();



CREATE OR REPLACE TRIGGER "update_heat_timers_updated_at" BEFORE UPDATE ON "public"."heat_timers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."event_last_config"
    ADD CONSTRAINT "event_last_config_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."heat_configs"
    ADD CONSTRAINT "heat_configs_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heat_entries"
    ADD CONSTRAINT "heat_entries_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heat_entries"
    ADD CONSTRAINT "heat_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heat_slot_mappings"
    ADD CONSTRAINT "heat_slot_mappings_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heat_timers"
    ADD CONSTRAINT "heat_timers_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heats"
    ADD CONSTRAINT "heats_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



CREATE POLICY "Allow public read access on heat_configs" ON "public"."heat_configs" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on heat_timers" ON "public"."heat_timers" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on heats" ON "public"."heats" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on score_overrides" ON "public"."score_overrides" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on scores" ON "public"."scores" FOR SELECT USING (true);



CREATE POLICY "Allow unified access on heat_realtime_config" ON "public"."heat_realtime_config" USING ((( SELECT "auth"."role"() AS "role") = ANY (ARRAY['anon'::"text", 'authenticated'::"text", 'authenticator'::"text", 'dashboard_user'::"text", 'cli_login_postgres'::"text"]))) WITH CHECK (true);



ALTER TABLE "public"."active_heat_pointer" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow_public_read_access" ON "public"."heat_realtime_config" FOR SELECT USING (true);



CREATE POLICY "allow_public_read_active_heat_pointer" ON "public"."active_heat_pointer" FOR SELECT USING (true);



CREATE POLICY "allow_system_write_active_heat_pointer" ON "public"."active_heat_pointer" USING (("auth"."role"() = ANY (ARRAY['service_role'::"text", 'authenticated'::"text"]))) WITH CHECK (("auth"."role"() = ANY (ARRAY['service_role'::"text", 'authenticated'::"text"])));



CREATE POLICY "authenticated_delete_participants" ON "public"."participants" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "authenticated_insert_heat_configs" ON "public"."heat_configs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_insert_heat_timers" ON "public"."heat_timers" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_insert_heats" ON "public"."heats" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_insert_participants" ON "public"."participants" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_insert_score_overrides" ON "public"."score_overrides" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_insert_scores" ON "public"."scores" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_update_heat_config" ON "public"."heat_realtime_config" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_update_heat_configs" ON "public"."heat_configs" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update_heat_entries" ON "public"."heat_entries" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update_heat_slot_mappings" ON "public"."heat_slot_mappings" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update_heat_timers" ON "public"."heat_timers" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update_heats" ON "public"."heats" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update_participants" ON "public"."participants" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update_scores" ON "public"."scores" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heat_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heat_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "heat_entries_delete" ON "public"."heat_entries" FOR DELETE USING (true);



CREATE POLICY "heat_entries_insert_all" ON "public"."heat_entries" FOR INSERT WITH CHECK (true);



CREATE POLICY "heat_entries_select" ON "public"."heat_entries" FOR SELECT USING (true);



CREATE POLICY "heat_entries_update_all" ON "public"."heat_entries" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."heat_realtime_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heat_slot_mappings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "heat_slot_mappings_delete" ON "public"."heat_slot_mappings" FOR DELETE USING (true);



CREATE POLICY "heat_slot_mappings_insert_all" ON "public"."heat_slot_mappings" FOR INSERT WITH CHECK (true);



CREATE POLICY "heat_slot_mappings_select" ON "public"."heat_slot_mappings" FOR SELECT USING (true);



CREATE POLICY "heat_slot_mappings_update_all" ON "public"."heat_slot_mappings" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."heat_timers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_own_events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "insert_own_payments" ON "public"."payments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participants_insert_all" ON "public"."participants" FOR INSERT WITH CHECK (true);



CREATE POLICY "participants_select" ON "public"."participants" FOR SELECT USING (true);



CREATE POLICY "participants_update_all" ON "public"."participants" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_events_basic" ON "public"."events" FOR SELECT USING (true);



CREATE POLICY "read_own_or_paid_events" ON "public"."events" FOR SELECT USING (("paid" OR (("user_id" IS NOT NULL) AND (( SELECT "auth"."uid"() AS "uid") = "user_id"))));



CREATE POLICY "read_own_payments" ON "public"."payments" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."score_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_own_events" ON "public"."events" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."heat_realtime_config";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."bulk_upsert_heats"("p_heats" "jsonb", "p_entries" "jsonb", "p_mappings" "jsonb", "p_participants" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_upsert_heats"("p_heats" "jsonb", "p_entries" "jsonb", "p_mappings" "jsonb", "p_participants" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_upsert_heats"("p_heats" "jsonb", "p_entries" "jsonb", "p_mappings" "jsonb", "p_participants" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."close_current_heat_and_open_next"() TO "anon";
GRANT ALL ON FUNCTION "public"."close_current_heat_and_open_next"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_current_heat_and_open_next"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_advance_on_close"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_advance_on_close"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_advance_on_close"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_advance_on_finished"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_advance_on_finished"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_advance_on_finished"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_auto_transition_all_events"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auto_transition_all_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auto_transition_all_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_block_scoring_when_not_running"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_block_scoring_when_not_running"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_block_scoring_when_not_running"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_gala_ondine_auto_transition"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_gala_ondine_auto_transition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_gala_ondine_auto_transition"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_normalize_close"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_normalize_close"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_normalize_close"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_close_heat_auto"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_close_heat_auto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_close_heat_auto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_heat_realtime_config_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_heat_realtime_config_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_heat_realtime_config_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_event_last_config"("p_event_id" bigint, "p_event_name" "text", "p_division" "text", "p_round" integer, "p_heat_number" integer, "p_judges" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_event_last_config"("p_event_id" bigint, "p_event_name" "text", "p_division" "text", "p_round" integer, "p_heat_number" integer, "p_judges" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_event_last_config"("p_event_id" bigint, "p_event_name" "text", "p_division" "text", "p_round" integer, "p_heat_number" integer, "p_judges" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."active_heat_pointer" TO "anon";
GRANT ALL ON TABLE "public"."active_heat_pointer" TO "authenticated";
GRANT ALL ON TABLE "public"."active_heat_pointer" TO "service_role";



GRANT ALL ON TABLE "public"."event_last_config" TO "anon";
GRANT ALL ON TABLE "public"."event_last_config" TO "authenticated";
GRANT ALL ON TABLE "public"."event_last_config" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."heat_configs" TO "anon";
GRANT ALL ON TABLE "public"."heat_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_configs" TO "service_role";



GRANT ALL ON TABLE "public"."heat_entries" TO "anon";
GRANT ALL ON TABLE "public"."heat_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."heat_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."heat_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."heat_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."heat_realtime_config" TO "anon";
GRANT ALL ON TABLE "public"."heat_realtime_config" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_realtime_config" TO "service_role";



GRANT ALL ON TABLE "public"."heat_slot_mappings" TO "anon";
GRANT ALL ON TABLE "public"."heat_slot_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_slot_mappings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."heat_slot_mappings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."heat_slot_mappings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."heat_slot_mappings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."heat_timers" TO "anon";
GRANT ALL ON TABLE "public"."heat_timers" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_timers" TO "service_role";



GRANT ALL ON TABLE "public"."heats" TO "anon";
GRANT ALL ON TABLE "public"."heats" TO "authenticated";
GRANT ALL ON TABLE "public"."heats" TO "service_role";



GRANT ALL ON TABLE "public"."participants" TO "anon";
GRANT ALL ON TABLE "public"."participants" TO "authenticated";
GRANT ALL ON TABLE "public"."participants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."participants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."participants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."participants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."score_overrides" TO "anon";
GRANT ALL ON TABLE "public"."score_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."score_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."scores" TO "anon";
GRANT ALL ON TABLE "public"."scores" TO "authenticated";
GRANT ALL ON TABLE "public"."scores" TO "service_role";



GRANT ALL ON TABLE "public"."v_current_heat" TO "anon";
GRANT ALL ON TABLE "public"."v_current_heat" TO "authenticated";
GRANT ALL ON TABLE "public"."v_current_heat" TO "service_role";



GRANT ALL ON TABLE "public"."v_event_divisions" TO "anon";
GRANT ALL ON TABLE "public"."v_event_divisions" TO "authenticated";
GRANT ALL ON TABLE "public"."v_event_divisions" TO "service_role";



GRANT ALL ON TABLE "public"."v_heat_lineup" TO "anon";
GRANT ALL ON TABLE "public"."v_heat_lineup" TO "authenticated";
GRANT ALL ON TABLE "public"."v_heat_lineup" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































RESET ALL;
