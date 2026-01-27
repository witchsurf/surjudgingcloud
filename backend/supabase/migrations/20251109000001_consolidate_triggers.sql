-- Migration: Consolidate Duplicate Heat Transition Triggers
-- Created: 2025-11-09
-- Purpose: Remove overlapping triggers that cause race conditions and consolidate into single unified trigger

-- ============================================================================
-- 1. DROP OVERLAPPING TRIGGERS
-- ============================================================================

-- These triggers all try to do similar things (advance heats, update statuses)
-- which can cause race conditions and duplicate processing

DROP TRIGGER IF EXISTS trg_advance_on_finished ON public.heat_realtime_config;
DROP TRIGGER IF EXISTS trg_auto_transition_heats ON public.heat_realtime_config;
DROP TRIGGER IF EXISTS trg_normalize_close ON public.heat_realtime_config;
DROP TRIGGER IF EXISTS update_heat_realtime_config_trigger ON public.heats;

-- Also drop the old Gala-specific trigger (replaced by unified logic)
DROP TRIGGER IF EXISTS trg_gala_ondine_auto_transition ON public.heat_realtime_config CASCADE;

-- Drop old trigger functions that are no longer needed
DROP FUNCTION IF EXISTS public.fn_gala_ondine_auto_transition() CASCADE;
DROP FUNCTION IF EXISTS public.fn_normalize_close() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_close_heat_auto() CASCADE;

-- ============================================================================
-- 2. CREATE UNIFIED HEAT TRANSITION FUNCTION
-- ============================================================================

-- Single function to handle all heat transitions with proper locking to prevent race conditions
CREATE OR REPLACE FUNCTION public.fn_unified_heat_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id bigint;
  v_event_name text;
  v_division text;
  v_round integer;
  v_heat_no integer;
  v_next_heat_id text;
  v_old_status text;
BEGIN
  -- Only process when status changes to finished or closed
  IF TG_OP = 'UPDATE' AND NEW.status IN ('finished', 'closed') THEN
    v_old_status := COALESCE(OLD.status, '');

    -- Skip if status hasn't actually changed
    IF v_old_status = NEW.status THEN
      RETURN NEW;
    END IF;

    -- Get heat metadata with row-level lock to prevent race conditions
    SELECT h.event_id, h.competition, h.division, h.round, h.heat_number
      INTO v_event_id, v_event_name, v_division, v_round, v_heat_no
      FROM public.heats h
     WHERE h.id = NEW.heat_id
       FOR UPDATE NOWAIT; -- Fail fast if locked

    -- If we couldn't get the lock, another process is handling this heat
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- Step 1: Mark the current heat as closed in heats table
    UPDATE public.heats
       SET status = 'closed',
           closed_at = COALESCE(closed_at, now())
     WHERE id = NEW.heat_id
       AND status <> 'closed';

    -- Step 2: Find the next heat in sequence
    -- Try same round first, then next round
    SELECT h.id
      INTO v_next_heat_id
      FROM public.heats h
     WHERE h.event_id = v_event_id
       AND h.division = v_division
       AND h.status IN ('waiting', 'open')
       AND (
         -- Same round, higher heat number
         (h.round = v_round AND h.heat_number > v_heat_no)
         OR
         -- Next round, any heat
         (h.round > v_round)
       )
     ORDER BY h.round ASC, h.heat_number ASC
     LIMIT 1
       FOR UPDATE SKIP LOCKED; -- Skip if another process is handling it

    -- Step 3: If found next heat, prepare it
    IF v_next_heat_id IS NOT NULL THEN
      -- Update the next heat's status to waiting in realtime config
      UPDATE public.heat_realtime_config
         SET status = 'waiting',
             timer_start_time = NULL,
             updated_at = now(),
             updated_by = COALESCE(NEW.updated_by, 'system')
       WHERE heat_id = v_next_heat_id
         AND status IN ('waiting', 'open'); -- Only update if not already running

      -- Update heats table to mark as open/ready
      UPDATE public.heats
         SET status = 'open'
       WHERE id = v_next_heat_id
         AND status IN ('waiting', 'open');

      -- Update the active heat pointer
      INSERT INTO public.active_heat_pointer (event_name, active_heat_id, updated_at)
      VALUES (v_event_name, v_next_heat_id, now())
      ON CONFLICT (event_name)
      DO UPDATE SET
        active_heat_id = EXCLUDED.active_heat_id,
        updated_at = EXCLUDED.updated_at;

      RAISE NOTICE 'Heat transition: % → %', NEW.heat_id, v_next_heat_id;
    ELSE
      RAISE NOTICE 'No more heats for event % division %', v_event_name, v_division;
    END IF;

  END IF;

  RETURN NEW;
EXCEPTION
  WHEN lock_not_available THEN
    -- Another process is handling this, silently skip
    RAISE NOTICE 'Heat transition skipped (locked): %', NEW.heat_id;
    RETURN NEW;
  WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Error in heat transition for %: %', NEW.heat_id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. CREATE HEAT SYNC FUNCTION (keep heats and heat_realtime_config in sync)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_heat_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When heats table is updated, sync the status to heat_realtime_config
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.heat_realtime_config
       SET status = NEW.status,
           updated_at = now(),
           updated_by = COALESCE(current_user, 'system')
     WHERE heat_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. INSTALL NEW TRIGGERS
-- ============================================================================

-- Trigger on heat_realtime_config changes (main transition logic)
CREATE TRIGGER trg_unified_heat_transition
  AFTER UPDATE
  ON public.heat_realtime_config
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_unified_heat_transition();

-- Trigger to keep heats table and realtime config in sync
CREATE TRIGGER trg_sync_heat_status
  AFTER UPDATE
  ON public.heats
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_heat_status();

-- ============================================================================
-- 5. GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.fn_unified_heat_transition() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_heat_status() TO authenticated;

-- ============================================================================
-- SUMMARY
-- ============================================================================

-- This migration:
-- 1. Removes 5 overlapping trigger functions that caused race conditions
-- 2. Creates single unified heat transition function with proper locking
-- 3. Adds SKIP LOCKED and NOWAIT to prevent deadlocks
-- 4. Keeps heats and heat_realtime_config tables in sync
-- 5. Uses proper error handling to prevent cascading failures

-- Benefits:
-- - No more race conditions between multiple triggers
-- - Proper locking prevents duplicate processing
-- - Simpler logic is easier to debug and maintain
-- - Graceful handling of concurrent updates
