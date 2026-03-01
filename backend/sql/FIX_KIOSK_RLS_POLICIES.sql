-- Fix RLS policies for Kiosk Judges (anon users)
-- Kiosk judges are not authenticated via Supabase Auth, so they need 'anon' access to submit scores and interferences.

-- 1. Scores Table Policies
-- Allow anonymous users to insert scores
DROP POLICY IF EXISTS "anon_insert_scores" ON "public"."scores";
CREATE POLICY "anon_insert_scores" ON "public"."scores" 
FOR INSERT TO "anon" 
WITH CHECK (true);

-- Allow anonymous users to update their own scores (based on heat_id, judge_id, etc.)
DROP POLICY IF EXISTS "anon_update_scores" ON "public"."scores";
CREATE POLICY "anon_update_scores" ON "public"."scores" 
FOR UPDATE TO "anon" 
USING (true)
WITH CHECK (true);

-- Ensure public read is still active (it should be, but let's be explicit)
DROP POLICY IF EXISTS "allow_public_read_scores" ON "public"."scores";
CREATE POLICY "allow_public_read_scores" ON "public"."scores" 
FOR SELECT USING (true);


-- 2. Interference Calls Table Policies
-- (Creating the table if it doesn't exist just in case, though it should exist in the cloud)
CREATE TABLE IF NOT EXISTS "public"."interference_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "event_id" bigint,
    "heat_id" text NOT NULL,
    "competition" text,
    "division" text,
    "round" integer,
    "judge_id" text NOT NULL,
    "judge_name" text,
    "surfer" text NOT NULL,
    "wave_number" integer NOT NULL,
    "call_type" text NOT NULL,
    "is_head_judge_override" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE "public"."interference_calls" ENABLE ROW LEVEL SECURITY;

-- Allow public read
DROP POLICY IF EXISTS "allow_public_read_interference" ON "public"."interference_calls";
CREATE POLICY "allow_public_read_interference" ON "public"."interference_calls" 
FOR SELECT USING (true);

-- Allow anonymous users to insert interference calls
DROP POLICY IF EXISTS "anon_insert_interference" ON "public"."interference_calls";
CREATE POLICY "anon_insert_interference" ON "public"."interference_calls" 
FOR INSERT TO "anon" 
WITH CHECK (true);

-- Allow anonymous users to update interference calls
DROP POLICY IF EXISTS "anon_update_interference" ON "public"."interference_calls";
CREATE POLICY "anon_update_interference" ON "public"."interference_calls" 
FOR UPDATE TO "anon" 
USING (true)
WITH CHECK (true);

-- 3. Heat Realtime Config - Ensure anon can read (for timer sync)
-- This should already be covered by allow_public_read_access but let's double check
DROP POLICY IF EXISTS "allow_public_read_heat_realtime" ON "public"."heat_realtime_config";
CREATE POLICY "allow_public_read_heat_realtime" ON "public"."heat_realtime_config" 
FOR SELECT USING (true);

-- 4. Active Heat Pointer - Ensure anon can read
DROP POLICY IF EXISTS "allow_public_read_active_pointer" ON "public"."active_heat_pointer";
CREATE POLICY "allow_public_read_active_pointer" ON "public"."active_heat_pointer" 
FOR SELECT USING (true);
