begin;

-- PostgREST/Kong can forward its Docker service hostname rather than the
-- browser-facing LAN IP. Match the historical Field boundary: Supabase
-- platform API hosts are Cloud, while another non-empty HTTP host belongs to
-- the operator-controlled local stack. Missing/malformed headers fail closed.
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
  if v_host = '' then return false; end if;
  return not (v_host like '%.supabase.co' or v_host like '%.supabase.net');
end;
$$;

alter function public.event_creation_is_local_database() owner to postgres;
revoke all on function public.event_creation_is_local_database() from public;
grant execute on function public.event_creation_is_local_database() to anon;
grant execute on function public.event_creation_is_local_database() to authenticated;

commit;
