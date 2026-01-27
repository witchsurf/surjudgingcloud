-- Allow judges to enter scores after timer ends, until heat is officially closed
-- Migration: 2026-01-27

-- Drop existing trigger function and recreate with new logic
drop trigger if exists trg_block_scores_insert on public.scores;
drop trigger if exists trg_block_scores_update on public.scores;
drop function if exists public.fn_block_scoring_when_not_running();

-- New function: Block scoring before timer starts and after heat is closed
-- Blocks scoring in: 'waiting' (before start), 'closed' (after close), null/undefined
-- Allows scoring in: 'running', 'paused', 'finished'
create or replace function public.fn_block_scoring_when_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    raise exception 'Saisie bloquée : heat non démarré (attendez que le timer démarre)',
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

-- Apply trigger to INSERT operations
create trigger trg_block_scores_insert
  before insert on public.scores
  for each row
  execute function public.fn_block_scoring_when_closed();

-- Apply trigger to UPDATE operations
create trigger trg_block_scores_update
  before update on public.scores
  for each row
  execute function public.fn_block_scoring_when_closed();

-- Add comment explaining the change
comment on function public.fn_block_scoring_when_closed() is
  'Blocks scoring before timer starts (waiting) and after heat is closed (closed). Allows scoring during (running), paused, and after timer expires (finished) until chief judge closes the heat.';
