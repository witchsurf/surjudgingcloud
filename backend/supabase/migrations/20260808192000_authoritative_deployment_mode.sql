begin;

create table if not exists public.app_deployment_config (
  id boolean primary key default true check (id),
  deployment_mode text not null check (deployment_mode in ('cloud', 'field')),
  provisioned_at timestamptz not null default now(),
  constraint app_deployment_config_singleton check (id = true)
);

alter table public.app_deployment_config enable row level security;
revoke all on table public.app_deployment_config from public, anon, authenticated;

-- A migration is safe to apply to Cloud without environment inference. Field
-- provisioning changes this singleton explicitly as a PostgreSQL administrator.
insert into public.app_deployment_config (id, deployment_mode)
values (true, 'cloud')
on conflict (id) do nothing;

create or replace function public.get_authoritative_deployment_mode()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select deployment_mode into v_mode
    from public.app_deployment_config
   where id = true;
  if v_mode not in ('cloud', 'field') then
    raise exception using errcode = '55000', message = 'DEPLOYMENT_MODE_NOT_PROVISIONED';
  end if;
  return v_mode;
end;
$$;

alter function public.get_authoritative_deployment_mode() owner to postgres;
revoke all on function public.get_authoritative_deployment_mode() from public, anon, authenticated;
grant execute on function public.get_authoritative_deployment_mode() to anon, authenticated;

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
  id bigint, name text, organizer text, start_date date, end_date date,
  price integer, currency text, method text, status text, paid boolean,
  paid_at timestamptz, payment_ref text, categories jsonb, judges jsonb,
  user_id uuid, created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := public.get_authoritative_deployment_mode();
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

  if v_mode = 'cloud' then
    if v_user_id is null then
      raise exception using errcode = '42501', message = 'CLOUD_AUTH_REQUIRED';
    end if;
    if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
      raise exception using errcode = '42501', message = 'CLOUD_ANONYMOUS_FORBIDDEN';
    end if;
  elsif v_mode = 'field' then
    v_user_id := null;
  else
    raise exception using errcode = '55000', message = 'DEPLOYMENT_MODE_NOT_PROVISIONED';
  end if;

  select exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) into v_has_owner_id;

  if v_has_owner_id then
    return query execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref,
        categories, judges, user_id, owner_id
      ) values ($1,$2,$3,$4,$5,$6,null,'pending',false,null,null,$7,$8,$9,$9)
      returning id,name,organizer,start_date,end_date,price,currency,
                method,status,paid,paid_at,payment_ref,categories,judges,user_id,created_at
    $sql$ using btrim(p_name), btrim(p_organizer), p_start_date, p_end_date,
      p_price, upper(btrim(p_currency)), coalesce(p_categories, '[]'::jsonb),
      coalesce(p_judges, '[]'::jsonb), v_user_id;
  else
    return query execute $sql$
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref, categories, judges, user_id
      ) values ($1,$2,$3,$4,$5,$6,null,'pending',false,null,null,$7,$8,$9)
      returning id,name,organizer,start_date,end_date,price,currency,
                method,status,paid,paid_at,payment_ref,categories,judges,user_id,created_at
    $sql$ using btrim(p_name), btrim(p_organizer), p_start_date, p_end_date,
      p_price, upper(btrim(p_currency)), coalesce(p_categories, '[]'::jsonb),
      coalesce(p_judges, '[]'::jsonb), v_user_id;
  end if;
end;
$$;

alter function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb) owner to postgres;
revoke all on function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb) from public;
grant execute on function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb) to anon, authenticated;

-- Replace the temporary Host-based Field read policy with the same
-- authoritative singleton. The getter executes as postgres.
drop policy if exists events_read_local_field on public.events;
create policy events_read_authoritative_field
on public.events for select to anon, authenticated
using (public.get_authoritative_deployment_mode() = 'field');

commit;
