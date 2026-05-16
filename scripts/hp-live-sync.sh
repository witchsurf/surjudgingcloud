#!/usr/bin/env bash
# =============================================================================
# hp-live-sync.sh — Synchronisation live des scores vers le Cloud via 4G
# =============================================================================
#
# Ce script lance une boucle qui pousse les scores du HP local vers le Cloud
# Supabase toutes les 30 secondes. Conçu pour être exécuté en arrière-plan
# pendant un événement sur la plage avec un hotspot 4G.
#
# Usage:
#   ./scripts/hp-live-sync.sh --event-id 17
#   ./scripts/hp-live-sync.sh --event-id 17 --interval 60
#
# Le display public (surfjudging.cloud/display) se met à jour automatiquement
# car il pointe sur le Cloud Supabase.
#
# Pour arrêter: kill $(pgrep -f hp-live-sync.sh) ou option 9 du menu terrain.
# =============================================================================
set -euo pipefail

INTERVAL=30
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

LOGFILE="$PROJECT_DIR/infra/.live-sync.log"

echo "======================================================" | tee -a "$LOGFILE"
echo "📡 LIVE SCORE SYNC — Mode 4G"                          | tee -a "$LOGFILE"
echo "   Event ID : $EVENT_ID"                                | tee -a "$LOGFILE"
echo "   Intervalle : ${INTERVAL}s"                           | tee -a "$LOGFILE"
echo "   Log : $LOGFILE"                                      | tee -a "$LOGFILE"
echo "   PID : $$"                                            | tee -a "$LOGFILE"
echo "   Démarré : $(date '+%Y-%m-%d %H:%M:%S')"             | tee -a "$LOGFILE"
echo "======================================================" | tee -a "$LOGFILE"

# Vérification initiale de la connectivité Cloud
echo -n "🔍 Test de connectivité Cloud... " | tee -a "$LOGFILE"
if curl -sf --connect-timeout 5 "https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/" -H "apikey: placeholder" > /dev/null 2>&1; then
  echo "✅ Cloud accessible" | tee -a "$LOGFILE"
else
  echo "⚠️ Cloud inaccessible pour le moment (le sync tentera quand même)" | tee -a "$LOGFILE"
fi

CYCLE=0
ERRORS=0
MAX_CONSECUTIVE_ERRORS=5

# Piège pour nettoyage propre
cleanup() {
  echo "" | tee -a "$LOGFILE"
  echo "⏹ Live sync arrêté à $(date '+%H:%M:%S') après $CYCLE cycles ($ERRORS erreurs)" | tee -a "$LOGFILE"
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
  else
    ERRORS=$((ERRORS + 1))
    echo "📡 [$TIMESTAMP] Cycle #$CYCLE ❌ erreur ($ERRORS consécutives)"

    if [[ "$ERRORS" -ge "$MAX_CONSECUTIVE_ERRORS" ]]; then
      echo "🛑 Trop d'erreurs consécutives ($MAX_CONSECUTIVE_ERRORS). Pause de 2 minutes..." | tee -a "$LOGFILE"
      sleep 120
      ERRORS=0
    fi
  fi

  sleep "$INTERVAL"
done
