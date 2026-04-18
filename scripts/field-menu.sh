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
  echo "7. Sync Field Box DB to Cloud"
  echo "0. Quit"
  echo
  read -r -p "Choix: " choice

  case "$choice" in
    1)
      if [[ "$PROFILE" == "home" ]]; then
        (cd frontend && node scripts/hp-photocopy-db.mjs)
        (cd frontend && node scripts/repair-broken-qualifiers.mjs --target=local)
      fi
      ./scripts/field-ops.sh "--$PROFILE"
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
      (cd frontend && node scripts/hp-photocopy-db.mjs)
      if [[ "$PROFILE" == "home" ]]; then
        (cd frontend && node scripts/repair-broken-qualifiers.mjs --target=local)
      fi
      read -r -p "Entrée pour continuer..."
      ;;
    7)
      (cd frontend && node scripts/hp-push-db-to-cloud.mjs)
      read -r -p "Entrée pour continuer..."
      ;;
    0)
      exit 0
      ;;
    *)
      echo "Choix invalide."
      sleep 1
      ;;
  esac
done
