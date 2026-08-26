-- Disposable Field DB characterization for 20260826150000_field_live_outbox_foundation.
-- Run only after the migration on an isolated Field database.
begin;

do $$
declare
  v_pending integer;
  v_claimed integer;
begin
  if not public.is_local_database() then
    raise exception 'This test must run against a Field database';
  end if;

  if to_regclass('public.live_outbox') is null then
    raise exception 'live_outbox is missing';
  end if;

  select count(*) into v_pending
  from public.live_outbox
  where status = 'pending';

  select count(*) into v_claimed
  from public.claim_live_outbox('outbox-test-worker', 1);

  if v_claimed > 1 then
    raise exception 'claim limit ignored: % rows', v_claimed;
  end if;

  if exists (
    select 1 from public.live_outbox
    where status = 'sending' and locked_by = 'outbox-test-worker'
  ) then
    perform public.fail_live_outbox(
      'outbox-test-worker',
      array(select id from public.live_outbox where status = 'sending' and locked_by = 'outbox-test-worker'),
      'test cleanup', 1
    );
  end if;

  raise notice 'Field live outbox foundation PASS: pending_before=% claimed=%', v_pending, v_claimed;
end $$;

rollback;
