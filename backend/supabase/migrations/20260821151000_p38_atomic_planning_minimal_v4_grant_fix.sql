begin;
revoke all on function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.bulk_upsert_planning_safe_v4(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
commit;
