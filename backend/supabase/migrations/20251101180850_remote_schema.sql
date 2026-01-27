drop trigger if exists "set_events_user_id_before_insert" on "public"."events";

drop trigger if exists "update_heat_realtime_config_updated_at" on "public"."heat_realtime_config";

drop policy "public_insert_events" on "public"."events";

drop policy "read_own_or_paid_events" on "public"."events";

drop policy "Allow public insert on heat_configs" on "public"."heat_configs";

drop policy "Allow public update on heat_configs" on "public"."heat_configs";

drop policy "heat_entries_update" on "public"."heat_entries";

drop policy "Allow public read access on heat_realtime_config" on "public"."heat_realtime_config";

drop policy "Allow public write access on heat_realtime_config" on "public"."heat_realtime_config";

drop policy "heat_slot_mappings_update" on "public"."heat_slot_mappings";

drop policy "Allow public insert on heat_timers" on "public"."heat_timers";

drop policy "Allow public update on heat_timers" on "public"."heat_timers";

drop policy "Allow public insert on heats" on "public"."heats";

drop policy "Allow public update on heats" on "public"."heats";

drop policy "participants_delete" on "public"."participants";

drop policy "participants_insert" on "public"."participants";

drop policy "participants_update" on "public"."participants";

drop policy "Allow public insert on score_overrides" on "public"."score_overrides";

drop policy "Allow public insert on scores" on "public"."scores";

drop policy "Allow public update on scores" on "public"."scores";

drop policy "insert_own_events" on "public"."events";

drop policy "update_own_events" on "public"."events";

drop policy "heat_entries_delete" on "public"."heat_entries";

drop policy "heat_entries_insert" on "public"."heat_entries";

drop policy "heat_entries_select" on "public"."heat_entries";

drop policy "heat_slot_mappings_delete" on "public"."heat_slot_mappings";

drop policy "heat_slot_mappings_insert" on "public"."heat_slot_mappings";

drop policy "heat_slot_mappings_select" on "public"."heat_slot_mappings";

drop policy "participants_select" on "public"."participants";

drop policy "read_own_payments" on "public"."payments";

revoke delete on table "public"."events" from "anon";

revoke insert on table "public"."events" from "anon";

revoke references on table "public"."events" from "anon";

revoke select on table "public"."events" from "anon";

revoke trigger on table "public"."events" from "anon";

revoke truncate on table "public"."events" from "anon";

revoke update on table "public"."events" from "anon";

revoke delete on table "public"."events" from "authenticated";

revoke insert on table "public"."events" from "authenticated";

revoke references on table "public"."events" from "authenticated";

revoke select on table "public"."events" from "authenticated";

revoke trigger on table "public"."events" from "authenticated";

revoke truncate on table "public"."events" from "authenticated";

revoke update on table "public"."events" from "authenticated";

revoke delete on table "public"."events" from "service_role";

revoke insert on table "public"."events" from "service_role";

revoke references on table "public"."events" from "service_role";

revoke select on table "public"."events" from "service_role";

revoke trigger on table "public"."events" from "service_role";

revoke truncate on table "public"."events" from "service_role";

revoke update on table "public"."events" from "service_role";

revoke delete on table "public"."heat_configs" from "anon";

revoke insert on table "public"."heat_configs" from "anon";

revoke references on table "public"."heat_configs" from "anon";

revoke select on table "public"."heat_configs" from "anon";

revoke trigger on table "public"."heat_configs" from "anon";

revoke truncate on table "public"."heat_configs" from "anon";

revoke update on table "public"."heat_configs" from "anon";

revoke delete on table "public"."heat_configs" from "authenticated";

revoke insert on table "public"."heat_configs" from "authenticated";

revoke references on table "public"."heat_configs" from "authenticated";

revoke select on table "public"."heat_configs" from "authenticated";

revoke trigger on table "public"."heat_configs" from "authenticated";

revoke truncate on table "public"."heat_configs" from "authenticated";

revoke update on table "public"."heat_configs" from "authenticated";

revoke delete on table "public"."heat_configs" from "service_role";

revoke insert on table "public"."heat_configs" from "service_role";

revoke references on table "public"."heat_configs" from "service_role";

revoke select on table "public"."heat_configs" from "service_role";

revoke trigger on table "public"."heat_configs" from "service_role";

revoke truncate on table "public"."heat_configs" from "service_role";

revoke update on table "public"."heat_configs" from "service_role";

revoke delete on table "public"."heat_entries" from "anon";

