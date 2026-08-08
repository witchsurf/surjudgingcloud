begin;

-- Planning must never activate a heat. The runtime default remains unchanged
-- because legacy createHeat semantics require a separate characterization.
create or replace function public.bulk_upsert_heats_safe(
  p_event_id bigint,
  p_category text,
  p_overwrite boolean default false,
  p_heats jsonb default '[]'::jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_mappings jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposed_heat_ids text[];
  v_target_heat_ids text[];
  v_blocked jsonb;
begin
  if p_event_id is null then raise exception 'event_id is required'; end if;
  if nullif(p_category, '') is null then raise exception 'category is required'; end if;
  if jsonb_typeof(coalesce(p_heats, '[]'::jsonb)) <> 'array' then raise exception 'heats payload must be an array'; end if;

  select coalesce(array_agg(payload.id order by payload.id), '{}'::text[])
    into v_proposed_heat_ids
  from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb))
    as payload(id text, event_id bigint, division text, is_active boolean)
  where payload.id is not null;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb))
      as payload(id text, event_id bigint, division text, is_active boolean)
    where payload.id is null
       or payload.event_id is distinct from p_event_id
       or payload.division is distinct from p_category
       or payload.is_active is distinct from false
  ) then
    raise exception 'heat payload event/category/is_active mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || length(p_category)::text || ':' || p_category, 0));
  perform 1
  from public.heats h
  where h.event_id = p_event_id
    and h.division = p_category
    and (coalesce(p_overwrite, false) or h.id = any(v_proposed_heat_ids))
  for update;
  lock table public.scores, public.score_overrides, public.interference_calls,
    public.heat_judge_assignments, public.heat_timers, public.heat_history,
    public.active_heat_pointer in share row exclusive mode;

  select coalesce(array_agg(inventory.heat_id order by inventory.heat_id), '{}'::text[]),
         jsonb_agg(to_jsonb(inventory) order by inventory.heat_id)
           filter (where cardinality(inventory.blocker_reasons) > 0)
    into v_target_heat_ids, v_blocked
  from public.get_heat_planning_safety_inventory(
    p_event_id,
    p_category,
    v_proposed_heat_ids,
    p_overwrite
  ) inventory;

  if v_blocked is not null then
    raise exception using
      errcode = 'P0001',
      message = 'HEAT_PLANNING_BLOCKED',
      detail = v_blocked::text;
  end if;

  perform public.bulk_upsert_heats(
    coalesce(p_heats, '[]'::jsonb),
    coalesce(p_entries, '[]'::jsonb),
    coalesce(p_mappings, '[]'::jsonb),
    coalesce(p_participants, '[]'::jsonb),
    v_target_heat_ids
  );

  -- bulk_upsert_heats is retained unchanged for rollback and ignores the new
  -- field. Preserve the explicit safe payload atomically before commit.
  update public.heats heat
     set is_active = false
    from jsonb_to_recordset(coalesce(p_heats, '[]'::jsonb)) as payload(id text, is_active boolean)
   where heat.id = payload.id
     and payload.is_active = false;
end;
$$;

revoke all on function public.bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

comment on function public.bulk_upsert_heats_safe(bigint, text, boolean, jsonb, jsonb, jsonb, jsonb) is
  'Atomic planning wrapper. Requires and preserves is_active=false; activation remains lifecycle-only.';

commit;
