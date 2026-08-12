begin;

grant execute on function public.upsert_heat_config_runtime(
  text,
  text[],
  text[],
  jsonb,
  integer,
  text
) to anon;

commit;