revoke insert on table "public"."heat_entries" from "anon";

revoke references on table "public"."heat_entries" from "anon";

revoke select on table "public"."heat_entries" from "anon";

revoke trigger on table "public"."heat_entries" from "anon";

revoke truncate on table "public"."heat_entries" from "anon";

revoke update on table "public"."heat_entries" from "anon";

revoke delete on table "public"."heat_entries" from "authenticated";

revoke insert on table "public"."heat_entries" from "authenticated";

revoke references on table "public"."heat_entries" from "authenticated";

revoke select on table "public"."heat_entries" from "authenticated";

revoke trigger on table "public"."heat_entries" from "authenticated";

revoke truncate on table "public"."heat_entries" from "authenticated";

revoke update on table "public"."heat_entries" from "authenticated";

revoke delete on table "public"."heat_entries" from "service_role";

revoke insert on table "public"."heat_entries" from "service_role";

revoke references on table "public"."heat_entries" from "service_role";

revoke select on table "public"."heat_entries" from "service_role";

revoke trigger on table "public"."heat_entries" from "service_role";

revoke truncate on table "public"."heat_entries" from "service_role";

revoke update on table "public"."heat_entries" from "service_role";

revoke delete on table "public"."heat_realtime_config" from "anon";

revoke insert on table "public"."heat_realtime_config" from "anon";

revoke references on table "public"."heat_realtime_config" from "anon";

revoke select on table "public"."heat_realtime_config" from "anon";

revoke trigger on table "public"."heat_realtime_config" from "anon";

revoke truncate on table "public"."heat_realtime_config" from "anon";

revoke update on table "public"."heat_realtime_config" from "anon";

revoke delete on table "public"."heat_realtime_config" from "authenticated";

revoke insert on table "public"."heat_realtime_config" from "authenticated";

revoke references on table "public"."heat_realtime_config" from "authenticated";

revoke select on table "public"."heat_realtime_config" from "authenticated";

revoke trigger on table "public"."heat_realtime_config" from "authenticated";

revoke truncate on table "public"."heat_realtime_config" from "authenticated";

revoke update on table "public"."heat_realtime_config" from "authenticated";

revoke delete on table "public"."heat_realtime_config" from "service_role";

revoke insert on table "public"."heat_realtime_config" from "service_role";

revoke references on table "public"."heat_realtime_config" from "service_role";

revoke select on table "public"."heat_realtime_config" from "service_role";

revoke trigger on table "public"."heat_realtime_config" from "service_role";

revoke truncate on table "public"."heat_realtime_config" from "service_role";

revoke update on table "public"."heat_realtime_config" from "service_role";

revoke delete on table "public"."heat_slot_mappings" from "anon";

revoke insert on table "public"."heat_slot_mappings" from "anon";

revoke references on table "public"."heat_slot_mappings" from "anon";

revoke select on table "public"."heat_slot_mappings" from "anon";

revoke trigger on table "public"."heat_slot_mappings" from "anon";

revoke truncate on table "public"."heat_slot_mappings" from "anon";

revoke update on table "public"."heat_slot_mappings" from "anon";

revoke delete on table "public"."heat_slot_mappings" from "authenticated";

revoke insert on table "public"."heat_slot_mappings" from "authenticated";

revoke references on table "public"."heat_slot_mappings" from "authenticated";

revoke select on table "public"."heat_slot_mappings" from "authenticated";

revoke trigger on table "public"."heat_slot_mappings" from "authenticated";

revoke truncate on table "public"."heat_slot_mappings" from "authenticated";

revoke update on table "public"."heat_slot_mappings" from "authenticated";

revoke delete on table "public"."heat_slot_mappings" from "service_role";

revoke insert on table "public"."heat_slot_mappings" from "service_role";

revoke references on table "public"."heat_slot_mappings" from "service_role";

revoke select on table "public"."heat_slot_mappings" from "service_role";

revoke trigger on table "public"."heat_slot_mappings" from "service_role";

revoke truncate on table "public"."heat_slot_mappings" from "service_role";

revoke update on table "public"."heat_slot_mappings" from "service_role";

revoke delete on table "public"."heat_timers" from "anon";

revoke insert on table "public"."heat_timers" from "anon";

revoke references on table "public"."heat_timers" from "anon";

revoke select on table "public"."heat_timers" from "anon";

revoke trigger on table "public"."heat_timers" from "anon";

revoke truncate on table "public"."heat_timers" from "anon";

revoke update on table "public"."heat_timers" from "anon";

