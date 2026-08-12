begin;

drop policy if exists participants_insert_authoritative_field on public.participants;
create policy participants_insert_authoritative_field
on public.participants
for insert
to anon, authenticated
with check (
  public.get_authoritative_deployment_mode() = 'field'
);

drop policy if exists participants_update_authoritative_field on public.participants;
create policy participants_update_authoritative_field
on public.participants
for update
to anon, authenticated
using (
  public.get_authoritative_deployment_mode() = 'field'
)
with check (
  public.get_authoritative_deployment_mode() = 'field'
);

drop policy if exists participants_delete_authoritative_field on public.participants;
create policy participants_delete_authoritative_field
on public.participants
for delete
to anon, authenticated
using (
  public.get_authoritative_deployment_mode() = 'field'
);

commit;
