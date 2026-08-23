#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# SURF JUDGING CLOUD — LAUNCHER TERRAIN UNIFIÉ (MAC FÉDÉRATION)
#
# Usage:
#   ./surfjudging-field.sh                    # Menu interactif
#   ./surfjudging-field.sh --start            # Démarrage direct de la journée
#   ./surfjudging-field.sh --preflight        # Audit compétition
#   ./surfjudging-field.sh --status           # État de la stack locale
#   ./surfjudging-field.sh --urls             # Affichage des URLs d'exploitation
#   ./surfjudging-field.sh --backup           # Snapshot PostgreSQL de sécurité
#   ./surfjudging-field.sh --restart          # Redémarrage propre sans perte
#   ./surfjudging-field.sh --stop             # Arrêt des conteneurs (données préservées)
#
# Runtime de production : surfjudging_field_prod
# Volume persistant     : surfjudging_field_prod_pgdata (JAMAIS SUPPRIMÉ)
###############################################################################

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Add local node to PATH if present
if [[ -d "$HOME/node/bin" ]]; then
  export PATH="$HOME/node/bin:$PATH"
fi

PROJECT="${SURF_FIELD_PROJECT:-surfjudging_field_prod}"
API_PORT="${SURF_FIELD_API_PORT:-8000}"
WEB_PORT="${SURF_FIELD_WEB_PORT:-8080}"
PG_PORT="${SURF_FIELD_PG_PORT:-5432}"

RUNTIME_DIR="$REPO_ROOT/artifacts/runtimes/${PROJECT}"
COMPOSE_FILE="$RUNTIME_DIR/docker-compose.yml"
ENV_FILE="$RUNTIME_DIR/.env"
KONG_FILE="$RUNTIME_DIR/kong.yml"
NGINX_CONF="$RUNTIME_DIR/nginx.conf"
MANIFEST_FILE="$REPO_ROOT/config/p38-from-zero-manifest.json"
BACKUP_DIR="${SURF_BACKUP_DIR:-$HOME/surfjudging-backups}"

# Containers
C_POSTGRES="${PROJECT}_postgres"
C_AUTH="${PROJECT}_auth"
C_REST="${PROJECT}_rest"
C_REALTIME="${PROJECT}_realtime"
C_STORAGE="${PROJECT}_storage"
C_KONG="${PROJECT}_kong"
C_FRONTEND="${PROJECT}_frontend"

# Global state
CAFFEINATE_PID=""
SELECTED_EVENT_ID="${SURF_FIELD_EVENT_ID:-}"
NO_CAFFEINATE=false

# ANSI Colors
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_GREEN='\033[32m'
C_BLUE='\033[34m'
C_CYAN='\033[36m'
C_YELLOW='\033[33m'
C_RED='\033[31m'
C_MAGENTA='\033[35m'

log_info()    { printf "${C_CYAN}ℹ %s${C_RESET}\n" "$*"; }
log_ok()      { printf "${C_GREEN}✓ %s${C_RESET}\n" "$*"; }
log_warn()    { printf "${C_YELLOW}⚠ %s${C_RESET}\n" "$*"; }
log_err()     { printf "${C_RED}✗ %s${C_RESET}\n" "$*" >&2; }
log_header()  { printf "\n${C_BOLD}${C_BLUE}══ %s ══${C_RESET}\n" "$*"; }

fail() {
  log_err "$*"
  exit 1
}

cleanup_on_exit() {
  if [[ -n "$CAFFEINATE_PID" ]]; then
    kill "$CAFFEINATE_PID" 2>/dev/null || true
  fi
}
trap cleanup_on_exit EXIT

###############################################################################
# 1. NETWORK & ENVIRONMENT DETECTION
###############################################################################

detect_lan_ip() {
  local interface ip

  # macOS default route interface
  if command -v route >/dev/null 2>&1; then
    interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    if [[ -n "$interface" ]]; then
      ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
      if [[ -n "$ip" && "$ip" != 127.* && "$ip" != 169.254.* ]]; then
        printf '%s\n' "$ip"
        return 0
      fi
    fi
  fi

  # Fallback: inspect network interfaces
  ifconfig 2>/dev/null | awk '/inet / {print $2}' | while IFS= read -r ip; do
    case "$ip" in
      192.168.*|10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*)
        printf '%s\n' "$ip"
        return 0
        ;;
    esac
  done

  return 1
}

check_environment_deps() {
  command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé."
  command -v curl >/dev/null 2>&1 || fail "curl n'est pas installé."
  command -v node >/dev/null 2>&1 || fail "Node.js n'est pas installé."
  command -v python3 >/dev/null 2>&1 || fail "python3 n'est pas disponible."
  command -v nc >/dev/null 2>&1 || fail "netcat (nc) n'est pas disponible."

  # Check Docker daemon
  if ! docker info >/dev/null 2>&1; then
    if [[ "$(uname -s)" == "Darwin" ]] && command -v colima >/dev/null 2>&1; then
      log_info "Démarrage automatique de Colima..."
      colima start
    elif [[ "$(uname -s)" == "Darwin" ]] && [[ -d "/Applications/Docker.app" ]]; then
      log_info "Démarrage automatique de Docker Desktop..."
      open -g -a Docker
      for _ in $(seq 1 30); do
        if docker info >/dev/null 2>&1; then break; fi
        sleep 2
      done
    fi
    docker info >/dev/null 2>&1 || fail "Le démon Docker ne répond pas. Veuillez lancer Docker Desktop."
  fi
}

