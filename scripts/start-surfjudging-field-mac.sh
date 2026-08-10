#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURRENT_DIR="$ROOT_DIR/releases/mac-runtime/current"
RELEASE_ID="$(cat "$CURRENT_DIR/dist/RELEASE_ID" 2>/dev/null || echo "surfjudging-2026.08.10-p2.7.0-da441fc")"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose-local.yml"
COMPOSE_ENV="$ROOT_DIR/infra/.env"
NO_CAFFEINATE=false

if [[ "${1:-}" == "--no-caffeinate" ]]; then
  NO_CAFFEINATE=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--no-caffeinate]" >&2
  exit 2
fi

fail() {
  echo "ERREUR: $*" >&2
  exit 1
}

detect_lan_ip() {
  local interface ip
  interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -n "$interface" ]]; then
    ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    if [[ -n "$ip" && "$ip" != 127.* && "$ip" != 169.254.* ]]; then
      printf '%s\n' "$ip"
      return
    fi
  fi

  ifconfig | awk '/inet / {print $2}' | while IFS= read -r ip; do
    case "$ip" in
      10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*)
        printf '%s\n' "$ip"
        return
        ;;
    esac
  done
}

command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé."
command -v curl >/dev/null 2>&1 || fail "curl n'est pas installé."
command -v caffeinate >/dev/null 2>&1 || fail "caffeinate n'est pas disponible."
[[ -f "$COMPOSE_FILE" ]] || fail "Stack Supabase absente: $COMPOSE_FILE"
[[ -f "$COMPOSE_ENV" ]] || fail "Configuration locale absente: $COMPOSE_ENV"
[[ -f "$CURRENT_DIR/dist/deployment-manifest.json" ]] || fail "Release Field active absente."

LAN_IP="$(detect_lan_ip | head -n 1)"
[[ -n "$LAN_IP" ]] || fail "Impossible de détecter une adresse IP LAN privée."
echo "IP LAN détectée: $LAN_IP"

if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1; then
    echo "Démarrage du runtime Colima existant..."
    colima start
  else
    fail "Docker ne répond pas et aucun runtime Colima configuré n'est disponible."
  fi
fi

echo "Démarrage de la stack Supabase locale existante..."
docker compose --env-file "$COMPOSE_ENV" -f "$COMPOSE_FILE" \
  up -d postgres auth realtime storage rest kong

for _ in $(seq 1 60); do
  if curl -fsS --connect-timeout 2 "http://127.0.0.1:8000/rest/v1/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS --connect-timeout 3 "http://127.0.0.1:8000/rest/v1/" >/dev/null \
  || fail "Backend Supabase local inaccessible sur :8000."

FRONTEND_MODE="$(sed -nE 's/.*"deploymentMode"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$CURRENT_DIR/dist/deployment-manifest.json" | head -n 1)"
[[ "$FRONTEND_MODE" == "field" ]] || fail "Le frontend actif n'est pas un build Field."

if docker container inspect surfjudging >/dev/null 2>&1; then
  docker restart surfjudging >/dev/null
else
  docker image inspect nginx:alpine >/dev/null 2>&1 \
    || fail "Image nginx:alpine locale absente; aucun téléchargement n'est tenté."
  docker run -d \
    --name surfjudging \
    --restart unless-stopped \
    -p 8080:80 \
    -v "$CURRENT_DIR/dist:/usr/share/nginx/html:ro" \
    -v "$ROOT_DIR/infra/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
    nginx:alpine >/dev/null
fi

for _ in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 "http://127.0.0.1:8080/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS --connect-timeout 3 "http://127.0.0.1:8080/" >/dev/null \
  || fail "Frontend Field inaccessible sur :8080."

SERVED_RELEASE="$(curl -fsS --connect-timeout 3 "http://127.0.0.1:8080/RELEASE_ID")"
[[ "$SERVED_RELEASE" == "$RELEASE_ID" ]] \
  || fail "Release servie incorrecte: ${SERVED_RELEASE:-absente} (attendue: $RELEASE_ID)."

HAS_MODE_FUNCTION="$(docker exec surfjudging_postgres psql -At -U postgres -d postgres \
  -c "select to_regprocedure('public.get_authoritative_deployment_mode()') is not null")"
[[ "$HAS_MODE_FUNCTION" == "t" ]] \
  || fail "Mode DB autoritatif invérifiable: fonction get_authoritative_deployment_mode absente. Aucune migration n'a été appliquée."

DB_MODE="$(docker exec surfjudging_postgres psql -At -U postgres -d postgres \
  -c 'select public.get_authoritative_deployment_mode()')"
[[ "$DB_MODE" == "field" ]] || fail "Mode DB autoritatif incorrect: $DB_MODE"

echo "Backend local : OK"
echo "Frontend local: OK"
echo "Mode DB       : field"
echo "Release       : $SERVED_RELEASE"
echo
echo "ACCUEIL      http://$LAN_IP:8080/"
echo "ADMIN        http://$LAN_IP:8080/admin"
echo "JUGES        http://$LAN_IP:8080/judge"
echo "DISPLAY      http://$LAN_IP:8080/display"
echo "PRIORITÉ     http://$LAN_IP:8080/priority"
echo "PARTICIPANTS http://$LAN_IP:8080/participants"
echo

if [[ "$NO_CAFFEINATE" == false ]]; then
  echo "Veille système inhibée. Laissez ce terminal ouvert; Ctrl-C pour arrêter l'inhibition."
  exec caffeinate -dimsu
fi
