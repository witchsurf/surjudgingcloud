-- FIX_TIMER_PRECISION.sql
-- Resolution of 400 Bad Request error on timer pause by allowing decimal minutes

ALTER TABLE "public"."heat_realtime_config" 
  ALTER COLUMN "timer_duration_minutes" TYPE numeric(10,4);

-- Optional: ensure heat_timers also supports decimal if still used anywhere
-- ALTER TABLE "public"."heat_timers" 
--  ALTER COLUMN "duration_minutes" TYPE numeric(10,4);