get_lan_ip_interactive() {
  local detected_ip chosen_ip
  detected_ip="$(detect_lan_ip || true)"

  if [[ -n "$detected_ip" ]]; then
    if [[ "${INTERACTIVE:-0}" == "1" ]]; then
      printf "\nIP LAN détectée : ${C_BOLD}${C_GREEN}%s${C_RESET}\n" "$detected_ip"
      read -r -p "Appuyez sur [Entrée] pour conserver cette IP ou saisissez une autre IP : " chosen_ip
      chosen_ip="${chosen_ip//[[:space:]]/}"
      LAN_IP="${chosen_ip:-$detected_ip}"
    else
      LAN_IP="$detected_ip"
    fi
  else
    if [[ "${INTERACTIVE:-0}" == "1" ]]; then
      log_warn "Aucune IP LAN privée détectée automatiquement (Wifi / Ethernet déconnecté ?)"
      read -r -p "Saisissez l'adresse IP LAN du Mac : " chosen_ip
      chosen_ip="${chosen_ip//[[:space:]]/}"
      [[ -n "$chosen_ip" ]] || fail "Adresse IP LAN obligatoire pour l'exploitation."
      LAN_IP="$chosen_ip"
    else
      fail "Impossible de détecter l'adresse IP LAN du Mac."
    fi
  fi

  if [[ "$LAN_IP" == 127.* || "$LAN_IP" == 169.254.* ]]; then
    fail "L'adresse IP '$LAN_IP' est invalide pour une diffusion terrain aux tablettes juges."
  fi
}

###############################################################################
# 2. RUNTIME CONFIGURATION & INITIALIZATION (PERSISTENT & NON-DESTRUCTIVE)
###############################################################################

ensure_production_runtime() {
  # Protections against operator mistake
  if [[ "$PROJECT" =~ (test|disposable|p38_manonman_test2) ]]; then
    log_warn "ATTENTION: Le nom de projet '$PROJECT' ressemble à un runtime de test."
  fi

  mkdir -p "$RUNTIME_DIR"

  if [[ ! -f "$ENV_FILE" ]]; then
    log_info "Initialisation FIRST-RUN du runtime de production ${PROJECT}..."

    local pg_pwd jwt_secret secret_base jwt_keys anon_key service_key
    pg_pwd=$(openssl rand -hex 32)
    jwt_secret=$(openssl rand -hex 32)
    secret_base=$(openssl rand -hex 64)

    jwt_keys=$(python3 -c "
import json, base64, hmac, hashlib, time
jwt_secret = '$jwt_secret'
def make_jwt(payload, secret):
    h = base64.urlsafe_b64encode(json.dumps({'alg':'HS256','typ':'JWT'}).encode()).rstrip(b'=').decode()
    b = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    msg = f'{h}.{b}'
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return f'{msg}.{sig}'
exp = int(time.time()) + 10 * 365 * 24 * 3600
anon = make_jwt({'role': 'anon', 'iss': 'supabase', 'iat': int(time.time()), 'exp': exp}, jwt_secret)
service = make_jwt({'role': 'service_role', 'iss': 'supabase', 'iat': int(time.time()), 'exp': exp}, jwt_secret)
print(json.dumps({'anon_key': anon, 'service_role_key': service}))
")
    anon_key=$(echo "$jwt_keys" | python3 -c "import json,sys; print(json.load(sys.stdin)['anon_key'])")
    service_key=$(echo "$jwt_keys" | python3 -c "import json,sys; print(json.load(sys.stdin)['service_role_key'])")

    cat > "$ENV_FILE" <<EOF
# Production Field Runtime Environment
# Created on: $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_PASSWORD=$pg_pwd
JWT_SECRET=$jwt_secret
ANON_KEY=$anon_key
SERVICE_ROLE_KEY=$service_key
API_EXTERNAL_URL=http://localhost:$API_PORT
SITE_URL=http://localhost:$WEB_PORT
REALTIME_TENANT_ID=${PROJECT}_realtime
REALTIME_SECRET_KEY_BASE=$secret_base
DB_ENC_KEY=supabaserealtime
VITE_OFFLINE_ADMIN_PIN=2026
EOF

    cat > "$KONG_FILE" <<EOF
_format_version: "1.1"
services:
  - name: auth
    url: http://${C_AUTH}:9999
    routes:
      - name: auth
        paths:
          - /auth/v1
        strip_path: true
  - name: rest
    url: http://${C_REST}:3000
    routes:
      - name: rest
        paths:
          - /rest/v1
        strip_path: true
  - name: realtime
    url: http://${C_REALTIME}:4000/socket
    routes:
      - name: realtime
        paths:
          - /realtime/v1
        strip_path: true
  - name: storage
    url: http://${C_STORAGE}:5000
    routes:
      - name: storage
        paths:
          - /storage/v1
        strip_path: true
EOF

    cat > "$NGINX_CONF" <<EOF
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /rest/ {
    proxy_pass http://${C_KONG}:8000/rest/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /auth/ {
    proxy_pass http://${C_KONG}:8000/auth/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /realtime/ {
    proxy_pass http://${C_KONG}:8000/realtime/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_buffering off;
  }

  location /storage/ {
    proxy_pass http://${C_KONG}:8000/storage/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
    try_files \$uri \$uri/ /index.html;
  }

  location = /index.html {
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
  }

  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable" always;
  }

  location = /deployment-manifest.json {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    try_files \$uri =404;
  }

  location = /favicon.ico {
    try_files \$uri =204;
  }
}
EOF

    cat > "$COMPOSE_FILE" <<EOF
version: '3.8'

networks:
  ${PROJECT}_net:
    name: ${PROJECT}_net
    driver: bridge

volumes:
  ${PROJECT}_pgdata:
    name: ${PROJECT}_pgdata
  ${PROJECT}_storage:
    name: ${PROJECT}_storage

