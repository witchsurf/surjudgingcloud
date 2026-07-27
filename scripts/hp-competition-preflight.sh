#!/usr/bin/env bash
set -u

HP_HOST="${SURF_HP_HOST:-192.168.1.2}"
HP_USER="${SURF_HP_USER:-admin-surfjudging}"
EVENT_ID="${SURF_HP_EVENT_ID:-}"
EXPECTED_SCHEMA="${SURF_HP_EXPECTED_SCHEMA:-}"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '✅ %s\n' "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '⚠️  %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '❌ %s\n' "$1"
}

remote() {
  ssh -o BatchMode=yes -o ConnectTimeout=5 "${HP_USER}@${HP_HOST}" "$@"
}

sql() {
  local statement="$1"
  remote "docker exec surfjudging_postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc $(printf '%q' "$statement")"
}

printf '======================================================\n'
printf 'PRÉFLIGHT COMPÉTITION — SURF JUDGING\n'
printf 'HP       : %s\n' "$HP_HOST"
printf 'Événement: %s\n' "${EVENT_ID:-non précisé}"
printf '======================================================\n\n'

if [[ -z "${EVENT_ID// }" || ! "$EVENT_ID" =~ ^[0-9]+$ ]]; then
  fail "Un event_id numérique est obligatoire."
  printf '\nRésultat: ROUGE — préflight incomplet.\n'
  exit 2
fi

if remote "true" >/dev/null 2>&1; then
  pass "Connexion SSH au HP"
else
  fail "Connexion SSH impossible (${HP_USER}@${HP_HOST})"
  printf '\nRésultat: ROUGE — HP inaccessible.\n'
  exit 2
fi

DISK_AVAILABLE="$(remote "df -Pk / | awk 'NR==2 {print \$4}'" 2>/dev/null || true)"
if [[ "$DISK_AVAILABLE" =~ ^[0-9]+$ ]]; then
  DISK_MB=$((DISK_AVAILABLE / 1024))
  if (( DISK_MB >= 2048 )); then
    pass "Espace disque disponible: ${DISK_MB} Mo"
  elif (( DISK_MB >= 1024 )); then
    warn "Espace disque faible: ${DISK_MB} Mo"
  else
    fail "Espace disque critique: ${DISK_MB} Mo"
  fi
else
  fail "Espace disque illisible"
fi

REQUIRED_CONTAINERS=(
  surfjudging_postgres
  surfjudging_rest
  surfjudging_realtime
  surfjudging_kong
  surfjudging
)
for container in "${REQUIRED_CONTAINERS[@]}"; do
  STATE="$(remote "docker inspect -f '{{.State.Status}}' '$container' 2>/dev/null" || true)"
  if [[ "$STATE" == "running" ]]; then
    pass "Conteneur ${container}: actif"
  else
    fail "Conteneur ${container}: ${STATE:-absent}"
  fi
done

if curl -fsS --connect-timeout 3 "http://${HP_HOST}:8080" >/dev/null; then
  pass "Application locale HTTP"
else
  fail "Application locale inaccessible sur :8080"
fi

if curl -fsS --connect-timeout 3 \
  "http://${HP_HOST}:8000/rest/v1/events?id=eq.${EVENT_ID}&select=id&limit=1" \
  | grep -q "\"id\":${EVENT_ID}"; then
  pass "API locale et événement ${EVENT_ID}"
else
  fail "Événement ${EVENT_ID} absent ou API locale inaccessible"
fi

if [[ -n "$EXPECTED_SCHEMA" ]]; then
  INSTALLED_SCHEMA="$(curl -fsS --connect-timeout 3 \
    "http://${HP_HOST}:8000/rest/v1/app_runtime_schema_version?select=schema_version&limit=1" \
    | sed -n 's/.*"schema_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1)"
  if [[ "$INSTALLED_SCHEMA" == "$EXPECTED_SCHEMA" ]]; then
    pass "Schéma SQL aligné: ${INSTALLED_SCHEMA}"
  else
    fail "Schéma SQL non aligné: ${INSTALLED_SCHEMA:-absent} (attendu ${EXPECTED_SCHEMA})"
  fi
fi

HEAT_COUNT="$(sql "select count(*) from public.heats where event_id = ${EVENT_ID};" 2>/dev/null || true)"
if [[ "$HEAT_COUNT" =~ ^[0-9]+$ ]] && (( HEAT_COUNT > 0 )); then
  pass "Heats chargés: ${HEAT_COUNT}"
else
  fail "Aucun heat chargé pour l’événement"
