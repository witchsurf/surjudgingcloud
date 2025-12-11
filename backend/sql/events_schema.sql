


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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."update_heat_realtime_config_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_heat_realtime_config_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


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


CREATE TABLE IF NOT EXISTS "public"."heat_realtime_config" (
    "heat_id" "text" NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "timer_start_time" timestamp with time zone,
    "timer_duration_minutes" integer DEFAULT 20,
    "config_data" "jsonb" DEFAULT '{}'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "text" DEFAULT 'system'::"text",
    CONSTRAINT "heat_realtime_config_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'running'::"text", 'paused'::"text", 'finished'::"text"])))
);


ALTER TABLE "public"."heat_realtime_config" OWNER TO "postgres";


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
    CONSTRAINT "heats_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."heats" OWNER TO "postgres";


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


ALTER TABLE ONLY "public"."events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heat_configs"
    ADD CONSTRAINT "heat_configs_heat_id_key" UNIQUE ("heat_id");



ALTER TABLE ONLY "public"."heat_configs"
    ADD CONSTRAINT "heat_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heat_realtime_config"
    ADD CONSTRAINT "heat_realtime_config_pkey" PRIMARY KEY ("heat_id");



ALTER TABLE ONLY "public"."heat_timers"
    ADD CONSTRAINT "heat_timers_heat_id_key" UNIQUE ("heat_id");



ALTER TABLE ONLY "public"."heat_timers"
    ADD CONSTRAINT "heat_timers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."heats"
    ADD CONSTRAINT "heats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."score_overrides"
    ADD CONSTRAINT "score_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_pkey" PRIMARY KEY ("id");



CREATE INDEX "events_status_idx" ON "public"."events" USING "btree" ("status");



CREATE INDEX "events_user_id_idx" ON "public"."events" USING "btree" ("user_id");



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



CREATE INDEX "scores_event_id_idx" ON "public"."scores" USING "btree" ("event_id");



CREATE OR REPLACE TRIGGER "update_heat_realtime_config_updated_at" BEFORE UPDATE ON "public"."heat_realtime_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_heat_realtime_config_updated_at"();



CREATE OR REPLACE TRIGGER "update_heat_timers_updated_at" BEFORE UPDATE ON "public"."heat_timers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."heat_configs"
    ADD CONSTRAINT "heat_configs_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heat_timers"
    ADD CONSTRAINT "heat_timers_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."heats"
    ADD CONSTRAINT "heats_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE CASCADE;



CREATE POLICY "Allow public insert on heat_configs" ON "public"."heat_configs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on heat_timers" ON "public"."heat_timers" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on heats" ON "public"."heats" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on score_overrides" ON "public"."score_overrides" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on scores" ON "public"."scores" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read access on heat_configs" ON "public"."heat_configs" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on heat_realtime_config" ON "public"."heat_realtime_config" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on heat_timers" ON "public"."heat_timers" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on heats" ON "public"."heats" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on score_overrides" ON "public"."score_overrides" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on scores" ON "public"."scores" FOR SELECT USING (true);



CREATE POLICY "Allow public update on heat_configs" ON "public"."heat_configs" FOR UPDATE USING (true);



CREATE POLICY "Allow public update on heat_timers" ON "public"."heat_timers" FOR UPDATE USING (true);



CREATE POLICY "Allow public update on heats" ON "public"."heats" FOR UPDATE USING (true);



CREATE POLICY "Allow public update on scores" ON "public"."scores" FOR UPDATE USING (true);



CREATE POLICY "Allow public write access on heat_realtime_config" ON "public"."heat_realtime_config" USING (true) WITH CHECK (true);



ALTER TABLE "public"."heat_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heat_realtime_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heat_timers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."score_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scores" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."update_heat_realtime_config_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_heat_realtime_config_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_heat_realtime_config_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."heat_configs" TO "anon";
GRANT ALL ON TABLE "public"."heat_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_configs" TO "service_role";



GRANT ALL ON TABLE "public"."heat_realtime_config" TO "anon";
GRANT ALL ON TABLE "public"."heat_realtime_config" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_realtime_config" TO "service_role";



GRANT ALL ON TABLE "public"."heat_timers" TO "anon";
GRANT ALL ON TABLE "public"."heat_timers" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_timers" TO "service_role";



GRANT ALL ON TABLE "public"."heats" TO "anon";
GRANT ALL ON TABLE "public"."heats" TO "authenticated";
GRANT ALL ON TABLE "public"."heats" TO "service_role";



GRANT ALL ON TABLE "public"."score_overrides" TO "anon";
GRANT ALL ON TABLE "public"."score_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."score_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."scores" TO "anon";
GRANT ALL ON TABLE "public"."scores" TO "authenticated";
GRANT ALL ON TABLE "public"."scores" TO "service_role";



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
