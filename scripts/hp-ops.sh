#!/usr/bin/env bash
set -euo pipefail

# Unified operator entrypoint for HP/Event Box operations.
# Low-level scripts remain available, but day-to-day work should go through
# this wrapper so profile/host handling and command order stay consistent.

if [[ -d "$HOME/node/bin" ]]; then
  export PATH="$HOME/node/bin:$PATH"
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COMMAND="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

PROFILE="${SURF_HP_PROFILE:-home}"
HOST="${SURF_HP_HOST:-}"
HOST_FROM_CLI="0"
EVENT_ID=""
INTERVAL="10"
SKIP_REFRESH="0"
SKIP_DEPLOY="0"
SKIP_HEALTHCHECK="0"
REPAIR_QUALIFIERS="0"

usage() {
  cat <<'EOF'
Usage: ./scripts/hp-ops.sh <command> [--home|--field] [options]

Commands:
  upgrade          Refresh stack/migrations, deploy frontend, then healthcheck
  refresh          Sync stack files and apply local HP migrations only
  deploy           Build and deploy frontend only
  healthcheck      Check HP network, containers, local app/API, bundle
  cloud-to-local   Copy Cloud DB to HP local DB before an event
  local-to-cloud   Push one event from HP local DB to Cloud
  live-start       Start live HP -> Cloud display sync
  live-stop        Stop live HP -> Cloud display sync
  preflight        Check selected HP host ports and ask for a new IP if needed
  urls             Print useful URLs for the selected profile

Profiles:
  --home           HP on home LAN, default host 10.0.0.14
  --field          HP on D-LINK / beach LAN, locked host 192.168.1.2
  --host <ip>      Override selected profile host

Common options:
  --event-id <id>        Required for local-to-cloud/live-start, optional for cloud-to-local
  --interval <seconds>   Live sync interval, default 10
  --skip-refresh         For upgrade
  --skip-deploy          For upgrade
  --skip-healthcheck     For upgrade/cloud-to-local
  --repair-qualifiers    For cloud-to-local only

Examples:
  ./scripts/hp-ops.sh upgrade --home
  ./scripts/hp-ops.sh upgrade --field
  ./scripts/hp-ops.sh cloud-to-local --home --event-id 28
  ./scripts/hp-ops.sh local-to-cloud --field --event-id 28
  ./scripts/hp-ops.sh live-start --field --event-id 28 --interval 10
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)
      PROFILE="home"
      ;;
    --field)
      PROFILE="field"
      ;;
    --host)
      HOST="$2"
      HOST_FROM_CLI="1"
      shift
      ;;
    --event-id|--event)
      EVENT_ID="$2"
      shift
      ;;
    --interval)
      INTERVAL="$2"
      shift
      ;;
    --skip-refresh)
      SKIP_REFRESH="1"
      ;;
    --skip-deploy)
      SKIP_DEPLOY="1"
      ;;
    --skip-healthcheck)
      SKIP_HEALTHCHECK="1"
      ;;
    --repair-qualifiers)
      REPAIR_QUALIFIERS="1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$HOST" ]]; then
  if [[ "$PROFILE" == "field" ]]; then
    HOST="192.168.1.2"
  else
    HOST="10.0.0.14"
  fi
fi

