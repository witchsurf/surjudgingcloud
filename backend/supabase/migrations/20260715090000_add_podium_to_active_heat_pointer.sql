begin;

alter table public.active_heat_pointer
  add column if not exists podium_id text not null default 'A';

update public.active_heat_pointer
   set podium_id = 'A'
 where nullif(trim(coalesce(podium_id, '')), '') is null;

alter table public.active_heat_pointer
  alter column podium_id set default 'A';

alter table public.active_heat_pointer
  drop constraint if exists active_heat_pointer_event_id_key;

alter table public.active_heat_pointer
  drop constraint if exists active_heat_pointer_pkey;

drop index if exists public.idx_active_heat_pointer_event_id_unique;
drop index if exists public.active_heat_pointer_pkey;

create unique index if not exists idx_active_heat_pointer_event_podium_unique
  on public.active_heat_pointer(event_id, podium_id)
  ;

create unique index if not exists idx_active_heat_pointer_name_podium_unique
  on public.active_heat_pointer(lower(trim(event_name)), podium_id)
  where event_id is null;

drop function if exists public.upsert_active_heat_pointer(bigint, text, text, timestamptz, text);

create or replace function public.upsert_active_heat_pointer(
  p_event_id bigint default null,
  p_event_name text default null,
  p_active_heat_id text default null,
  p_updated_at timestamptz default now(),
  p_podium_id text default 'A'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_name text := nullif(trim(coalesce(p_event_name, '')), '');
  v_active_heat_id text := nullif(trim(coalesce(p_active_heat_id, '')), '');
  v_podium_id text := upper(nullif(trim(coalesce(p_podium_id, '')), ''));
begin
  if v_active_heat_id is null then
    raise exception 'active_heat_id is required';
  end if;

  v_podium_id := coalesce(v_podium_id, 'A');

  if p_event_id is not null then
    update public.active_heat_pointer
       set event_id = p_event_id,
           event_name = coalesce(v_event_name, event_name),
           podium_id = v_podium_id,
           active_heat_id = v_active_heat_id,
           updated_at = coalesce(p_updated_at, now())
     where event_id = p_event_id
       and podium_id = v_podium_id;

    if found then
      return;
    end if;
  end if;

  if v_event_name is not null then
    update public.active_heat_pointer
       set event_id = coalesce(p_event_id, event_id),
           event_name = v_event_name,
           podium_id = v_podium_id,
           active_heat_id = v_active_heat_id,
           updated_at = coalesce(p_updated_at, now())
     where lower(trim(event_name)) = lower(trim(v_event_name))
       and podium_id = v_podium_id;

    if found then
      return;
    end if;
  end if;

  insert into public.active_heat_pointer (
    event_id,
    event_name,
    podium_id,
    active_heat_id,
    updated_at
  )
  values (
    p_event_id,
    coalesce(v_event_name, ''),
    v_podium_id,
    v_active_heat_id,
    coalesce(p_updated_at, now())
  );
end;
$$;

create or replace function public.upsert_active_heat_pointer(
  p_event_id bigint default null,
  p_event_name text default null,
  p_active_heat_id text default null,
  p_updated_at timestamptz default now()
) returns void
language sql
security definer
set search_path = public
as $$
  select public.upsert_active_heat_pointer(
    p_event_id,
    p_event_name,
    p_active_heat_id,
    p_updated_at,
    'A'
  );
$$;

grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz, text) to anon;
grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz, text) to authenticated;
grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz, text) to service_role;

grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz) to anon;
grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz) to authenticated;
grant execute on function public.upsert_active_heat_pointer(bigint, text, text, timestamptz) to service_role;

commit;
