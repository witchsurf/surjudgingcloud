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
  echo "======================================================"
  echo "🏄 Surf Judging Field Menu"
  echo "Profile : $PROFILE"
  echo "======================================================"
  echo "1. One-click ops"
  echo "2. Healthcheck only"
  echo "3. Deploy frontend only"
  echo "4. Refresh HP local stack"
  echo "5. Change network profile"
  echo "0. Quit"
  echo
  read -r -p "Choix: " choice

  case "$choice" in
    1)
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
    0)
      exit 0
      ;;
    *)
      echo "Choix invalide."
      sleep 1
      ;;
  esac
done