services:
  postgres:
    image: supabase/postgres:15.1.0.147
    container_name: ${C_POSTGRES}
    restart: unless-stopped
    ports:
      - "${PG_PORT}:5432"
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_HOST: /var/run/postgresql
    volumes:
      - ${PROJECT}_pgdata:/var/lib/postgresql/data
    networks:
      - ${PROJECT}_net

  auth:
    image: supabase/gotrue:v2.132.3
    container_name: ${C_AUTH}
    restart: unless-stopped
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: \${API_EXTERNAL_URL}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:\${POSTGRES_PASSWORD}@${C_POSTGRES}:5432/postgres
      GOTRUE_SITE_URL: \${SITE_URL}
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_EXP: 315360000
      GOTRUE_JWT_SECRET: \${JWT_SECRET}
      GOTRUE_EXTERNAL_EMAIL_ENABLED: true
      GOTRUE_MAILER_AUTOCONFIRM: true
    depends_on:
      - postgres
    networks:
      - ${PROJECT}_net

  rest:
    image: postgrest/postgrest:v11.2.0
    container_name: ${C_REST}
    restart: unless-stopped
    environment:
      PGRST_DB_URI: postgres://authenticator:\${POSTGRES_PASSWORD}@${C_POSTGRES}:5432/postgres
      PGRST_DB_SCHEMAS: public,storage
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"
    depends_on:
      - postgres
    networks:
      - ${PROJECT}_net

  realtime:
    image: supabase/realtime:v2.25.50
    container_name: ${C_REALTIME}
    restart: unless-stopped
    environment:
      PORT: 4000
      DB_HOST: ${C_POSTGRES}
      DB_PORT: 5432
      DB_NAME: postgres
      DB_USER: supabase_admin
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      DB_AFTER_CONNECT_QUERY: 'SET search_path TO _realtime'
      DB_ENC_KEY: \${DB_ENC_KEY}
      TENANT_ID: \${REALTIME_TENANT_ID}
      SECRET_KEY_BASE: \${REALTIME_SECRET_KEY_BASE}
      API_JWT_SECRET: \${JWT_SECRET}
      FLY_ALLOC_ID: fly123
      FLY_APP_NAME: realtime
      ERL_AFLAGS: -proto_dist inet_tcp
      ENABLE_TAILSCALE: "false"
      DNS_NODES: "''"
    command: >
      sh -c "sed -i 's/tenant_name = \"realtime-dev\"/tenant_name = System.get_env(\"TENANT_ID\", \"realtime-dev\")/' /app/lib/realtime-2.25.50/priv/repo/seeds.exs && /app/bin/migrate && /app/bin/realtime eval 'Realtime.Release.seeds(Realtime.Repo)' && /app/bin/server"
    depends_on:
      - postgres
    networks:
      - ${PROJECT}_net

  storage:
    image: supabase/storage-api:v0.40.4
    container_name: ${C_STORAGE}
    restart: unless-stopped
    environment:
      ANON_KEY: \${ANON_KEY}
      SERVICE_KEY: \${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://${C_REST}:3000
      PGRST_JWT_SECRET: \${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:\${POSTGRES_PASSWORD}@${C_POSTGRES}:5432/postgres
      FILE_SIZE_LIMIT: 52428800
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: \${REALTIME_TENANT_ID}
      REGION: local
      GLOBAL_S3_BUCKET: local
    volumes:
      - ${PROJECT}_storage:/var/lib/storage
    depends_on:
      - postgres
      - rest
    networks:
      - ${PROJECT}_net

  kong:
    image: kong:2.8.1
    container_name: ${C_KONG}
    restart: unless-stopped
    ports:
      - "${API_PORT}:8000"
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /var/lib/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl
    volumes:
      - ./kong.yml:/var/lib/kong/kong.yml:ro
    depends_on:
      - auth
      - rest
      - realtime
      - storage
    networks:
      - ${PROJECT}_net

  frontend:
    image: nginx:alpine
    container_name: ${C_FRONTEND}
    restart: unless-stopped
    ports:
      - "${WEB_PORT}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - kong
    networks:
      - ${PROJECT}_net
EOF
    log_ok "Fichiers de runtime générés dans $RUNTIME_DIR"
  fi
}

###############################################################################
# 3. STACK LIFECYCLE & INCREMENTAL MIGRATIONS
###############################################################################

psql_exec() {
  local query="$1"
  docker exec "$C_POSTGRES" psql -U postgres -d postgres -c "$query"
}

psql_scalar() {
  local query="$1"
  docker exec "$C_POSTGRES" psql -t -A -U postgres -d postgres -c "$query"
}

start_stack_services() {
  log_info "Démarrage des conteneurs Supabase et Web (${PROJECT})..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres

  # Wait for postgres init cycle to complete
  log_info "Attente de la stabilisation de PostgreSQL..."
  for _ in $(seq 1 90); do
    local init_done skip_init
    init_done="$(docker logs "$C_POSTGRES" 2>&1 | grep -c "database system is ready to accept connections" || true)"
    skip_init="$(docker logs "$C_POSTGRES" 2>&1 | grep -c "PostgreSQL init process complete" || true)"
    if (( init_done >= 2 )) || { (( skip_init >= 1 )) && (( init_done >= 1 )); }; then
      break
    fi
    sleep 1
  done

  for _ in $(seq 1 30); do
    if docker exec "$C_POSTGRES" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      if docker exec "$C_POSTGRES" psql -U postgres -d postgres -tAc "SELECT 1;" >/dev/null 2>&1; then
        break
      fi
    fi
    sleep 1
  done
  docker exec "$C_POSTGRES" psql -U postgres -d postgres -tAc "SELECT 1;" >/dev/null 2>&1 || fail "PostgreSQL inaccessible dans le conteneur."
  sleep 2

  # Check if baseline is needed (first-run)
  local has_events_table
  has_events_table="$(psql_scalar "SELECT to_regclass('public.events') IS NOT NULL;")"

  if [[ "$has_events_table" != "t" ]]; then
    log_info "Initialisation de la base canonique P3.8..."
    local baseline_file="$REPO_ROOT/backend/supabase/p38-canonical-baseline.sql"
    [[ -f "$baseline_file" ]] || fail "Fichier baseline introuvable: $baseline_file"
    docker exec -i "$C_POSTGRES" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$baseline_file"

    # Configure role passwords
    local pg_pwd
    pg_pwd="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2)"
    docker exec -e PGPASSWORD="$pg_pwd" "$C_POSTGRES" psql -U supabase_admin -d postgres -c "
      ALTER ROLE authenticator WITH PASSWORD '$pg_pwd';
      ALTER ROLE supabase_auth_admin WITH PASSWORD '$pg_pwd';
      ALTER ROLE supabase_storage_admin WITH PASSWORD '$pg_pwd';
      ALTER ROLE postgres WITH PASSWORD '$pg_pwd';
      CREATE SCHEMA IF NOT EXISTS _realtime;
      GRANT ALL ON SCHEMA _realtime TO supabase_admin;
      GRANT USAGE ON SCHEMA _realtime TO postgres, anon, authenticated, service_role;
    " >/dev/null
    log_ok "Base canonique P3.8 installée et rôles configurés."
  fi

  # Ensure migrations tracking table exists
  psql_exec "
    CREATE TABLE IF NOT EXISTS public._local_applied_migrations (
      filename text PRIMARY KEY,
      applied_at timestamp with time zone NOT NULL DEFAULT now()
    );
  " >/dev/null

  # Apply any pending migrations incrementally from manifest
  log_info "Vérification des migrations incrémentales..."
  local latest_mig_base=""
  while IFS= read -r mig_rel; do
    [[ -n "$mig_rel" ]] || continue
    local mig_full="$REPO_ROOT/$mig_rel"
    local base_name
    base_name=$(basename "$mig_rel")
    latest_mig_base="${base_name%.sql}"
    local is_applied
    is_applied="$(psql_scalar "SELECT EXISTS (SELECT 1 FROM public._local_applied_migrations WHERE filename = '$base_name');")"
    if [[ "$is_applied" != "t" ]]; then
      log_info "Application de la migration: $base_name..."
      docker exec -i "$C_POSTGRES" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$mig_full"
      psql_exec "INSERT INTO public._local_applied_migrations (filename) VALUES ('$base_name') ON CONFLICT DO NOTHING;" >/dev/null
    fi
  done <<EOF
$(python3 -c "
import json
m = json.load(open('$MANIFEST_FILE'))
for mig in sorted(m['migrations'], key=lambda x: x['order']):
    print(mig['path'])
")
EOF

  # Apply field deployment mode provision
  psql_exec "
    INSERT INTO public.app_deployment_config (id, deployment_mode, provisioned_at, cloud_test_activation_enabled)
    VALUES (true, 'field', now(), false)
    ON CONFLICT (id) DO UPDATE SET
      deployment_mode = EXCLUDED.deployment_mode,
      provisioned_at = now();
  " >/dev/null
  if [[ -f "$REPO_ROOT/backend/sql/PROVISION_FIELD_DEPLOYMENT_MODE.sql" ]]; then
    docker exec -i "$C_POSTGRES" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$REPO_ROOT/backend/sql/PROVISION_FIELD_DEPLOYMENT_MODE.sql" >/dev/null 2>&1 || true
  fi

  # Stamp latest schema version
  if [[ -n "$latest_mig_base" ]]; then
    psql_exec "
      INSERT INTO public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
      VALUES (true, '$latest_mig_base', NULL, now())
      ON CONFLICT (id) DO UPDATE
        SET schema_version = excluded.schema_version,
            schema_label = excluded.schema_label,
            updated_at = excluded.updated_at;
    " >/dev/null
  fi

  # Start all other services
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d auth rest realtime storage kong frontend

  # Wait for Kong & PostgREST
  log_info "Attente des services API (Kong / PostgREST)..."
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${API_PORT}/rest/v1/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${API_PORT}/rest/v1/" >/dev/null 2>&1 || fail "API Kong / PostgREST inaccessible sur :${API_PORT}"

  log_ok "Stack Supabase (${PROJECT}) active et opérationnelle."
}

build_and_deploy_frontend() {
  log_info "Compilation et validation du frontend Field pour ${PROJECT}..."
  node "$REPO_ROOT/scripts/build-field-runtime.mjs" "$PROJECT"

  log_info "Déploiement du bundle dans le conteneur Web Nginx..."
  docker cp "$REPO_ROOT/frontend/dist-field/." "${C_FRONTEND}:/usr/share/nginx/html/"
  docker exec "${C_FRONTEND}" nginx -s reload >/dev/null 2>&1 || true

  # Check frontend accessibility via same-origin port
  log_info "Vérification de l'accès Web et same-origin sur :${WEB_PORT}..."
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1 || fail "Frontend Nginx inaccessible sur :${WEB_PORT}"

  # Check same-origin REST proxy
  curl -fsS "http://127.0.0.1:${WEB_PORT}/rest/v1/" >/dev/null 2>&1 || fail "Proxy REST Same-Origin (:${WEB_PORT}/rest/v1/) inopérant"

  log_ok "Frontend Field compilé et déployé avec succès."
}

###############################################################################
# 4. COMPETITION PREFLIGHT & HEALTHCHECKS
###############################################################################

get_available_events() {
  psql_scalar "
    SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'status', status)), '[]'::json)
    FROM (SELECT id, name, status FROM public.events ORDER BY id DESC) e;
  "
}

