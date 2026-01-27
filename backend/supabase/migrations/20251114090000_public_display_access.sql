-- ============================================================================
-- Ensure the public display can read active heats without weakening write RLS
-- ============================================================================

begin;

-- Helper returning true when a heat is active (used in multiple policies)
create or replace function public.can_display_heat(p_heat_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.heats h
    where h.id = p_heat_id
      and coalesce(h.is_active, true)
  );
$$;

comment on function public.can_display_heat(text)
  is 'Returns true when the referenced heat is marked active; used to grant read-only display access.';

-- Helper for participant/event scoped tables
create or replace function public.can_display_event(p_event_id bigint)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.heats h
    where h.event_id = p_event_id
      and coalesce(h.is_active, true)
  );
$$;

comment on function public.can_display_event(bigint)
  is 'Returns true when at least one active heat exists for the event (unblocks display lookups).';

-- --------------------------------------------------------------------------
-- Heats (read-only for display clients)
-- --------------------------------------------------------------------------
drop policy if exists heats_public_display_read on public.heats;
create policy heats_public_display_read
  on public.heats
  for select
  to public
  using (coalesce(is_active, true));

grant select on public.heats to anon;
grant select on public.heats to authenticated;

-- --------------------------------------------------------------------------
-- Participants
-- --------------------------------------------------------------------------
drop policy if exists participants_public_display_read on public.participants;
create policy participants_public_display_read
  on public.participants
  for select
  to public
  using (public.can_display_event(event_id));

grant select on public.participants to anon;
grant select on public.participants to authenticated;

-- --------------------------------------------------------------------------
-- Heat entries
-- --------------------------------------------------------------------------
drop policy if exists heat_entries_public_display_read on public.heat_entries;
create policy heat_entries_public_display_read
  on public.heat_entries
  for select
  to public
  using (public.can_display_heat(heat_id));

grant select on public.heat_entries to anon;
grant select on public.heat_entries to authenticated;

-- --------------------------------------------------------------------------
-- Heat slot mappings
-- --------------------------------------------------------------------------
drop policy if exists heat_slot_mappings_public_display_read on public.heat_slot_mappings;
create policy heat_slot_mappings_public_display_read
  on public.heat_slot_mappings
  for select
  to public
  using (public.can_display_heat(heat_id));

grant select on public.heat_slot_mappings to anon;
grant select on public.heat_slot_mappings to authenticated;

-- --------------------------------------------------------------------------
-- Heat configs (used to hydrate surfers/judges on the display)
-- --------------------------------------------------------------------------
drop policy if exists heat_configs_public_display_read on public.heat_configs;
create policy heat_configs_public_display_read
  on public.heat_configs
  for select
  to public
  using (public.can_display_heat(heat_id));

grant select on public.heat_configs to anon;
grant select on public.heat_configs to authenticated;

-- --------------------------------------------------------------------------
-- Heat realtime config / timers for the big screen
-- --------------------------------------------------------------------------
drop policy if exists heat_realtime_config_public_display_read on public.heat_realtime_config;
create policy heat_realtime_config_public_display_read
  on public.heat_realtime_config
  for select
  to public
  using (public.can_display_heat(heat_id));

grant select on public.heat_realtime_config to anon;
grant select on public.heat_realtime_config to authenticated;

drop policy if exists heat_timers_public_display_read on public.heat_timers;
create policy heat_timers_public_display_read
  on public.heat_timers
  for select
  to public
  using (public.can_display_heat(heat_id));

grant select on public.heat_timers to anon;
grant select on public.heat_timers to authenticated;

-- --------------------------------------------------------------------------
-- Scores (readonly so the display can show the leaderboard)
-- --------------------------------------------------------------------------
drop policy if exists scores_public_display_read on public.scores;
create policy scores_public_display_read
  on public.scores
  for select
  to public
  using (public.can_display_heat(heat_id));

grant select on public.scores to anon;
grant select on public.scores to authenticated;

commit;

-- Diagnostics (optional when running via dashboard)
select
  schemaname,
  tablename,
  policyname,
  cmd as operation
from pg_policies
where schemaname = 'public'
  and policyname like '%public_display_read%'
order by tablename, policyname;
