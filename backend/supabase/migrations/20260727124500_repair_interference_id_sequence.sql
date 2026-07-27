begin;

do $$
declare
  v_sequence text;
  v_max_id bigint;
begin
  v_sequence := pg_get_serial_sequence('public.interference_calls', 'id');
  if v_sequence is not null then
    select coalesce(max(id), 0) into v_max_id from public.interference_calls;
    if v_max_id = 0 then
      perform setval(v_sequence, 1, false);
    else
      perform setval(v_sequence, v_max_id, true);
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.app_runtime_schema_version') is not null then
    insert into public.app_runtime_schema_version (id, schema_version, updated_at)
    values (true, '20260727124500_repair_interference_id_sequence', now())
    on conflict (id) do update
      set schema_version = excluded.schema_version,
          updated_at = excluded.updated_at;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