run_system_healthcheck() {
  log_header "ÉTAT DU SYSTÈME ET DU RUNTIME (${PROJECT})"

  local pass_cnt=0 warn_cnt=0 fail_cnt=0

  chk_pass() { pass_cnt=$((pass_cnt + 1)); printf "  ${C_GREEN}✓ %s${C_RESET}\n" "$*"; }
  chk_warn() { warn_cnt=$((warn_cnt + 1)); printf "  ${C_YELLOW}⚠ %s${C_RESET}\n" "$*"; }
  chk_fail() { fail_cnt=$((fail_cnt + 1)); printf "  ${C_RED}✗ %s${C_RESET}\n" "$*"; }

  # 1. Containers
  for c in "$C_POSTGRES" "$C_AUTH" "$C_REST" "$C_REALTIME" "$C_STORAGE" "$C_KONG" "$C_FRONTEND"; do
    local state
    state="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "absent")"
    if [[ "$state" == "running" ]]; then
      chk_pass "Conteneur $c : actif"
    else
      chk_fail "Conteneur $c : $state"
    fi
  done

  # 2. Database mode
  local db_mode
  db_mode="$(psql_scalar "SELECT public.get_authoritative_deployment_mode();" 2>/dev/null || echo "error")"
  if [[ "$db_mode" == "field" ]]; then
    chk_pass "Mode DB autoritaire : field"
  else
    chk_fail "Mode DB invalide : $db_mode"
  fi

  # 3. Schema version
  local schema_ver
  schema_ver="$(psql_scalar "SELECT schema_version FROM public.app_runtime_schema_version LIMIT 1;" 2>/dev/null || echo "missing")"
  local latest_expected
  latest_expected="$(basename "$(find "$REPO_ROOT/backend/supabase/migrations" -maxdepth 1 -name "*.sql" ! -name "._*" ! -name "TEST_MIGRATIONS.sql" | sort | tail -n 1)" .sql)"
  if [[ "$schema_ver" == "$latest_expected" ]]; then
    chk_pass "Version schéma DB : $schema_ver (conforme)"
  else
    chk_fail "Version schéma DB non alignée : $schema_ver (attendue : $latest_expected)"
  fi

  # 4. REST & Same-origin proxy
  if curl -fsS --connect-timeout 2 "http://127.0.0.1:${WEB_PORT}/rest/v1/" >/dev/null 2>&1; then
    chk_pass "API REST Same-Origin (http://127.0.0.1:${WEB_PORT}/rest/v1/) : OK"
  else
    chk_fail "API REST Same-Origin inaccessible sur port ${WEB_PORT}"
  fi

  # 5. Disk space
  local disk_avail_kb
  disk_avail_kb="$(df -k / | awk 'NR==2 {print $4}')"
  local disk_avail_mb=$((disk_avail_kb / 1024))
  if (( disk_avail_mb >= 2048 )); then
    chk_pass "Espace disque disponible : ${disk_avail_mb} Mo"
  elif (( disk_avail_mb >= 1024 )); then
    chk_warn "Espace disque disponible limité : ${disk_avail_mb} Mo"
  else
    chk_fail "Espace disque CRITIQUE : ${disk_avail_mb} Mo"
  fi

  # 6. Latest backup
  local latest_backup
  latest_backup="$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n 1 || true)"
  if [[ -n "$latest_backup" ]]; then
    chk_pass "Dernière sauvegarde : $(basename "$latest_backup") ($(date -r "$latest_backup" '+%Y-%m-%d %H:%M:%S'))"
  else
    chk_warn "Aucune sauvegarde trouvée dans $BACKUP_DIR"
  fi

  echo
  printf "Résultat santé système : %d validés, %d avertissements, %d erreurs.\n" "$pass_cnt" "$warn_cnt" "$fail_cnt"
  return $fail_cnt
}

