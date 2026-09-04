begin;

-- A request key belongs to a single operator submission.  Retrying the same
-- request after a lost HTTP response must return its original event, never
-- attempt a second INSERT.
create table if not exists public.event_creation_requests (
  request_id uuid primary key,
  event_id bigint unique references public.events(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint event_creation_requests_event_required check (event_id is not null)
);

alter table public.event_creation_requests enable row level security;
revoke all on table public.event_creation_requests from public, anon, authenticated;

create or replace function public.create_event_secure(
  p_name text,
  p_organizer text,
  p_start_date date,
  p_end_date date,
  p_price integer,
  p_currency text,
  p_categories jsonb,
  p_judges jsonb,
  p_idempotency_key uuid
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
  v_event_id bigint;
  v_has_owner_id boolean;
begin
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'EVENT_CREATION_REQUEST_ID_REQUIRED';
  end if;
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
    if v_user_id is null then raise exception using errcode = '42501', message = 'CLOUD_AUTH_REQUIRED'; end if;
    if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
      raise exception using errcode = '42501', message = 'CLOUD_ANONYMOUS_FORBIDDEN';
    end if;
  elsif v_mode = 'field' then
    v_user_id := null;
  else
    raise exception using errcode = '55000', message = 'DEPLOYMENT_MODE_NOT_PROVISIONED';
  end if;

  -- Serialize callers carrying the same key.  If a prior call committed,
  -- return its immutable result before evaluating the event-name uniqueness.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select request.event_id into v_event_id
    from public.event_creation_requests request
   where request.request_id = p_idempotency_key;
  if found then
    return query
      select e.id,e.name,e.organizer,e.start_date,e.end_date,e.price,e.currency,
             e.method,e.status,e.paid,e.paid_at,e.payment_ref,e.categories,e.judges,
             e.user_id,e.created_at
        from public.events e where e.id = v_event_id;
    return;
  end if;

  select exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.events'::regclass
       and attname = 'owner_id' and not attisdropped
  ) into v_has_owner_id;

  begin
    if v_has_owner_id then
      execute $sql$
        insert into public.events (
          name, organizer, start_date, end_date, price, currency,
          method, status, paid, paid_at, payment_ref, categories, judges, user_id, owner_id
        ) values ($1,$2,$3,$4,$5,$6,null,'pending',false,null,null,$7,$8,$9,$9)
        returning id
      $sql$ into v_event_id using
        btrim(p_name), btrim(p_organizer), p_start_date, p_end_date, p_price,
        upper(btrim(p_currency)), coalesce(p_categories, '[]'::jsonb),
        coalesce(p_judges, '[]'::jsonb), v_user_id;
    else
      insert into public.events (
        name, organizer, start_date, end_date, price, currency,
        method, status, paid, paid_at, payment_ref, categories, judges, user_id
      ) values (
        btrim(p_name), btrim(p_organizer), p_start_date, p_end_date, p_price,
        upper(btrim(p_currency)), null, 'pending', false, null, null,
        coalesce(p_categories, '[]'::jsonb), coalesce(p_judges, '[]'::jsonb), v_user_id
      ) returning events.id into v_event_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'EVENT_NAME_ALREADY_EXISTS';
  end;

  insert into public.event_creation_requests (request_id, event_id)
  values (p_idempotency_key, v_event_id);
  return query
    select e.id,e.name,e.organizer,e.start_date,e.end_date,e.price,e.currency,
           e.method,e.status,e.paid,e.paid_at,e.payment_ref,e.categories,e.judges,
           e.user_id,e.created_at
      from public.events e where e.id = v_event_id;
end;
$$;

-- Existing Field clients remain supported. New clients use the request-key
-- overload above; older clients retain the same validation and domain errors.
create or replace function public.create_event_secure(
  p_name text, p_organizer text, p_start_date date, p_end_date date,
  p_price integer default 0, p_currency text default 'XOF',
  p_categories jsonb default '[]'::jsonb, p_judges jsonb default '[]'::jsonb
)
returns table (
  id bigint, name text, organizer text, start_date date, end_date date,
  price integer, currency text, method text, status text, paid boolean,
  paid_at timestamptz, payment_ref text, categories jsonb, judges jsonb,
  user_id uuid, created_at timestamptz
)
language sql security definer set search_path = public, pg_temp
as $$
  select * from public.create_event_secure(
    p_name, p_organizer, p_start_date, p_end_date, p_price, p_currency,
    p_categories, p_judges, gen_random_uuid()
  );
$$;

alter function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb) owner to postgres;
alter function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb,uuid) owner to postgres;
revoke all on function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb) from public;
revoke all on function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb,uuid) from public;
grant execute on function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb) to anon, authenticated;
grant execute on function public.create_event_secure(text,text,date,date,integer,text,jsonb,jsonb,uuid) to anon, authenticated;

insert into public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
values (true, '20260901210000_idempotent_event_creation', 'Idempotent event creation', now())
on conflict (id) do update set
  schema_version = excluded.schema_version,
  schema_label = excluded.schema_label,
  updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
commit;
