begin;

-- Cloud does not historically expose is_local_database(), while Field does.
-- Keep this migration self-contained and fail closed for missing/malformed
-- request headers. Only loopback/private-LAN hosts are trusted as Field.
create or replace function public.event_creation_is_local_database()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers jsonb;
  v_host text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return false;
  end;
  if v_headers is null then return false; end if;
  v_host := lower(split_part(coalesce(v_headers ->> 'host', ''), ':', 1));
  return v_host in ('localhost', '127.0.0.1', '::1', 'priority.local')
      or v_host like '10.%'
      or v_host like '192.168.%'
      or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.';
end;
$$;

alter function public.event_creation_is_local_database() owner to postgres;
revoke all on function public.event_creation_is_local_database() from public;
grant execute on function public.event_creation_is_local_database() to anon;
grant execute on function public.event_creation_is_local_database() to authenticated;

create or replace function public.create_event_secure(
  p_name text,
  p_organizer text,
  p_start_date date,
  p_end_date date,
  p_price integer default 0,
  p_currency text default 'XOF',
  p_categories jsonb default '[]'::jsonb,
  p_judges jsonb default '[]'::jsonb
)
returns table (
  id bigint,
  name text,
  organizer text,
  start_date date,
  end_date date,
  price integer,
  currency text,
  method text,
  status text,
  paid boolean,
  paid_at timestamptz,
  payment_ref text,
  categories jsonb,
  judges jsonb,
  user_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_local boolean := public.event_creation_is_local_database();
  v_user_id uuid := auth.uid();
  v_has_owner_id boolean;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'EVENT_NAME_REQUIRED';
  end if;
  if nullif(btrim(p_organizer), '') is null then
    raise exception using errcode = '22023', message = 'EVENT_ORGANIZER_REQUIRED';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'EVENT_DATES_INVALID';
  end if;
  if p_price is null or p_price < 0 then
    raise exception using errcode = '22023', message = 'EVENT_PRICE_INVALID';
  end if;
  if nullif(btrim(p_currency), '') is null then
    raise exception using errcode = '22023', message = 'EVENT_CURRENCY_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_categories, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_judges, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'EVENT_METADATA_INVALID';
  end if;

  if not v_is_local then
    if v_user_id is null then
      raise exception using errcode = '42501', message = 'CLOUD_AUTH_REQUIRED';
    end if;
    if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
      raise exception using errcode = '42501', message = 'CLOUD_ANONYMOUS_FORBIDDEN';
    end if;
  else
    -- Field is a trusted operator installation on its local LAN. No Cloud
    -- identity is invented; nullable ownership columns remain NULL.
    v_user_id := null;
  end if;

  select exists (
    select 1
      from pg_catalog.pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id'
       and not attisdropped
  ) into v_has_owner_id;

  if v_has_owner_id then
    return query execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref,
        categories, judges, user_id, owner_id
      ) values (
        $1, $2, $3, $4, $5, $6,
        null, 'pending', false, null, null,
        $7, $8, $9, $9
      )
      returning id, name, organizer, start_date, end_date, price, currency,
                method, status, paid, paid_at, payment_ref,
                categories, judges, user_id, created_at
    $sql$ using
      btrim(p_name), btrim(p_organizer), p_start_date, p_end_date,
      p_price, upper(btrim(p_currency)),
      coalesce(p_categories, '[]'::jsonb), coalesce(p_judges, '[]'::jsonb), v_user_id;
  else
    return query execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref,
        categories, judges, user_id
      ) values (
        $1, $2, $3, $4, $5, $6,
        null, 'pending', false, null, null,
        $7, $8, $9
      )
      returning id, name, organizer, start_date, end_date, price, currency,
                method, status, paid, paid_at, payment_ref,
                categories, judges, user_id, created_at
    $sql$ using
      btrim(p_name), btrim(p_organizer), p_start_date, p_end_date,
      p_price, upper(btrim(p_currency)),
      coalesce(p_categories, '[]'::jsonb), coalesce(p_judges, '[]'::jsonb), v_user_id;
  end if;
end;
$$;

alter function public.create_event_secure(text, text, date, date, integer, text, jsonb, jsonb) owner to postgres;
revoke all on function public.create_event_secure(text, text, date, date, integer, text, jsonb, jsonb) from public;
grant execute on function public.create_event_secure(text, text, date, date, integer, text, jsonb, jsonb) to anon;
grant execute on function public.create_event_secure(text, text, date, date, integer, text, jsonb, jsonb) to authenticated;

-- Existing Field screens read the event after creation. Keep writes behind the
-- SECURITY DEFINER RPC, while exposing only the SELECT privilege already
-- constrained by the environment-specific RLS policies.
grant select on table public.events to anon;
grant select on table public.events to authenticated;

drop policy if exists events_read_local_field on public.events;
create policy events_read_local_field
on public.events
for select
to anon, authenticated
using (public.event_creation_is_local_database());

commit;