revoke delete on table "public"."heat_timers" from "authenticated";

revoke insert on table "public"."heat_timers" from "authenticated";

revoke references on table "public"."heat_timers" from "authenticated";

revoke select on table "public"."heat_timers" from "authenticated";

revoke trigger on table "public"."heat_timers" from "authenticated";

revoke truncate on table "public"."heat_timers" from "authenticated";

revoke update on table "public"."heat_timers" from "authenticated";

revoke delete on table "public"."heat_timers" from "service_role";

revoke insert on table "public"."heat_timers" from "service_role";

revoke references on table "public"."heat_timers" from "service_role";

revoke select on table "public"."heat_timers" from "service_role";

revoke trigger on table "public"."heat_timers" from "service_role";

revoke truncate on table "public"."heat_timers" from "service_role";

revoke update on table "public"."heat_timers" from "service_role";

revoke delete on table "public"."heats" from "anon";

revoke insert on table "public"."heats" from "anon";

revoke references on table "public"."heats" from "anon";

revoke select on table "public"."heats" from "anon";

revoke trigger on table "public"."heats" from "anon";

revoke truncate on table "public"."heats" from "anon";

revoke update on table "public"."heats" from "anon";

revoke delete on table "public"."heats" from "authenticated";

revoke insert on table "public"."heats" from "authenticated";

revoke references on table "public"."heats" from "authenticated";

revoke select on table "public"."heats" from "authenticated";

revoke trigger on table "public"."heats" from "authenticated";

revoke truncate on table "public"."heats" from "authenticated";

revoke update on table "public"."heats" from "authenticated";

revoke delete on table "public"."heats" from "service_role";

revoke insert on table "public"."heats" from "service_role";

revoke references on table "public"."heats" from "service_role";

revoke select on table "public"."heats" from "service_role";

revoke trigger on table "public"."heats" from "service_role";

revoke truncate on table "public"."heats" from "service_role";

revoke update on table "public"."heats" from "service_role";

revoke delete on table "public"."participants" from "anon";

revoke insert on table "public"."participants" from "anon";

revoke references on table "public"."participants" from "anon";

revoke select on table "public"."participants" from "anon";

revoke trigger on table "public"."participants" from "anon";

revoke truncate on table "public"."participants" from "anon";

revoke update on table "public"."participants" from "anon";

revoke delete on table "public"."participants" from "authenticated";

revoke insert on table "public"."participants" from "authenticated";

revoke references on table "public"."participants" from "authenticated";

revoke select on table "public"."participants" from "authenticated";

revoke trigger on table "public"."participants" from "authenticated";

revoke truncate on table "public"."participants" from "authenticated";

revoke update on table "public"."participants" from "authenticated";

revoke delete on table "public"."participants" from "service_role";

revoke insert on table "public"."participants" from "service_role";

revoke references on table "public"."participants" from "service_role";

revoke select on table "public"."participants" from "service_role";

revoke trigger on table "public"."participants" from "service_role";

revoke truncate on table "public"."participants" from "service_role";

revoke update on table "public"."participants" from "service_role";

revoke delete on table "public"."payments" from "anon";

revoke insert on table "public"."payments" from "anon";

revoke references on table "public"."payments" from "anon";

revoke select on table "public"."payments" from "anon";

revoke trigger on table "public"."payments" from "anon";

revoke truncate on table "public"."payments" from "anon";

revoke update on table "public"."payments" from "anon";

revoke delete on table "public"."payments" from "authenticated";

revoke insert on table "public"."payments" from "authenticated";

revoke references on table "public"."payments" from "authenticated";

revoke select on table "public"."payments" from "authenticated";

revoke trigger on table "public"."payments" from "authenticated";

revoke truncate on table "public"."payments" from "authenticated";

revoke update on table "public"."payments" from "authenticated";

revoke delete on table "public"."payments" from "service_role";

revoke insert on table "public"."payments" from "service_role";

revoke references on table "public"."payments" from "service_role";

revoke select on table "public"."payments" from "service_role";

revoke trigger on table "public"."payments" from "service_role";

revoke truncate on table "public"."payments" from "service_role";

revoke update on table "public"."payments" from "service_role";

revoke delete on table "public"."score_overrides" from "anon";

revoke insert on table "public"."score_overrides" from "anon";

revoke references on table "public"."score_overrides" from "anon";

revoke select on table "public"."score_overrides" from "anon";

revoke trigger on table "public"."score_overrides" from "anon";

revoke truncate on table "public"."score_overrides" from "anon";

