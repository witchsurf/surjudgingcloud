#!/usr/bin/env bash
# =============================================================================
# hp-live-sync.sh — Synchronisation live display vers le Cloud via 4G
# =============================================================================
#
# Ce script lance une boucle qui pousse les données nécessaires au display
# public cloud depuis le HP local vers Supabase Cloud. Le rythme par défaut
# est de 10s pour un suivi public quasi live, et reste réglable si la 4G fatigue.
#
# Usage:
#   ./scripts/hp-live-sync.sh --event-id 17
#   ./scripts/hp-live-sync.sh --event-id 17 --interval 30
#
# Le display public (surfjudging.cloud/display) se met à jour automatiquement
# car il pointe sur le Cloud Supabase.
#
# Pour arrêter: kill $(pgrep -f hp-live-sync.sh) ou option 9 du menu terrain.
# =============================================================================
set -euo pipefail

# Add local HP Node.js path if it exists
if [[ -d "$HOME/node/bin" ]]; then
  export PATH="$HOME/node/bin:$PATH"
fi

INTERVAL=10
EVENT_ID=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --event-id|--event)
      EVENT_ID="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    *)
      echo "Usage: $0 --event-id <ID> [--interval <seconds>]"
      exit 1
      ;;
  esac
done

if [[ -z "$EVENT_ID" ]]; then
  echo "❌ --event-id est requis."
  echo "Usage: $0 --event-id 17 [--interval 30]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SYNC_SCRIPT="$PROJECT_DIR/frontend/scripts/hp-push-db-to-cloud.mjs"

if [[ ! -f "$SYNC_SCRIPT" ]]; then
  echo "❌ Script de sync introuvable: $SYNC_SCRIPT"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js est requis pour le live sync HP→Cloud."
  echo "   Lancez ce script depuis le Mac opérateur, ou installez Node.js sur le HP pour un mode autonome USB/4G."
  exit 1
fi

LOGFILE="$PROJECT_DIR/infra/.live-sync.log"
STATUS_FILE="$PROJECT_DIR/infra/.live-sync.status.json"
LOCK_DIR="$PROJECT_DIR/infra/.live-sync.lock"

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

load_env_file "$PROJECT_DIR/frontend/.env.local"
load_env_file "$PROJECT_DIR/infra/.env.local"

if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$$" > "$LOCK_DIR/pid"
else
  existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "❌ Live sync déjà actif (PID: $existing_pid). Stoppez-le avant d'en lancer un autre."
    exit 1
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo "$$" > "$LOCK_DIR/pid"
fi

write_status() {
  local state="$1"
  local message="$2"
  local last_ok="${3:-false}"
  cat > "$STATUS_FILE" <<JSON
{
  "state": "$state",
  "event_id": "$EVENT_ID",
  "pid": $$,
  "cycle": $CYCLE,
  "consecutive_errors": $ERRORS,
  "last_ok": $last_ok,
  "message": "$message",
  "updated_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "log": "$LOGFILE"
}
JSON
}

echo "======================================================" | tee -a "$LOGFILE"
echo "📡 LIVE SCORE SYNC — Mode 4G"                          | tee -a "$LOGFILE"
echo "   Event ID : $EVENT_ID"                                | tee -a "$LOGFILE"
echo "   Intervalle : ${INTERVAL}s"                           | tee -a "$LOGFILE"
echo "   Log : $LOGFILE"                                      | tee -a "$LOGFILE"
echo "   Status : $STATUS_FILE"                              | tee -a "$LOGFILE"
echo "   PID : $$"                                            | tee -a "$LOGFILE"
echo "   Démarré : $(date '+%Y-%m-%d %H:%M:%S')"             | tee -a "$LOGFILE"
echo "======================================================" | tee -a "$LOGFILE"

# Vérification initiale de la connectivité Cloud
echo -n "🔍 Test de connectivité Cloud... " | tee -a "$LOGFILE"
cloud_url="${VITE_SUPABASE_URL_CLOUD:-https://xwaymumbkmwxqifihuvn.supabase.co}"
cloud_key="${SUPABASE_SERVICE_ROLE_KEY_CLOUD:-${SUPABASE_SERVICE_ROLE_KEY:-${VITE_SUPABASE_SERVICE_ROLE_KEY_CLOUD:-${VITE_SUPABASE_ANON_KEY_CLOUD:-}}}}"
if [[ -n "$cloud_key" ]] && curl -sf --connect-timeout 5 \
  "$cloud_url/rest/v1/events?select=id&limit=1" \
  -H "apikey: $cloud_key" \
  -H "Authorization: Bearer $cloud_key" > /dev/null 2>&1; then
  echo "✅ Cloud accessible" | tee -a "$LOGFILE"
else
  echo "⚠️ Cloud inaccessible ou clé absente pour le moment (le sync tentera quand même)" | tee -a "$LOGFILE"
fi

CYCLE=0
ERRORS=0
MAX_CONSECUTIVE_ERRORS=5
write_status "starting" "live sync starting" false

# Piège pour nettoyage propre
cleanup() {
  echo "" | tee -a "$LOGFILE"
  echo "⏹ Live sync arrêté à $(date '+%H:%M:%S') après $CYCLE cycles ($ERRORS erreurs)" | tee -a "$LOGFILE"
  write_status "stopped" "stopped after $CYCLE cycles" false
  rm -rf "$LOCK_DIR"
  exit 0
}
trap cleanup SIGTERM SIGINT

while true; do
  CYCLE=$((CYCLE + 1))
  TIMESTAMP=$(date '+%H:%M:%S')

  echo "" >> "$LOGFILE"
  echo "--- Cycle #$CYCLE @ $TIMESTAMP ---" >> "$LOGFILE"

  # Lancer le sync one-shot
  if (cd "$PROJECT_DIR/frontend" && node scripts/hp-push-db-to-cloud.mjs --event-id "$EVENT_ID") >> "$LOGFILE" 2>&1; then
    echo "📡 [$TIMESTAMP] Cycle #$CYCLE ✅ sync OK"
    ERRORS=0
    write_status "running" "last sync OK" true
  else
    ERRORS=$((ERRORS + 1))
    echo "📡 [$TIMESTAMP] Cycle #$CYCLE ❌ erreur ($ERRORS consécutives)"
    write_status "degraded" "sync error ($ERRORS consecutive)" false

    if [[ "$ERRORS" -ge "$MAX_CONSECUTIVE_ERRORS" ]]; then
      echo "🛑 Trop d'erreurs consécutives ($MAX_CONSECUTIVE_ERRORS). Pause de 2 minutes..." | tee -a "$LOGFILE"
      write_status "backoff" "too many consecutive errors, sleeping 120s" false
      sleep 120
      ERRORS=0
    fi
  fi

  sleep "$INTERVAL"
done