if [[ "$COMMAND" == "help" || "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
  usage
  exit 0
fi

section() {
  printf '\n==> %s\n' "$1"
}

print_context() {
  echo "======================================================"
  echo "Surf Judging HP Ops"
  echo "Command : $COMMAND"
  echo "Profile : $PROFILE"
  echo "HP host : $HOST"
  echo "======================================================"
}

set_hp_host() {
  HOST="$1"
  export SURF_HP_HOST="$HOST"
}

command_uses_hp_host() {
  case "$COMMAND" in
    upgrade|refresh|deploy|healthcheck|cloud-to-local|local-to-cloud|live-start|preflight|urls)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_for_home_hp_host_if_needed() {
  local answer

  if [[ "$PROFILE" != "home" || "$HOST_FROM_CLI" == "1" || ! -t 0 ]]; then
    return
  fi

  if ! command_uses_hp_host; then
    return
  fi

  echo
  echo "Home profile: enter the current HP IP."
  echo "Press Enter to keep the suggested IP."
  read -r -p "HP IP [$HOST]: " answer
  answer="${answer//[[:space:]]/}"
  if [[ -n "$answer" ]]; then
    set_hp_host "$answer"
  else
    set_hp_host "$HOST"
  fi
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local attempts="${3:-20}"
  local delay="${4:-2}"

  for ((i=1; i<=attempts; i++)); do
    if nc -zvw2 "$host" "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

expected_schema_version() {
  local latest_migration
  latest_migration="$(find "$ROOT_DIR/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "._*" ! -name "TEST_MIGRATIONS.sql" | sort | tail -n 1)"
  basename "$latest_migration" .sql
}

read_hp_schema_version() {
  local response
  response="$(curl -fsS --connect-timeout 3 "http://$HOST:8000/rest/v1/app_runtime_schema_version?select=schema_version&limit=1" 2>/dev/null || true)"
  printf '%s' "$response" | sed -n 's/.*"schema_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

verify_hp_schema_version() {
  section "Verify HP runtime schema"
  local expected installed
  expected="$(expected_schema_version)"

  for ((i=1; i<=30; i++)); do
    installed="$(read_hp_schema_version)"
    if [[ "$installed" == "$expected" ]]; then
      echo "HP schema OK: $installed"
      return 0
    fi
    if [[ -n "$installed" ]]; then
      echo "HP schema not ready yet: installed=$installed expected=$expected"
    else
      echo "HP schema not readable yet: expected=$expected"
    fi
    sleep 2
  done

  installed="$(read_hp_schema_version)"
  echo "HP schema mismatch after refresh. Expected $expected, installed ${installed:-unreadable}" >&2
  echo "This usually means PostgREST/Kong did not expose the freshly stamped schema version." >&2
  exit 1
}

probe_port() {
  local host="$1"
  local port="$2"
  nc -zvw2 "$host" "$port" >/dev/null 2>&1
}

prompt_for_hp_host() {
  local current_host="$1"
  local answer

  if [[ ! -t 0 ]]; then
    echo "SSH is required but $current_host:22 is not reachable." >&2
    echo "Run again with the current HP IP, for example:" >&2
    echo "  ./scripts/hp-ops.sh $COMMAND --$PROFILE --host <HP_IP>" >&2
    exit 1
  fi

  echo
  echo "HP SSH is not reachable on $current_host:22."
  echo "If the router reassigned the HP IP, enter the new HP IP now."
  read -r -p "HP IP [$current_host]: " answer
  answer="${answer//[[:space:]]/}"
  if [[ -z "$answer" ]]; then
    answer="$current_host"
  fi

  set_hp_host "$answer"
  echo "Using HP host: $HOST"
}

preflight() {
  section "Preflight network"
  local attempts=0

  while true; do
    attempts=$((attempts + 1))

    if ping -c 1 -W 1000 "$HOST" >/dev/null 2>&1; then
      echo "$HOST ping ok"
    else
      echo "$HOST ping unavailable, checking TCP ports"
    fi

    for port in 22 8080 8000; do
      if probe_port "$HOST" "$port"; then
        echo "$HOST:$port ok"
      else
        echo "$HOST:$port not reachable"
      fi
    done

    if probe_port "$HOST" 22; then
      return 0
    fi

    if [[ "$attempts" -ge 2 ]]; then
      echo "SSH is required for this operation and is still not reachable on $HOST:22" >&2
      exit 1
    fi

    prompt_for_hp_host "$HOST"
  done
}

print_urls() {
  echo "Local app     : http://$HOST:8080"
  echo "Local display : http://$HOST:8080/display"
  echo "Local API     : http://$HOST:8000/rest/v1/events?select=id&limit=1"
  echo "Cloud display : https://surfjudging.cloud/display"
  echo "Public display: https://display.surfjudging.cloud/display"
}

require_event_id() {
  if [[ -z "${EVENT_ID// }" ]]; then
    echo "--event-id is required for command '$COMMAND'." >&2
    exit 1
  fi
}

run_refresh() {
  section "Refresh HP stack and migrations"
  (cd "$ROOT_DIR" && ./scripts/hp-refresh-stack.sh)
  section "Wait for local API"
  if ! wait_for_port "$HOST" 8000 30 2; then
    echo "Local API did not come back on $HOST:8000 after stack refresh" >&2
    exit 1
  fi
  verify_hp_schema_version
}

run_deploy() {
  section "Deploy frontend"
  (cd "$ROOT_DIR" && ./scripts/hp-deploy-frontend.sh)
}

run_healthcheck() {
  section "Healthcheck"
  (cd "$ROOT_DIR" && ./scripts/hp-healthcheck.sh)
}

export SURF_HP_PROFILE="$PROFILE"
set_hp_host "$HOST"
prompt_for_home_hp_host_if_needed
print_context

case "$COMMAND" in
  upgrade)
    preflight
    if [[ "$SKIP_REFRESH" != "1" ]]; then
      run_refresh
    fi
    if [[ "$SKIP_DEPLOY" != "1" ]]; then
      run_deploy
    fi
    if [[ "$SKIP_HEALTHCHECK" != "1" ]]; then
      run_healthcheck
    fi
    section "Useful URLs"
    print_urls
    echo
    echo "HP upgrade completed successfully."
    ;;
  refresh)
    preflight
    run_refresh
    ;;
  deploy)
    preflight
    run_deploy
    ;;
  healthcheck)
    run_healthcheck
    ;;
  cloud-to-local)
    args=("--$PROFILE")
    if [[ -n "${EVENT_ID// }" ]]; then
      args+=("--event-id" "$EVENT_ID")
    fi
    if [[ "$REPAIR_QUALIFIERS" == "1" ]]; then
      args+=("--repair-qualifiers")
    fi
    if [[ "$SKIP_HEALTHCHECK" == "1" ]]; then
      args+=("--skip-healthcheck")
    fi
    (cd "$ROOT_DIR" && ./scripts/hp-sync-cloud-to-local.sh "${args[@]}")
    ;;
  local-to-cloud)
    require_event_id
    (cd "$ROOT_DIR/frontend" && node scripts/hp-push-db-to-cloud.mjs --event-id "$EVENT_ID")
    ;;
  live-start)
    require_event_id
    (cd "$ROOT_DIR" && ./scripts/hp-live-sync.sh --event-id "$EVENT_ID" --interval "$INTERVAL")
    ;;
  live-stop)
    found_pid="$(pgrep -f "hp-live-sync.sh" 2>/dev/null || true)"
    if [[ -z "$found_pid" ]]; then
      echo "No live sync process found."
    else
      kill $found_pid
      echo "Stopped live sync PID(s): $found_pid"
    fi
    ;;
  preflight)
    preflight
    ;;
  urls)
    print_urls
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage
    exit 1
    ;;
esac
