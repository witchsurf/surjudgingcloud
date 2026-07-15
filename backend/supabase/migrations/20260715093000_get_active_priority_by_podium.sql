begin;

drop function if exists public.get_active_priority(bigint, text);
drop function if exists public.get_active_priority(text);

create or replace function public.get_active_priority(
    p_event_id bigint,
    p_podium_id text default 'A'
)
returns table (
    heat_id text,
    status text,
    priority_state jsonb,
    surfers jsonb,
    timer_remaining_seconds integer
)
language sql
security definer
stable
set search_path = public
as $$
    select
        hrc.heat_id::text,
        hrc.status::text,
        hrc.config_data->'priorityState' as priority_state,
        hrc.config_data->'surfers' as surfers,
        case
            when ht.is_running and ht.start_time is not null then
                greatest(0,
                    (ht.duration_minutes * 60)
                    - extract(epoch from (now() - ht.start_time))::integer
                )
            else null
        end as timer_remaining_seconds
    from public.active_heat_pointer ahp
    join public.heat_realtime_config hrc
      on hrc.heat_id = ahp.active_heat_id
    left join public.heat_timers ht
      on ht.heat_id = hrc.heat_id
    where ahp.event_id = p_event_id
      and upper(trim(coalesce(ahp.podium_id, 'A'))) = upper(trim(coalesce(p_podium_id, 'A')))
    order by ahp.updated_at desc
    limit 1;
$$;

create or replace function public.get_active_priority(
    p_podium_id text
)
returns table (
    heat_id text,
    status text,
    priority_state jsonb,
    surfers jsonb,
    timer_remaining_seconds integer
)
language sql
security definer
stable
set search_path = public
as $$
    select
        hrc.heat_id::text,
        hrc.status::text,
        hrc.config_data->'priorityState' as priority_state,
        hrc.config_data->'surfers' as surfers,
        case
            when ht.is_running and ht.start_time is not null then
                greatest(0,
                    (ht.duration_minutes * 60)
                    - extract(epoch from (now() - ht.start_time))::integer
                )
            else null
        end as timer_remaining_seconds
    from public.active_heat_pointer ahp
    join public.heat_realtime_config hrc
      on hrc.heat_id = ahp.active_heat_id
    left join public.heat_timers ht
      on ht.heat_id = hrc.heat_id
    where upper(trim(coalesce(ahp.podium_id, 'A'))) = upper(trim(coalesce(p_podium_id, 'A')))
    order by ahp.updated_at desc
    limit 1;
$$;

create or replace function public.get_active_priority()
returns table (
    heat_id text,
    status text,
    priority_state jsonb,
    surfers jsonb,
    timer_remaining_seconds integer
)
language sql
security definer
stable
set search_path = public
as $$
    select
        hrc.heat_id::text,
        hrc.status::text,
        hrc.config_data->'priorityState' as priority_state,
        hrc.config_data->'surfers' as surfers,
        case
            when ht.is_running and ht.start_time is not null then
                greatest(0,
                    (ht.duration_minutes * 60)
                    - extract(epoch from (now() - ht.start_time))::integer
                )
            else null
        end as timer_remaining_seconds
    from public.heat_realtime_config hrc
    left join public.heat_timers ht
      on ht.heat_id = hrc.heat_id
    order by hrc.updated_at desc
    limit 1;
$$;

grant execute on function public.get_active_priority(bigint, text) to anon;
grant execute on function public.get_active_priority(bigint, text) to authenticated;
grant execute on function public.get_active_priority(bigint, text) to service_role;

grant execute on function public.get_active_priority(text) to anon;
grant execute on function public.get_active_priority(text) to authenticated;
grant execute on function public.get_active_priority(text) to service_role;

grant execute on function public.get_active_priority() to anon;
grant execute on function public.get_active_priority() to authenticated;
grant execute on function public.get_active_priority() to service_role;

commit;