run_competition_preflight() {
  local target_event="${1:-$SELECTED_EVENT_ID}"
  log_header "PRÉFLIGHT COMPÉTITION SPORTIF"

  local pass_cnt=0 warn_cnt=0 fail_cnt=0

  chk_pass() { pass_cnt=$((pass_cnt + 1)); printf "  ${C_GREEN}✓ %s${C_RESET}\n" "$*"; }
  chk_warn() { warn_cnt=$((warn_cnt + 1)); printf "  ${C_YELLOW}⚠ %s${C_RESET}\n" "$*"; }
  chk_fail() { fail_cnt=$((fail_cnt + 1)); printf "  ${C_RED}✗ %s${C_RESET}\n" "$*"; }

  # Check available events in DB
  local events_json
  events_json="$(get_available_events)"
  local event_count
  event_count="$(echo "$events_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")"

  if (( event_count == 0 )); then
    chk_warn "Aucun événement enregistré en base de données. Préparez ou importez un événement."
    return 0
  fi

  if [[ -z "$target_event" ]]; then
    if (( event_count == 1 )); then
      target_event="$(echo "$events_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"
      log_info "Événement unique détecté : ID $target_event"
    else
      echo "Événements disponibles :"
      echo "$events_json" | python3 -c "
import json,sys
for e in json.load(sys.stdin):
    print(f\"  • ID {e['id']} : {e['name']} ({e['status']})\")
"
      if [[ "${INTERACTIVE:-0}" == "1" ]]; then
        read -r -p "Saisissez l'ID de l'événement à auditer : " target_event
      else
        target_event="$(echo "$events_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"
      fi
    fi
  fi

  if [[ -z "${target_event// }" ]]; then
    chk_warn "Aucun événement sélectionné pour l'audit détaillé."
    return 0
  fi

  local event_name
  event_name="$(psql_scalar "SELECT name FROM public.events WHERE id = $target_event;" 2>/dev/null || echo "")"
  if [[ -z "$event_name" ]]; then
    chk_fail "Événement ID $target_event introuvable en base."
    return 1
  fi

  printf "Événement sélectionné : ${C_BOLD}%s (ID %s)${C_RESET}\n\n" "$event_name" "$target_event"

  # 1. Heats count
  local heats_cnt
  heats_cnt="$(psql_scalar "SELECT count(*) FROM public.heats WHERE event_id = $target_event;" 2>/dev/null || echo "0")"
  if (( heats_cnt > 0 )); then
    chk_pass "Heats planifiés : $heats_cnt"
  else
    chk_fail "Aucun heat enregistré pour cet événement"
  fi

  # 2. Participants count
  local part_cnt
  part_cnt="$(psql_scalar "SELECT count(*) FROM public.participants WHERE event_id = $target_event;" 2>/dev/null || echo "0")"
  if (( part_cnt > 0 )); then
    chk_pass "Participants enregistrés : $part_cnt"
  else
    chk_fail "Aucun participant enregistré pour cet événement"
  fi

  # 3. Judge Panels
  for pod in A B; do
    local p_judges
    p_judges="$(psql_scalar "SELECT count(*) FROM public.podium_judge_assignments WHERE event_id = $target_event AND podium_id = '$pod';" 2>/dev/null || echo "0")"
    if (( p_judges >= 3 )); then
      chk_pass "Podium $pod : Panel de $p_judges juges assignés"
    elif (( p_judges > 0 )); then
      chk_warn "Podium $pod : Seulement $p_judges juge(s) assigné(s)"
    else
      chk_warn "Podium $pod : Aucun panel assigné (inactif ou non configuré)"
    fi
  done

  # 4. Multi-podium judge conflicts
  local dup_judges
  dup_judges="$(psql_scalar "
    SELECT count(*) FROM (
      SELECT lower(trim(judge_id))
      FROM public.podium_judge_assignments
      WHERE event_id = $target_event
      GROUP BY lower(trim(judge_id))
      HAVING count(distinct podium_id) > 1
    ) conflicts;
  " 2>/dev/null || echo "0")"
  if [[ "$dup_judges" == "0" ]]; then
    chk_pass "Aucun conflit de juge entre podiums"
  else
    chk_fail "$dup_judges juge(s) affecté(s) simultanément aux podiums A et B"
  fi

  # 5. Pointer integrity (no cross-podium active heat conflict)
  local ptr_conflicts
  ptr_conflicts="$(psql_scalar "
    SELECT count(*) FROM (
      SELECT active_heat_id
      FROM public.active_heat_pointer
      WHERE event_id = $target_event AND nullif(trim(coalesce(active_heat_id, '')), '') IS NOT NULL
      GROUP BY active_heat_id
      HAVING count(distinct podium_id) > 1
    ) conflicts;
  " 2>/dev/null || echo "0")"
  if [[ "$ptr_conflicts" == "0" ]]; then
    chk_pass "Pointeurs de heats actifs cohérents (aucun conflit cross-podium)"
  else
    chk_fail "$ptr_conflicts heat(s) actif(s) sur plusieurs podiums simultanément"
  fi

  # 6. Event isolation check (no foreign heat active on pointer)
  local foreign_active
  foreign_active="$(psql_scalar "
    SELECT count(*)
    FROM public.active_heat_pointer ahp
    JOIN public.heats h ON h.id = ahp.active_heat_id
    WHERE ahp.event_id = $target_event AND h.event_id <> $target_event;
  " 2>/dev/null || echo "0")"
  if [[ "$foreign_active" == "0" ]]; then
    chk_pass "Isolation d'événement vérifiée (aucun heat externe actif)"
  else
    chk_fail "Incohérence: $foreign_active heat(s) d'un autre événement actif sur le podium"
  fi

  echo
  if (( fail_cnt == 0 )); then
    printf "${C_BOLD}${C_GREEN}🟢 PRÉFLIGHT : 100%% PASS — PRÊT POUR LA COMPÉTITION${C_RESET}\n\n"
  else
    printf "${C_BOLD}${C_RED}🔴 PRÉFLIGHT : FAIL (%d erreur(s)) — VÉRIFIER LA CONFIGURATION AVANT LE DÉBUT DU HEAT${C_RESET}\n\n" "$fail_cnt"
  fi

  return $fail_cnt
}

###############################################################################
# 5. URLS DASHBOARD
###############################################################################

print_operational_urls() {
  local ip="${1:-$LAN_IP}"
  local target_event="${2:-$SELECTED_EVENT_ID}"

  log_header "TABLEAU DE BORD DES ACCÈS TERRAIN (IP: $ip)"

  printf "\n${C_BOLD}TABLETTES JUGES (PODIUM A) :${C_RESET}\n"
  for j in J1 J2 J3 J4 J5; do
    if [[ -n "$target_event" ]]; then
      printf "  Judge %s : ${C_CYAN}http://%s:%s/judge?eventId=%s&podium=A&position=%s${C_RESET}\n" "$j" "$ip" "$WEB_PORT" "$target_event" "$j"
    else
      printf "  Judge %s : ${C_CYAN}http://%s:%s/judge?podium=A&position=%s${C_RESET}\n" "$j" "$ip" "$WEB_PORT" "$j"
    fi
  done

  printf "\n${C_BOLD}TABLETTES JUGES (PODIUM B) :${C_RESET}\n"
  for j in J1 J2 J3 J4 J5; do
    if [[ -n "$target_event" ]]; then
      printf "  Judge %s : ${C_CYAN}http://%s:%s/judge?eventId=%s&podium=B&position=%s${C_RESET}\n" "$j" "$ip" "$WEB_PORT" "$target_event" "$j"
    else
      printf "  Judge %s : ${C_CYAN}http://%s:%s/judge?podium=B&position=%s${C_RESET}\n" "$j" "$ip" "$WEB_PORT" "$j"
    fi
  done

  printf "\n${C_BOLD}INTERFACES OPÉRATEURS & PUBLIC :${C_RESET}\n"
  if [[ -n "$target_event" ]]; then
    printf "  👑 Chef Juge (Podium A) : ${C_BOLD}${C_GREEN}http://%s:%s/admin?eventId=%s&podium=A${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
    printf "  👑 Chef Juge (Podium B) : ${C_BOLD}${C_GREEN}http://%s:%s/admin?eventId=%s&podium=B${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
    printf "  📺 Display Public (A)   : ${C_YELLOW}http://%s:%s/display?eventId=%s&podium=A${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
    printf "  📺 Display Public (B)   : ${C_YELLOW}http://%s:%s/display?eventId=%s&podium=B${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
    printf "  🚩 Tour de Priorité (A) : ${C_MAGENTA}http://%s:%s/priority?eventId=%s&podium=A${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
    printf "  🎬 Overlay Live Stream  : ${C_CYAN}http://%s:%s/overlay?eventId=%s${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
    printf "  📋 Tableau Participants : ${C_CYAN}http://%s:%s/participants?eventId=%s${C_RESET}\n" "$ip" "$WEB_PORT" "$target_event"
  else
    printf "  👑 Chef Juge (Admin)   : ${C_BOLD}${C_GREEN}http://%s:%s/admin${C_RESET}\n" "$ip" "$WEB_PORT"
    printf "  📺 Display Public      : ${C_YELLOW}http://%s:%s/display${C_RESET}\n" "$ip" "$WEB_PORT"
    printf "  🚩 Tour de Priorité    : ${C_MAGENTA}http://%s:%s/priority${C_RESET}\n" "$ip" "$WEB_PORT"
    printf "  🎬 Overlay Live Stream : ${C_CYAN}http://%s:%s/overlay${C_RESET}\n" "$ip" "$WEB_PORT"
    printf "  📋 Tableau Participants: ${C_CYAN}http://%s:%s/participants${C_RESET}\n" "$ip" "$WEB_PORT"
  fi
  echo
}

###############################################################################
# 6. BACKUP SNAPSHOT ENGINE (VERIFIED & NON-DESTRUCTIVE)
###############################################################################

create_backup_snapshot() {
  local event_tag="${1:-${SELECTED_EVENT_ID:-all}}"
  log_header "CRÉATION D'UN SNAPSHOT DE SÉCURITÉ POSTGRESQL"

  mkdir -p "$BACKUP_DIR"
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local safe_tag
  safe_tag="${event_tag//[^a-zA-Z0-9_-]/_}"
  local filename="surfjudging_field_${PROJECT}_event-${safe_tag}_${timestamp}.dump"
  local filepath="$BACKUP_DIR/$filename"

  log_info "Exportation du dump PostgreSQL vers $filepath..."
  docker exec "$C_POSTGRES" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U supabase_admin -d postgres --format=custom --compress=6 --no-owner --no-privileges' \
    > "$filepath"

  [[ -s "$filepath" ]] || fail "Échec de l'export: le fichier dump est vide."

  # Verify dump integrity
  docker exec -i "$C_POSTGRES" pg_restore --list < "$filepath" >/dev/null || fail "Dump corrompu, vérification pg_restore échouée."

  # Generate checksum
  (cd "$BACKUP_DIR" && shasum -a 256 "$filename" > "${filename}.sha256")
  log_ok "Snapshot vérifié et créé : $filename"
  log_ok "Checksum SHA-256 : $(cat "$BACKUP_DIR/${filename}.sha256" | awk '{print $1}')"

  # Apply retention (keep last 12 snapshots)
  local stale_dumps
  stale_dumps=$(cd "$BACKUP_DIR" && ls -1t surfjudging_field_*.dump 2>/dev/null | tail -n +13 || true)
  if [[ -n "$stale_dumps" ]]; then
    log_info "Rotation des anciennes sauvegardes (> 12)..."
    echo "$stale_dumps" | while IFS= read -r stale; do
      rm -f "$BACKUP_DIR/$stale" "$BACKUP_DIR/${stale}.sha256"
    done
  fi
}

###############################################################################
# 7. MAIN WORKFLOW: "DÉMARRER LA JOURNÉE"
###############################################################################

start_competition_day() {
  log_header "DÉMARRAGE DE LA JOURNÉE DE COMPÉTITION"

  # 1. Preflight dependencies & Docker
  check_environment_deps

  # 2. Network detection
  get_lan_ip_interactive

  # 3. Port conflict checks
  for p in "$API_PORT" "$WEB_PORT" "$PG_PORT"; do
    if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      # Check if our container owns the port
      local owning_container
      owning_container="$(docker ps --filter "publish=$p" --format '{{.Names}}')"
      if [[ -n "$owning_container" && ! "$owning_container" =~ ^${PROJECT} ]]; then
        log_warn "Port $p déjà utilisé par un autre conteneur : $owning_container"
      fi
    fi
  done

  # 4. Initialize or update runtime
  ensure_production_runtime

  # 5. Start stack services & incremental migrations
  start_stack_services

  # 6. Build and deploy frontend
  build_and_deploy_frontend

  # 7. Run system health & competition preflight
  run_system_healthcheck || true
  run_competition_preflight "" || true

  # 8. Display URLs
  print_operational_urls "$LAN_IP" "$SELECTED_EVENT_ID"

  # 9. Power guard with caffeinate
  if [[ "$NO_CAFFEINATE" == "false" ]] && [[ "$(uname -s)" == "Darwin" ]] && command -v caffeinate >/dev/null 2>&1; then
    printf "${C_BOLD}${C_GREEN}🔒 VEILLE SYSTÈME INHIBÉE (caffeinate actif). Laissez ce terminal ouvert.${C_RESET}\n"
    printf "Appuyez sur [Ctrl+C] pour terminer l'inhibition de veille.\n\n"
    caffeinate -dimsu &
    CAFFEINATE_PID=$!
    wait $CAFFEINATE_PID 2>/dev/null || true
  fi
}

###############################################################################
# 8. INTERACTIVE MENU
###############################################################################

show_interactive_menu() {
  export INTERACTIVE=1
  check_environment_deps
  LAN_IP="$(detect_lan_ip || echo "127.0.0.1")"

  while true; do
    printf "\n${C_BOLD}${C_BLUE}══════════════════════════════════════════════════════════${C_RESET}\n"
    printf "${C_BOLD}${C_CYAN}🏄 SURF JUDGING CLOUD — POSTE FÉDÉRATION (${PROJECT})${C_RESET}\n"
    printf "IP LAN active : ${C_BOLD}${C_GREEN}%s${C_RESET} | Web : :%s | API : :%s\n" "$LAN_IP" "$WEB_PORT" "$API_PORT"
    printf "${C_BOLD}${C_BLUE}══════════════════════════════════════════════════════════${C_RESET}\n"
    echo " 1. 🚀 Démarrer la journée (Stack, Migrations, Build, Preflight, Caffeinate)"
    echo " 2. 🟢 Préflight compétition (Audit Heats, Juges, Panels, Conflits)"
    echo " 3. 🔍 État du système (Healthcheck Conteneurs, API, Schéma DB, Disque)"
    echo " 4. 🔗 Afficher les URLs (Admin, Juges J1..J5, Display, Priorité, Overlay)"
    echo " 5. 💾 Backup sécurité (Snapshot PostgreSQL avec vérification SHA-256)"
    echo " 6. 🔄 Redémarrer les services (Redémarrage propre sans modification de données)"
    echo " 7. ⏹  Arrêter proprement (Stop conteneurs, données et volumes intacts)"
    echo " 8. 🚪 Quitter"
    echo
    read -r -p "Votre choix [1-8] : " choice

    case "$choice" in
      1)
        start_competition_day
        ;;
      2)
        ensure_production_runtime
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres rest kong >/dev/null 2>&1 || true
        run_competition_preflight "" || true
        read -r -p "Appuyez sur [Entrée] pour continuer..."
        ;;
      3)
        ensure_production_runtime
        run_system_healthcheck || true
        read -r -p "Appuyez sur [Entrée] pour continuer..."
        ;;
      4)
        get_lan_ip_interactive
        print_operational_urls "$LAN_IP" "$SELECTED_EVENT_ID"
        read -r -p "Appuyez sur [Entrée] pour continuer..."
        ;;
      5)
        ensure_production_runtime
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres >/dev/null 2>&1 || true
        create_backup_snapshot ""
        read -r -p "Appuyez sur [Entrée] pour continuer..."
        ;;
      6)
        log_info "Redémarrage gracieux des conteneurs (${PROJECT})..."
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" restart
        log_ok "Services redémarrés."
        read -r -p "Appuyez sur [Entrée] pour continuer..."
        ;;
      7)
        log_info "Arrêt propre des services (${PROJECT})..."
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop
        log_ok "Stack arrêtée. Vos données sont préservées dans les volumes persistants."
        read -r -p "Appuyez sur [Entrée] pour continuer..."
        ;;
      8|q|Q)
        log_info "Au revoir !"
        exit 0
        ;;
      *)
        log_warn "Option invalide."
        sleep 1
        ;;
    esac
  done
}

