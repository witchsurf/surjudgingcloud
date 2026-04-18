begin;

alter table public.heat_realtime_config
  drop constraint if exists heat_realtime_config_status_check;

alter table public.heat_realtime_config
  add constraint heat_realtime_config_status_check
  check (status in ('waiting', 'running', 'paused', 'finished', 'closed', 'open'));

commit;
