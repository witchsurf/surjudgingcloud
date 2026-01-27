-- surfjudging.cloud Supabase policies
-- Run these statements in the SQL editor for project xwaymumbkmwxqifihuvn
-- (SQL tab). They assume you are using the anonymous key from the web app.

-----------------------------
-- Global grants / schema usage
-----------------------------
grant usage on schema public to anon;
grant select on all tables in schema public to anon;
grant select on all sequences in schema public to anon;

alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select on sequences to anon;

-----------------------------
-- score_overrides
-----------------------------
alter table public.score_overrides enable row level security;

drop policy if exists "anon_select_score_overrides" on public.score_overrides;
create policy "anon_select_score_overrides"
on public.score_overrides
for select to public
using (true);

drop policy if exists "anon_insert_score_overrides" on public.score_overrides;
create policy "anon_insert_score_overrides"
on public.score_overrides
for insert to public
with check (true);

drop policy if exists "anon_update_score_overrides" on public.score_overrides;
create policy "anon_update_score_overrides"
on public.score_overrides
for update to public
using (true)
with check (true);

-----------------------------
-- heat_configs
-----------------------------
alter table public.heat_configs enable row level security;

drop policy if exists "heat_configs_read_public" on public.heat_configs;
create policy "heat_configs_read_public"
on public.heat_configs
for select to public
using (true);

drop policy if exists "heat_configs_insert_authenticated" on public.heat_configs;
create policy "heat_configs_insert_authenticated"
on public.heat_configs
for insert to authenticated
with check (true);

drop policy if exists "heat_configs_update_authenticated" on public.heat_configs;
create policy "heat_configs_update_authenticated"
on public.heat_configs
for update to authenticated
using (true)
with check (true);

-----------------------------
-- heat_timers
-----------------------------
alter table public.heat_timers enable row level security;

drop policy if exists "anon_select_heat_timers" on public.heat_timers;
create policy "anon_select_heat_timers"
on public.heat_timers
for select to public
using (true);

drop policy if exists "heat_timers_insert_authenticated" on public.heat_timers;
create policy "heat_timers_insert_authenticated"
on public.heat_timers
for insert to authenticated
with check (true);

drop policy if exists "heat_timers_update_authenticated" on public.heat_timers;
create policy "heat_timers_update_authenticated"
on public.heat_timers
for update to authenticated
using (true)
with check (true);

-----------------------------
-- heat_realtime_config
-----------------------------
alter table public.heat_realtime_config enable row level security;

drop policy if exists "Users can view heat realtime config" on public.heat_realtime_config;
create policy "Users can view heat realtime config"
on public.heat_realtime_config
for select to public
using (true);

drop policy if exists "Authenticated users can insert heat realtime config" on public.heat_realtime_config;
create policy "Authenticated users can insert heat realtime config"
on public.heat_realtime_config
for insert to authenticated
with check (true);

drop policy if exists "Authenticated users can update heat realtime config" on public.heat_realtime_config;
create policy "Authenticated users can update heat realtime config"
on public.heat_realtime_config
for update to authenticated
using (true)
with check (true);

-----------------------------
-- active_heat_pointer
-----------------------------
alter table public.active_heat_pointer enable row level security;

drop policy if exists "anon_upsert_active_heat_pointer" on public.active_heat_pointer;
create policy "anon_upsert_active_heat_pointer"
on public.active_heat_pointer
for all to public
using (true)
with check (true);


-----------------------------
-- heats
-----------------------------
alter table public.heats enable row level security;

drop policy if exists "heats_read_public" on public.heats;
create policy "heats_read_public"
on public.heats
for select to public
using (true);

drop policy if exists "heats_insert_authenticated_manageable" on public.heats;
create policy "heats_insert_authenticated_manageable"
on public.heats
for insert to authenticated
with check (event_id is null or public.user_has_event_access(event_id));

drop policy if exists "heats_update_authenticated_manageable" on public.heats;
create policy "heats_update_authenticated_manageable"
on public.heats
for update to authenticated
using (event_id is null or public.user_has_event_access(event_id))
with check (event_id is null or public.user_has_event_access(event_id));

-----------------------------
-- Support tables used in policies
-----------------------------
-- Ensure anon can at least read heats/participants/heat_entries
alter table public.heats enable row level security;
-- (policies defined above)

alter table public.participants enable row level security;
drop policy if exists "participants_read_public" on public.participants;
create policy "participants_read_public"
on public.participants
for select to public
using (true);

alter table public.heat_entries enable row level security;
drop policy if exists "heat_entries_read_public" on public.heat_entries;
create policy "heat_entries_read_public"
on public.heat_entries
for select to public
using (true);
