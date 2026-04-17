begin;

-- Fix auth_rls_initplan warnings by evaluating auth.uid() once per statement.
drop policy if exists "Only event owners can insert heat_realtime_config" on public.heat_realtime_config;
create policy "Only event owners can insert heat_realtime_config"
  on public.heat_realtime_config
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.heats heat
      join public.events event on event.id = heat.event_id
      where heat.id = heat_realtime_config.heat_id
        and event.user_id = (select auth.uid())
    )
  );

drop policy if exists "Only event owners can update heat_realtime_config" on public.heat_realtime_config;
create policy "Only event owners can update heat_realtime_config"
  on public.heat_realtime_config
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.heats heat
      join public.events event on event.id = heat.event_id
      where heat.id = heat_realtime_config.heat_id
        and event.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.heats heat
      join public.events event on event.id = heat.event_id
      where heat.id = heat_realtime_config.heat_id
        and event.user_id = (select auth.uid())
    )
  );

-- Split judges read/write policies so authenticated management no longer creates
-- an extra permissive SELECT policy, while keeping public read and auth writes.
drop policy if exists "Authenticated users can manage judges" on public.judges;
drop policy if exists "Active judges are viewable by everyone" on public.judges;
drop policy if exists "Authenticated users can view all judges" on public.judges;
drop policy if exists "Authenticated users can insert judges" on public.judges;
drop policy if exists "Authenticated users can update judges" on public.judges;
drop policy if exists "Authenticated users can delete judges" on public.judges;

create policy "Active judges are viewable by everyone"
  on public.judges
  for select
  to anon
  using (active = true);

create policy "Authenticated users can view all judges"
  on public.judges
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert judges"
  on public.judges
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update judges"
  on public.judges
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete judges"
  on public.judges
  for delete
  to authenticated
  using (true);

-- Remove the duplicate single-column heat_entries index and keep the older
-- heat_entries_heat_id_idx in place.
drop index if exists public.idx_heat_entries_heat_id;

commit;
