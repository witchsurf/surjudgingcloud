-- ============================================================================
-- TEMP: allow the field app (anon key) to create heats/scores/timer rows again
-- ============================================================================

begin;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heats' and policyname = 'heats_insert_owned_events'
  ) then
    drop policy heats_insert_owned_events on public.heats;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heats' and policyname = 'heats_update_accessible_events'
  ) then
    drop policy heats_update_accessible_events on public.heats;
  end if;
end $$;

create policy heats_public_insert_temp
  on public.heats
  for insert
  to public
  with check (true);

create policy heats_public_update_temp
  on public.heats
  for update
  to public
  using (true)
  with check (true);

grant insert, update on public.heats to anon;
grant insert, update on public.heats to authenticated;

-- Scores --------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scores' and policyname = 'scores_insert_accessible'
  ) then
    drop policy scores_insert_accessible on public.scores;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scores' and policyname = 'scores_update_accessible'
  ) then
    drop policy scores_update_accessible on public.scores;
  end if;
end $$;

create policy scores_public_insert_temp
  on public.scores
  for insert
  to public
  with check (true);

create policy scores_public_update_temp
  on public.scores
  for update
  to public
  using (true)
  with check (true);

grant insert, update on public.scores to anon;
grant insert, update on public.scores to authenticated;

-- Heat realtime state -------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_realtime_config'
      and policyname = 'heat_realtime_config_update_accessible'
  ) then
    drop policy heat_realtime_config_update_accessible on public.heat_realtime_config;
  end if;
end $$;

create policy heat_realtime_config_public_write_temp
  on public.heat_realtime_config
  for all
  to public
  using (true)
  with check (true);

grant all on public.heat_realtime_config to anon;
grant all on public.heat_realtime_config to authenticated;

-- Heat entries (needed when advancing brackets) ------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_entries' and policyname = 'heat_entries_insert_owned'
  ) then
    drop policy heat_entries_insert_owned on public.heat_entries;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_entries' and policyname = 'heat_entries_update_accessible'
  ) then
    drop policy heat_entries_update_accessible on public.heat_entries;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heat_entries' and policyname = 'heat_entries_delete_owned'
  ) then
    drop policy heat_entries_delete_owned on public.heat_entries;
  end if;
end $$;

create policy heat_entries_public_write_temp
  on public.heat_entries
  for all
  to public
  using (true)
  with check (true);

grant select, insert, update, delete on public.heat_entries to anon;
grant select, insert, update, delete on public.heat_entries to authenticated;

-- Participants (admin still needs to import via anon key)
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_insert_owned'
  ) then
    drop policy participants_insert_owned on public.participants;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_update_owned'
  ) then
    drop policy participants_update_owned on public.participants;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_delete_owned'
  ) then
    drop policy participants_delete_owned on public.participants;
  end if;
end $$;

create policy participants_public_write_temp
  on public.participants
  for all
  to public
  using (true)
  with check (true);

grant all on public.participants to anon;
grant all on public.participants to authenticated;

commit;

-- Reminder: this script is intentionally permissive. Revert once judge auth exists.