revoke update on table "public"."score_overrides" from "anon";

revoke delete on table "public"."score_overrides" from "authenticated";

revoke insert on table "public"."score_overrides" from "authenticated";

revoke references on table "public"."score_overrides" from "authenticated";

revoke select on table "public"."score_overrides" from "authenticated";

revoke trigger on table "public"."score_overrides" from "authenticated";

revoke truncate on table "public"."score_overrides" from "authenticated";

revoke update on table "public"."score_overrides" from "authenticated";

revoke delete on table "public"."score_overrides" from "service_role";

revoke insert on table "public"."score_overrides" from "service_role";

revoke references on table "public"."score_overrides" from "service_role";

revoke select on table "public"."score_overrides" from "service_role";

revoke trigger on table "public"."score_overrides" from "service_role";

revoke truncate on table "public"."score_overrides" from "service_role";

revoke update on table "public"."score_overrides" from "service_role";

revoke delete on table "public"."scores" from "anon";

revoke insert on table "public"."scores" from "anon";

revoke references on table "public"."scores" from "anon";

revoke select on table "public"."scores" from "anon";

revoke trigger on table "public"."scores" from "anon";

revoke truncate on table "public"."scores" from "anon";

revoke update on table "public"."scores" from "anon";

revoke delete on table "public"."scores" from "authenticated";

revoke insert on table "public"."scores" from "authenticated";

revoke references on table "public"."scores" from "authenticated";

revoke select on table "public"."scores" from "authenticated";

revoke trigger on table "public"."scores" from "authenticated";

revoke truncate on table "public"."scores" from "authenticated";

revoke update on table "public"."scores" from "authenticated";

revoke delete on table "public"."scores" from "service_role";

revoke insert on table "public"."scores" from "service_role";

revoke references on table "public"."scores" from "service_role";

revoke select on table "public"."scores" from "service_role";

revoke trigger on table "public"."scores" from "service_role";

revoke truncate on table "public"."scores" from "service_role";

revoke update on table "public"."scores" from "service_role";

alter table "public"."heat_realtime_config" drop constraint "heat_realtime_config_status_check";

alter table "public"."heats" drop constraint "heats_status_check";

drop function if exists "public"."set_events_user_id"();

create table "public"."active_heat_pointer" (
    "event_name" text not null,
    "active_heat_id" text,
    "updated_at" timestamp with time zone default now()
);


alter table "public"."active_heat_pointer" enable row level security;

alter table "public"."events" add column "updated_at" timestamp with time zone default now();

alter table "public"."heats" add column "is_active" boolean default true;

alter table "public"."heats" add column "updated_at" timestamp with time zone default now();

alter table "public"."participants" add column "updated_at" timestamp with time zone default now();

CREATE UNIQUE INDEX active_heat_pointer_pkey ON public.active_heat_pointer USING btree (event_name);

CREATE INDEX events_user_id_idx ON public.events USING btree (user_id);

CREATE INDEX heats_event_id_idx ON public.heats USING btree (event_id);

CREATE INDEX scores_event_id_idx ON public.scores USING btree (event_id);

alter table "public"."active_heat_pointer" add constraint "active_heat_pointer_pkey" PRIMARY KEY using index "active_heat_pointer_pkey";

alter table "public"."heat_realtime_config" add constraint "heat_realtime_config_status_check" CHECK ((status = ANY (ARRAY['waiting'::text, 'running'::text, 'paused'::text, 'finished'::text, 'closed'::text]))) not valid;

alter table "public"."heat_realtime_config" validate constraint "heat_realtime_config_status_check";

alter table "public"."heats" add constraint "heats_status_check" CHECK ((status = ANY (ARRAY['waiting'::text, 'running'::text, 'paused'::text, 'finished'::text, 'closed'::text]))) not valid;

alter table "public"."heats" validate constraint "heats_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.close_current_heat_and_open_next()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_heat RECORD;
  next_heat RECORD;