fi

PARTICIPANT_COUNT="$(sql "select count(*) from public.participants where event_id = ${EVENT_ID};" 2>/dev/null || true)"
if [[ "$PARTICIPANT_COUNT" =~ ^[0-9]+$ ]] && (( PARTICIPANT_COUNT > 0 )); then
  pass "Participants chargés: ${PARTICIPANT_COUNT}"
else
  fail "Aucun participant chargé pour l’événement"
fi

for podium in A B; do
  PANEL_COUNT="$(sql "select count(*) from public.podium_judge_assignments where event_id = ${EVENT_ID} and podium_id = '${podium}';" 2>/dev/null || true)"
  if [[ "$PANEL_COUNT" =~ ^[0-9]+$ ]] && (( PANEL_COUNT >= 3 )); then
    pass "Podium ${podium}: panel de ${PANEL_COUNT} juges"
  elif [[ "$PANEL_COUNT" =~ ^[0-9]+$ ]] && (( PANEL_COUNT > 0 )); then
    warn "Podium ${podium}: seulement ${PANEL_COUNT} juge(s)"
  else
    fail "Podium ${podium}: aucun panel enregistré"
  fi
done

DUPLICATE_JUDGES="$(sql "
  select count(*)
  from (
    select lower(trim(judge_id))
    from public.podium_judge_assignments
    where event_id = ${EVENT_ID}
    group by lower(trim(judge_id))
    having count(distinct podium_id) > 1
  ) conflicts;
" 2>/dev/null || true)"
if [[ "$DUPLICATE_JUDGES" == "0" ]]; then
  pass "Aucun juge partagé entre les podiums"
elif [[ "$DUPLICATE_JUDGES" =~ ^[0-9]+$ ]]; then
  fail "${DUPLICATE_JUDGES} juge(s) affecté(s) aux deux podiums"
else
  fail "Contrôle des conflits de juges indisponible"
fi

POINTER_CONFLICTS="$(sql "
  select count(*)
  from (
    select active_heat_id
    from public.active_heat_pointer
    where event_id = ${EVENT_ID}
      and nullif(trim(coalesce(active_heat_id, '')), '') is not null
    group by active_heat_id
    having count(distinct podium_id) > 1
  ) conflicts;
" 2>/dev/null || true)"
if [[ "$POINTER_CONFLICTS" == "0" ]]; then
  pass "Aucun heat actif sur deux podiums"
elif [[ "$POINTER_CONFLICTS" =~ ^[0-9]+$ ]]; then
  fail "${POINTER_CONFLICTS} heat(s) actif(s) sur plusieurs podiums"
else
  fail "Contrôle des heats actifs indisponible"
fi

SLOT_STATUS="$(sql "
  select active::text || '|' ||
         coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn), 0)::text
  from pg_replication_slots
  where slot_type = 'logical'
  order by active desc, slot_name
  limit 1;
" 2>/dev/null || true)"
if [[ "$SLOT_STATUS" == true\|0 ]]; then
  pass "Realtime actif, retard WAL: 0 octet"
elif [[ "$SLOT_STATUS" == true\|* ]]; then
  warn "Realtime actif, retard WAL: ${SLOT_STATUS#*|} octets"
elif [[ -z "$SLOT_STATUS" ]]; then
  REALTIME_CONNECTIONS="$(sql "
    select count(*)
    from pg_stat_activity
    where usename = 'supabase_admin'
      and application_name ilike '%realtime%';
  " 2>/dev/null || true)"
  if [[ "$REALTIME_CONNECTIONS" =~ ^[0-9]+$ ]] && (( REALTIME_CONNECTIONS > 0 )); then
    pass "Realtime connecté à PostgreSQL (${REALTIME_CONNECTIONS} connexions, mode sans slot permanent)"
  else
    fail "Realtime sans slot ni connexion PostgreSQL"
  fi
else
  fail "Realtime inactif (${SLOT_STATUS})"
fi

printf '\n------------------------------------------------------\n'
printf 'VERT: %d  ORANGE: %d  ROUGE: %d\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
if (( FAIL_COUNT > 0 )); then
  printf 'Résultat: 🔴 NON PRÊT — corriger les points rouges.\n'
  exit 2
elif (( WARN_COUNT > 0 )); then
  printf 'Résultat: 🟠 PRÊT AVEC RÉSERVES — vérifier les alertes.\n'
  exit 1
else
  printf 'Résultat: 🟢 PRÊT POUR LA COMPÉTITION.\n'
fi