###############################################################################
# CLI ENTRY POINT
###############################################################################

COMMAND="${1:-}"

case "$COMMAND" in
  --start|start)
    start_competition_day
    ;;
  --preflight|preflight)
    export INTERACTIVE=0
    check_environment_deps
    ensure_production_runtime
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres rest kong >/dev/null 2>&1 || true
    run_competition_preflight "${2:-}"
    ;;
  --status|status|--healthcheck)
    export INTERACTIVE=0
    check_environment_deps
    ensure_production_runtime
    run_system_healthcheck
    ;;
  --urls|urls)
    export INTERACTIVE=0
    check_environment_deps
    LAN_IP="$(detect_lan_ip || echo "127.0.0.1")"
    print_operational_urls "$LAN_IP" "${2:-}"
    ;;
  --backup|backup)
    export INTERACTIVE=0
    check_environment_deps
    ensure_production_runtime
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres >/dev/null 2>&1 || true
    create_backup_snapshot "${2:-}"
    ;;
  --restart|restart)
    export INTERACTIVE=0
    ensure_production_runtime
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" restart
    ;;
  --stop|stop)
    export INTERACTIVE=0
    ensure_production_runtime
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop
    ;;
  --no-caffeinate)
    NO_CAFFEINATE=true
    start_competition_day
    ;;
  --help|-h|help)
    echo "Usage: ./surfjudging-field.sh [options]"
    echo "  --start         Démarrer la journée de compétition"
    echo "  --preflight     Exécuter l'audit compétition"
    echo "  --status        Afficher l'état de la stack"
    echo "  --urls          Afficher les URLs d'exploitation"
    echo "  --backup        Créer un snapshot de sécurité"
    echo "  --restart       Redémarrer les services"
    echo "  --stop          Arrêter proprement la stack"
    echo "  --no-caffeinate Ne pas inhiber la mise en veille macOS"
    exit 0
    ;;
  "")
    show_interactive_menu
    ;;
  *)
    log_err "Commande inconnue : $COMMAND"
    echo "Consultez ./surfjudging-field.sh --help"
    exit 1
    ;;
esac