BEGIN
  -- Trouver le heat actuellement actif
  SELECT * INTO current_heat
  FROM public.heats
  WHERE status IN ('running', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1;

  IF current_heat.id IS NULL THEN
    RAISE NOTICE '⚠️ Aucun heat actif trouvé.';
    RETURN;
  END IF;

  -- Fermer le heat courant
  UPDATE public.heats
  SET status = 'finished',
      updated_at = now()
  WHERE id = current_heat.id;

  UPDATE public.heat_realtime_config
  SET status = 'finished',
      updated_at = now(),
      updated_by = current_user
  WHERE heat_id = current_heat.id;

  -- Trouver le heat suivant
  SELECT * INTO next_heat
  FROM public.heats
  WHERE status = 'waiting'
  ORDER BY created_at ASC
  LIMIT 1;

  IF next_heat.id IS NULL THEN
    RAISE NOTICE '✅ Tous les heats sont terminés.';
    RETURN;
  END IF;

  -- Démarrer le heat suivant
  UPDATE public.heats
  SET status = 'running',
      updated_at = now()
  WHERE id = next_heat.id;

  UPDATE public.heat_realtime_config
  SET status = 'running',
      updated_at = now(),
      updated_by = current_user
  WHERE heat_id = next_heat.id;

  RAISE NOTICE '🔥 Heat % fermé, Heat suivant % démarré.', current_heat.id, next_heat.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_advance_on_finished()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_heat_id text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('finished', 'closed')
     AND COALESCE(OLD.status, '') <> NEW.status
  THEN
    UPDATE public.heats
       SET status = 'closed'
     WHERE id = NEW.heat_id
       AND status <> 'closed';

    SELECT h.id
      INTO v_next_heat_id
      FROM public.heats h
     WHERE h.status IN ('waiting', 'open')
     ORDER BY h.id ASC
     LIMIT 1;

    IF v_next_heat_id IS NOT NULL THEN
      UPDATE public.heat_realtime_config
         SET status = 'waiting',
             updated_at = now(),
             updated_by = current_user
       WHERE heat_id = v_next_heat_id;

      INSERT INTO public.active_heat_pointer (event_name, active_heat_id, updated_at)
      VALUES (split_part(v_next_heat_id, '_', 1), v_next_heat_id, now())
      ON CONFLICT (event_name)
      DO UPDATE SET
        active_heat_id = EXCLUDED.active_heat_id,
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_auto_transition_all_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_name text;
  v_next_heat_id text;
BEGIN
  v_event_name := split_part(NEW.heat_id, '_', 1);

  IF NEW.status = 'finished' THEN
    UPDATE public.heats
       SET status = 'closed'
     WHERE id = NEW.heat_id;

    SELECT id INTO v_next_heat_id
    FROM public.heats
    WHERE id LIKE v_event_name || '%'
      AND status IN ('waiting', 'open')
      AND id > NEW.heat_id
    ORDER BY id ASC
    LIMIT 1;

    IF v_next_heat_id IS NOT NULL THEN
      UPDATE public.heat_realtime_config
         SET status = 'waiting',
             updated_at = now(),
             updated_by = current_user
       WHERE heat_id = v_next_heat_id;

      INSERT INTO public.active_heat_pointer (event_name, active_heat_id, updated_at)
      VALUES (v_event_name, v_next_heat_id, now())
      ON CONFLICT (event_name)
      DO UPDATE SET
        active_heat_id = EXCLUDED.active_heat_id,
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gala_ondine_auto_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_heat_id text;
BEGIN
  IF NEW.heat_id LIKE 'Gala_ONDINE%' THEN
    IF NEW.status = 'finished' THEN
      UPDATE public.heats
         SET status = 'closed'
       WHERE id = NEW.heat_id;

      SELECT id INTO v_next_heat_id
      FROM public.heats
      WHERE id LIKE 'Gala_ONDINE%'
        AND status IN ('waiting', 'open')
        AND id > NEW.heat_id
      ORDER BY id ASC
      LIMIT 1;

      IF v_next_heat_id IS NOT NULL THEN
        UPDATE public.heat_realtime_config
           SET status = 'waiting',
               updated_at = now(),
               updated_by = current_user
         WHERE heat_id = v_next_heat_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_normalize_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paused' AND OLD.status IN ('running','waiting','paused') THEN
    NEW.status := 'finished';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_close_heat_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('paused', 'finished', 'closed') THEN
    PERFORM public.close_current_heat_and_open_next();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_heat_realtime_config_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Met à jour la ligne liée dans heat_realtime_config
  UPDATE public.heat_realtime_config
  SET
    status = NEW.status,
    updated_at = now(),
    updated_by = current_user
  WHERE heat_id = NEW.id;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$
;

create policy "allow_public_read_active_heat_pointer"
on "public"."active_heat_pointer"
as permissive
for select
to public
using (true);


create policy "allow_system_write_active_heat_pointer"
on "public"."active_heat_pointer"
as permissive
for all
to public
using ((auth.role() = ANY (ARRAY['service_role'::text, 'authenticated'::text])))
with check ((auth.role() = ANY (ARRAY['service_role'::text, 'authenticated'::text])));


create policy "read_events_basic"
on "public"."events"
as permissive
for select
to public
using (true);


create policy "authenticated_insert_heat_configs"
on "public"."heat_configs"
as permissive
for insert
to authenticated
with check (true);


create policy "authenticated_update_heat_configs"
on "public"."heat_configs"
as permissive
for update
to authenticated
using (true);


create policy "authenticated_update_heat_entries"
on "public"."heat_entries"
as permissive
for update
to authenticated
using (true);


create policy "Allow unified access on heat_realtime_config"
on "public"."heat_realtime_config"
as permissive
for all
to public
using ((( SELECT auth.role() AS role) = ANY (ARRAY['anon'::text, 'authenticated'::text, 'authenticator'::text, 'dashboard_user'::text, 'cli_login_postgres'::text])))
with check (true);


create policy "allow_public_read_access"
on "public"."heat_realtime_config"
as permissive
for select
to public
using (true);


create policy "authenticated_update_heat_config"
on "public"."heat_realtime_config"
as permissive
for update
to authenticated
using (true)
with check (true);


create policy "authenticated_update_heat_slot_mappings"
on "public"."heat_slot_mappings"
as permissive
for update
to authenticated
using (true);


create policy "authenticated_insert_heat_timers"
on "public"."heat_timers"
as permissive
for insert
to authenticated
with check (true);


create policy "authenticated_update_heat_timers"
on "public"."heat_timers"
as permissive
for update
to authenticated
using (true);


create policy "authenticated_insert_heats"
on "public"."heats"
as permissive
for insert
to authenticated
with check (true);


create policy "authenticated_update_heats"
on "public"."heats"
as permissive
for update
to authenticated
using (true);


create policy "authenticated_delete_participants"
on "public"."participants"
as permissive
for delete
to authenticated
using (true);


create policy "authenticated_insert_participants"
on "public"."participants"
as permissive
for insert
to authenticated
with check (true);


create policy "authenticated_update_participants"
on "public"."participants"
as permissive
for update
to authenticated
using (true);


create policy "insert_own_payments"
on "public"."payments"
as permissive
for insert
to public
with check ((auth.uid() = user_id));


create policy "authenticated_insert_score_overrides"
on "public"."score_overrides"
as permissive
for insert
to authenticated
with check (true);


create policy "authenticated_insert_scores"
on "public"."scores"
as permissive
for insert
to authenticated
with check (true);


create policy "authenticated_update_scores"
on "public"."scores"
as permissive
for update
to authenticated
using (true);


create policy "insert_own_events"
on "public"."events"
as permissive
for insert
to authenticated
with check ((user_id = ( SELECT auth.uid() AS uid)));


create policy "update_own_events"
on "public"."events"
as permissive
for update
to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)))
with check ((auth.uid() = user_id));


