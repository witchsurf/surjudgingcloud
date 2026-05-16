#!/usr/bin/env bash
set -euo pipefail

PROFILE="${SURF_HP_PROFILE:-field}"

choose_profile() {
  echo
  echo "Profile actuel: $PROFILE"
  echo "1. field (plage / D-LINK / 192.168.1.2)"
  echo "2. home  (maison / 10.0.0.28)"
  read -r -p "Choix profil [1/2, Entrée pour garder]: " answer
  case "$answer" in
    1) PROFILE="field" ;;
    2) PROFILE="home" ;;
    *) ;;
  esac
  export SURF_HP_PROFILE="$PROFILE"
}

while true; do
  clear
  if [[ "$PROFILE" == "home" ]]; then
    TITLE="📦 Surf Judging Event Box"
    ACTION_ONE="Prepare Event Box"
    ACTION_FOUR="Refresh Event Box local stack"
  else
    TITLE="🏄 Surf Judging Beach Ops"
    ACTION_ONE="Run Beach Ops"
    ACTION_FOUR="Refresh Beach local stack"
  fi
  echo "======================================================"
  echo "$TITLE"
  echo "Profile : $PROFILE"
  echo "======================================================"
  echo "1. $ACTION_ONE"
  echo "2. Healthcheck only"
  echo "3. Deploy frontend only"
  echo "4. $ACTION_FOUR"
  echo "5. Change network profile"
  echo "6. Photocopy Cloud DB to Field Box (Preparation)"
  echo "7. Sync Field Box DB to Cloud (one-shot)"
  echo "8. 📡 Live Score Sync via 4G (start)"
  echo "9. ⏹  Live Score Sync via 4G (stop)"
  echo "0. Quit"
  echo
  read -r -p "Choix: " choice

  case "$choice" in
    1)
      if [[ "$PROFILE" == "home" ]]; then
        ./scripts/hp-sync-cloud-to-local.sh --home
      else
        ./scripts/field-ops.sh "--$PROFILE"
      fi
      read -r -p "Entrée pour continuer..."
      ;;
    2)
      ./scripts/hp-healthcheck.sh
      read -r -p "Entrée pour continuer..."
      ;;
    3)
      ./scripts/hp-deploy-frontend.sh
      read -r -p "Entrée pour continuer..."
      ;;
    4)
      ./scripts/hp-refresh-stack.sh
      read -r -p "Entrée pour continuer..."
      ;;
    5)
      choose_profile
      ;;
    6)
      ./scripts/hp-sync-cloud-to-local.sh "--$PROFILE"
      read -r -p "Entrée pour continuer..."
      ;;
    7)
      echo
      read -r -p "Event ID à synchroniser vers le cloud (ex: 17, obligatoire): " sync_event_id
      if [[ -z "${sync_event_id// }" ]]; then
        echo "Sync annulée: aucun event_id fourni."
      else
        (cd frontend && node scripts/hp-push-db-to-cloud.mjs --event-id "$sync_event_id")
      fi
      read -r -p "Entrée pour continuer..."
      ;;
    8)
      echo
      read -r -p "Event ID pour le live sync (ex: 17): " live_event_id
      if [[ -z "${live_event_id// }" ]]; then
        echo "Live sync annulé: aucun event_id fourni."
      else
        ./scripts/hp-live-sync.sh --event-id "$live_event_id" &
        LIVE_SYNC_PID=$!
        echo "📡 Live sync démarré en arrière-plan (PID: $LIVE_SYNC_PID)"
        echo "   Event: $live_event_id | Intervalle: 30s"
        echo "   Utilisez l'option 9 pour arrêter."
      fi
      read -r -p "Entrée pour continuer..."
      ;;
    9)
      if [[ -n "${LIVE_SYNC_PID:-}" ]]; then
        kill "$LIVE_SYNC_PID" 2>/dev/null && echo "⏹ Live sync arrêté (PID: $LIVE_SYNC_PID)" || echo "⚠️ Processus déjà terminé"
        unset LIVE_SYNC_PID
      else
        # Tenter de trouver un processus live-sync en cours
        FOUND_PID=$(pgrep -f "hp-live-sync.sh" 2>/dev/null || true)
        if [[ -n "$FOUND_PID" ]]; then
          kill "$FOUND_PID" 2>/dev/null && echo "⏹ Live sync arrêté (PID: $FOUND_PID)" || echo "⚠️ Processus déjà terminé"
        else
          echo "ℹ️ Aucun live sync en cours."
        fi
      fi
      read -r -p "Entrée pour continuer..."
      ;;
    0)
      # Arrêter le live sync s'il tourne avant de quitter
      if [[ -n "${LIVE_SYNC_PID:-}" ]]; then
        kill "$LIVE_SYNC_PID" 2>/dev/null || true
        echo "⏹ Live sync arrêté avant fermeture."
      fi
      exit 0
      ;;
    *)
      echo "Choix invalide."
      sleep 1
      ;;
  esac
done
