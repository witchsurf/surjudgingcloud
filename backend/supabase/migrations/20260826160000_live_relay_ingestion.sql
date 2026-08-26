-- Cloud-side receipt and projection store for the Field live relay.
-- No public policy is granted here; Edge Functions use service_role internally.
begin;

create table if not exists public.live_ingest_events (
  field_instance_id text not null,
  outbox_id uuid not null,
  sequence bigint not null,
  event_id bigint not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  schema_version integer not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  primary key (field_instance_id, outbox_id),
  unique (field_instance_id, sequence)
);

create table if not exists public.live_ingest_cursor (
  field_instance_id text primary key,
  last_sequence bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.live_public_projection (
  field_instance_id text not null,
  event_id bigint not null,
  aggregate_type text not null,
  aggregate_id text not null,
  sequence bigint not null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (field_instance_id, event_id, aggregate_type, aggregate_id)
);

revoke all on table public.live_ingest_events, public.live_ingest_cursor, public.live_public_projection from anon, authenticated;
commit;