create policy "heat_entries_delete"
on "public"."heat_entries"
as permissive
for delete
to public
using (true);


create policy "heat_entries_insert"
on "public"."heat_entries"
as permissive
for insert
to public
with check (true);


create policy "heat_entries_select"
on "public"."heat_entries"
as permissive
for select
to public
using (true);


create policy "heat_slot_mappings_delete"
on "public"."heat_slot_mappings"
as permissive
for delete
to public
using (true);


create policy "heat_slot_mappings_insert"
on "public"."heat_slot_mappings"
as permissive
for insert
to public
with check (true);


create policy "heat_slot_mappings_select"
on "public"."heat_slot_mappings"
as permissive
for select
to public
using (true);


create policy "participants_select"
on "public"."participants"
as permissive
for select
to public
using (true);


create policy "read_own_payments"
on "public"."payments"
as permissive
for select
to public
using ((auth.uid() = user_id));


CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_advance_on_finished AFTER UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION fn_advance_on_finished();

CREATE TRIGGER trg_auto_transition_heats AFTER UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION fn_auto_transition_all_events();

CREATE TRIGGER trg_normalize_close BEFORE UPDATE ON public.heat_realtime_config FOR EACH ROW EXECUTE FUNCTION fn_normalize_close();

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.heats FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_update_heats_updated_at BEFORE UPDATE ON public.heats FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER update_heat_realtime_config_trigger AFTER UPDATE ON public.heats FOR EACH ROW EXECUTE FUNCTION update_heat_realtime_config_updated_at();

CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_update_participants_updated_at BEFORE UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION set_updated_at();



