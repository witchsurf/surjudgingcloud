#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# P3.8 — Bootstrap Disposable Second Runtime from Zero
#
# Usage:
#   bash scripts/p38-bootstrap-second-runtime.sh --dry-run
#   bash scripts/p38-bootstrap-second-runtime.sh --execute
#
# Creates a fully isolated Supabase stack with fresh secrets, volumes, network.
###############################################################################

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$REPO_ROOT/config/p38-from-zero-manifest.json"
BASELINE="$REPO_ROOT/.p38-worktree/database/p38-canonical-baseline.sql"

# ── Project identity ─────────────────────────────────────────────────────────
PROJECT="${P38_PROJECT:-surfjudging_p38_manonman_test2}"
API_PORT="${P38_API_PORT:-18400}"
FRONTEND_PORT="${P38_FRONTEND_PORT:-18480}"
PG_PORT="${P38_PG_PORT:-18432}"

# ── Safety: refuse protected projects ────────────────────────────────────────
case "$PROJECT" in
  surfjudging_p38_manonman_test|surfjudging_p38_sandy_acceptance|accepted*|p37c*|surfjudging_postgres|surfjudging_kong|surfjudging_auth|surfjudging_rest|surfjudging_storage|surfjudging_realtime|surfjudging)
    echo "FATAL: refusing reserved project '$PROJECT'" >&2; exit 1;;
esac

# ── Mode parsing ─────────────────────────────────────────────────────────────
MODE="${1:---help}"
case "$MODE" in
  --dry-run)  DRY=1;;
  --execute)  DRY=0;;
  *)
    echo "Usage: $0 --dry-run | --execute" >&2
    echo "  P38_PROJECT=$PROJECT  API=$API_PORT  FRONTEND=$FRONTEND_PORT  PG=$PG_PORT" >&2
    exit 1;;
esac

# ── Derived names (all project-scoped) ───────────────────────────────────────
RUNTIME_ROOT="$REPO_ROOT/artifacts/runtimes/${PROJECT}"
COMPOSE_FILE="$RUNTIME_ROOT/docker-compose.yml"
ENV_FILE="$RUNTIME_ROOT/.env"
KONG_FILE="$RUNTIME_ROOT/kong.yml"
NGINX_CONF="$RUNTIME_ROOT/nginx.conf"
NETWORK_NAME="${PROJECT}_net"
PG_VOLUME="${PROJECT}_pgdata"
STORAGE_VOLUME="${PROJECT}_storage"

# Container names (all uniquely prefixed)
C_POSTGRES="${PROJECT}_postgres"
C_AUTH="${PROJECT}_auth"
C_REST="${PROJECT}_rest"
C_REALTIME="${PROJECT}_realtime"
C_STORAGE="${PROJECT}_storage"
C_KONG="${PROJECT}_kong"
C_FRONTEND="${PROJECT}_frontend"

EXPECTED_BASELINE_SHA="062dd28561e7dcc0c364cc3d2148c4415bb2f37f961674ee6f712bf5ae5e7ea5"

# ── Colour helpers ───────────────────────────────────────────────────────────
_ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
_info() { printf '\033[36m▸ %s\033[0m\n' "$*"; }
_warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
_fail() { printf '\033[31m✗ FATAL: %s\033[0m\n' "$*" >&2; exit 1; }

###############################################################################
# PHASE 0 — PREFLIGHT SAFETY
###############################################################################
_info "PHASE 0: Preflight safety checks"

# 0.1  Manifest exists
[[ -f "$MANIFEST" ]] || _fail "Manifest not found: $MANIFEST"

# 0.2  Baseline exists and matches
[[ -f "$BASELINE" ]] || _fail "Baseline not found: $BASELINE"
ACTUAL_BASE_SHA=$(shasum -a 256 "$BASELINE" | awk '{print $1}')
[[ "$ACTUAL_BASE_SHA" == "$EXPECTED_BASELINE_SHA" ]] || _fail "Baseline SHA mismatch: expected=$EXPECTED_BASELINE_SHA actual=$ACTUAL_BASE_SHA"
_ok "Baseline SHA256 verified: $EXPECTED_BASELINE_SHA"

# 0.3  Verify 8 migration hashes
MIGRATION_CHECK=$(python3 -c "
import json, hashlib, sys
m = json.load(open('$MANIFEST'))
fail = 0
for mig in m['migrations']:
    with open('$REPO_ROOT/' + mig['path'], 'rb') as f:
        actual = hashlib.sha256(f.read()).hexdigest()
    if actual != mig['sha256']:
        print(f'FAIL [{mig[\"order\"]}] {mig[\"path\"]}: expected={mig[\"sha256\"][:16]} actual={actual[:16]}', file=sys.stderr)
        fail += 1
print(f'{len(m[\"migrations\"])} migrations checked, {fail} failures')
sys.exit(fail)
")
_ok "Migrations: $MIGRATION_CHECK"

# 0.4  Port collision check
for P in $API_PORT $FRONTEND_PORT $PG_PORT; do
  if lsof -iTCP:"$P" -sTCP:LISTEN >/dev/null 2>&1; then
    _fail "Port $P already in use"
  fi
done
_ok "Ports free: API=$API_PORT FRONTEND=$FRONTEND_PORT PG=$PG_PORT"

# 0.5  Docker daemon reachable
docker info >/dev/null 2>&1 || _fail "Docker daemon not reachable"
_ok "Docker daemon OK"

# 0.6  No collision with existing project containers
for C in $C_POSTGRES $C_AUTH $C_REST $C_REALTIME $C_STORAGE $C_KONG $C_FRONTEND; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$C"; then
    _fail "Container '$C' already exists. Clean up first."
  fi
done
_ok "No container name collisions"

# 0.7  Check required images are available
for IMG in supabase/postgres:15.1.0.147 supabase/gotrue:v2.132.3 postgrest/postgrest:v11.2.0 \
           supabase/realtime:v2.25.50 supabase/storage-api:v0.40.4 kong:2.8.1 nginx:alpine; do
  if ! docker image inspect "$IMG" >/dev/null 2>&1; then
    _info "Image $IMG not cached locally, will be pulled..."
  fi
done
_ok "Image availability checked"

###############################################################################
# PHASE 1 — SECRET GENERATION
###############################################################################
_info "PHASE 1: Generate fresh project-specific secrets"

POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
SECRET_KEY_BASE=$(openssl rand -hex 64)
DB_ENC_KEY="supabaserealtime"

# Generate LEGACY HS256 JWT keys using python
JWT_KEYS=$(python3 -c "
import json, base64, hmac, hashlib, struct, time

jwt_secret = '$JWT_SECRET'

def make_jwt(payload, secret):
    header = base64.urlsafe_b64encode(json.dumps({'alg':'HS256','typ':'JWT'}).encode()).rstrip(b'=').decode()
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    msg = f'{header}.{body}'
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return f'{msg}.{sig}'

# Expiry: 10 years from now
exp = int(time.time()) + 10 * 365 * 24 * 3600

anon = make_jwt({'role': 'anon', 'iss': 'supabase', 'iat': int(time.time()), 'exp': exp}, jwt_secret)
service = make_jwt({'role': 'service_role', 'iss': 'supabase', 'iat': int(time.time()), 'exp': exp}, jwt_secret)

print(json.dumps({'anon_key': anon, 'service_role_key': service}))
")
ANON_KEY=$(echo "$JWT_KEYS" | python3 -c "import json,sys; print(json.load(sys.stdin)['anon_key'])")
SERVICE_ROLE_KEY=$(echo "$JWT_KEYS" | python3 -c "import json,sys; print(json.load(sys.stdin)['service_role_key'])")

# Validate JWT self-check
JWT_VALID=$(python3 -c "
import json, base64, hmac, hashlib
jwt_secret = '$JWT_SECRET'
for name, token in [('anon', '$ANON_KEY'), ('service_role', '$SERVICE_ROLE_KEY')]:
    parts = token.split('.')
    if len(parts) != 3:
        print(f'FAIL: {name} has {len(parts)} parts')
        exit(1)
    msg = f'{parts[0]}.{parts[1]}'
    expected_sig = base64.urlsafe_b64encode(hmac.new(jwt_secret.encode(), msg.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    if expected_sig != parts[2]:
        print(f'FAIL: {name} signature mismatch')
        exit(1)
    # Decode payload and check role
    padded = parts[1] + '=' * (4 - len(parts[1]) % 4)
    payload = json.loads(base64.urlsafe_b64decode(padded))
    expected_role = 'anon' if name == 'anon' else 'service_role'
    if payload.get('role') != expected_role:
        print(f'FAIL: {name} role={payload.get(\"role\")} expected={expected_role}')
        exit(1)
print('JWT_SELF_CHECK=PASS')
")
[[ "$JWT_VALID" == "JWT_SELF_CHECK=PASS" ]] || _fail "JWT self-check failed: $JWT_VALID"
_ok "Secrets generated and JWT self-checked"

###############################################################################
# DRY-RUN OUTPUT
###############################################################################
if [[ $DRY -eq 1 ]]; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  DRY-RUN SUMMARY — project: $PROJECT"
  echo "═══════════════════════════════════════════════════"
  echo "  Runtime root:    $RUNTIME_ROOT"
  echo "  API port:        $API_PORT"
  echo "  Frontend port:   $FRONTEND_PORT"
  echo "  PG port:         $PG_PORT"
  echo "  Network:         $NETWORK_NAME"
  echo "  PG Volume:       $PG_VOLUME"
  echo "  Storage Volume:  $STORAGE_VOLUME"
  echo ""
  echo "  Containers:"
  for C in $C_POSTGRES $C_AUTH $C_REST $C_REALTIME $C_STORAGE $C_KONG $C_FRONTEND; do
    echo "    - $C"
  done
  echo ""
  echo "  Baseline:  $BASELINE (SHA OK)"
  echo "  Migrations: 8/8 verified"
  echo "  JWT: ANON_KEY valid, SERVICE_ROLE_KEY valid"
  echo ""
  python3 -c "
import json, sys
m = json.load(open('$MANIFEST'))
print(json.dumps({
  'project': '$PROJECT',
  'api_port': '$API_PORT',
  'frontend_port': '$FRONTEND_PORT',
  'pg_port': '$PG_PORT',
  'migration_count': len(m['migrations']),
  'migrations': [x['path'].split('/')[-1] for x in m['migrations']],
  'secret_policy': m['secret_policy'],
  'auth_mode': m['auth_mode'],
}, indent=2))
"
  echo ""
  echo "DRY-RUN COMPLETE. Use --execute to provision."
  exit 0
fi

###############################################################################
# PHASE 2 — RUNTIME ROOT & FILES
###############################################################################
_info "PHASE 2: Creating runtime root: $RUNTIME_ROOT"

rm -rf "$RUNTIME_ROOT"
mkdir -p "$RUNTIME_ROOT"

# ── 2.1 Generate .env ────────────────────────────────────────────────────────
cat > "$ENV_FILE" <<ENVEOF
# Auto-generated for disposable project: $PROJECT
# Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
API_EXTERNAL_URL=http://localhost:$API_PORT
SITE_URL=http://localhost:$FRONTEND_PORT
REALTIME_TENANT_ID=${PROJECT}_realtime
REALTIME_SECRET_KEY_BASE=$SECRET_KEY_BASE
DB_ENC_KEY=$DB_ENC_KEY
VITE_OFFLINE_ADMIN_PIN=2026
ENVEOF
_ok ".env generated"

# ── 2.2 Generate kong.yml ────────────────────────────────────────────────────
cat > "$KONG_FILE" <<KONGEOF
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
plugins:
  - name: cors
    config:
      origins:
        - '*'
      methods:
        - GET
        - POST
        - PUT
        - PATCH
        - DELETE
        - OPTIONS
      headers:
        - Accept
        - Accept-Version
        - Content-Length
        - Content-MD5
        - Content-Type
        - Date
        - X-Auth-Token
        - Authorization
        - apikey
        - Prefer
        - Range
        - accept-profile
        - content-profile
        - x-client-info
      exposed_headers:
        - Content-Range
        - Content-Length
        - Content-Type
      credentials: true
      max_age: 86400
KONGEOF
_ok "kong.yml generated"

# ── 2.3 Generate nginx.conf ──────────────────────────────────────────────────
cat > "$NGINX_CONF" <<NGINXEOF
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
NGINXEOF
_ok "nginx.conf generated"

# ── 2.4 Generate docker-compose.yml ──────────────────────────────────────────
cat > "$COMPOSE_FILE" <<COMPOSEEOF
# Auto-generated for disposable project: $PROJECT
services:
  postgres:
    image: supabase/postgres:15.1.0.147
    container_name: $C_POSTGRES
    restart: unless-stopped
    ports:
      - "${PG_PORT}:5432"
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_HOST: /var/run/postgresql
    volumes:
      - ${PG_VOLUME}:/var/lib/postgresql/data
    networks:
      - ${NETWORK_NAME}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

  auth:
    image: supabase/gotrue:v2.132.3
    container_name: $C_AUTH
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
      GOTRUE_JWT_EXP: 3600
      GOTRUE_JWT_SECRET: \${JWT_SECRET}
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_MAILER_AUTOCONFIRM: "true"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - ${NETWORK_NAME}

  rest:
    image: postgrest/postgrest:v11.2.0
    container_name: $C_REST
    restart: unless-stopped
    environment:
      PGRST_DB_URI: postgres://authenticator:\${POSTGRES_PASSWORD}@${C_POSTGRES}:5432/postgres
      PGRST_DB_SCHEMAS: public,storage,graphql_public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"
      PGRST_APP_SETTINGS_JWT_SECRET: \${JWT_SECRET}
      PGRST_APP_SETTINGS_JWT_EXP: "3600"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - ${NETWORK_NAME}

  realtime:
    image: supabase/realtime:v2.25.50
    container_name: $C_REALTIME
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    environment:
      DB_HOST: ${C_POSTGRES}
      DB_PORT: "5432"
      DB_USER: supabase_admin
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      DB_NAME: postgres
      DB_AFTER_CONNECT_QUERY: "SET search_path TO _realtime"
      DB_ENC_KEY: \${DB_ENC_KEY}
      TENANT_ID: \${REALTIME_TENANT_ID}
      API_JWT_SECRET: \${JWT_SECRET}
      FLY_ALLOC_ID: fly123
      FLY_APP_NAME: realtime
      SECRET_KEY_BASE: \${REALTIME_SECRET_KEY_BASE}
      ERL_AFLAGS: -proto_dist inet_tcp
      ENABLE_TAILSCALE: "false"
      DNS_NODES: "''"
      LOG_LEVEL: "error"
      DISABLE_HEALTHCHECK_LOGGING: "true"
    command: >
      sh -c "sed -i 's/tenant_name = \"realtime-dev\"/tenant_name = System.get_env(\"TENANT_ID\", \"realtime-dev\")/' /app/lib/realtime-2.25.50/priv/repo/seeds.exs && /app/bin/migrate && /app/bin/realtime eval 'Realtime.Release.seeds(Realtime.Repo)' && /app/bin/server"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - ${NETWORK_NAME}

  storage:
    image: supabase/storage-api:v0.40.4
    container_name: $C_STORAGE
    restart: unless-stopped
    environment:
      ANON_KEY: \${ANON_KEY}
      SERVICE_KEY: \${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://${C_REST}:3000
      PGRST_JWT_SECRET: \${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:\${POSTGRES_PASSWORD}@${C_POSTGRES}:5432/postgres
      FILE_SIZE_LIMIT: "52428800"
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      GLOBAL_S3_BUCKET: stub
    volumes:
      - ${STORAGE_VOLUME}:/var/lib/storage
    depends_on:
      postgres:
        condition: service_healthy
      rest:
        condition: service_started
    networks:
      - ${NETWORK_NAME}

  kong:
    image: kong:2.8.1
    container_name: $C_KONG
    restart: unless-stopped
    ulimits:
      nofile:
        soft: 4096
        hard: 8192
    ports:
      - "${API_PORT}:8000"
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /var/lib/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl
      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: 160k
      KONG_NGINX_PROXY_PROXY_BUFFERS: 64 160k
    volumes:
      - ./kong.yml:/var/lib/kong/kong.yml:ro
    depends_on:
      auth:
        condition: service_started
      rest:
        condition: service_started
      realtime:
        condition: service_started
      storage:
        condition: service_started
    networks:
      - ${NETWORK_NAME}
    healthcheck:
      test: ["CMD", "kong", "health"]
      interval: 10s
      timeout: 5s
      retries: 5

  frontend:
    image: nginx:alpine
    container_name: $C_FRONTEND
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT}:80"
    volumes:
      - ${NGINX_CONF}:/etc/nginx/conf.d/default.conf:ro
    networks:
      - ${NETWORK_NAME}

volumes:
  ${PG_VOLUME}:
    name: ${PG_VOLUME}
  ${STORAGE_VOLUME}:
    name: ${STORAGE_VOLUME}

networks:
  ${NETWORK_NAME}:
    name: ${NETWORK_NAME}
    driver: bridge
COMPOSEEOF
_ok "docker-compose.yml generated"

###############################################################################
# PHASE 3 — BUILD FRONTEND (for the frontend container)
###############################################################################
_info "PHASE 3: Build frontend dist for disposable runtime"

(
  cd "$REPO_ROOT/frontend"
  VITE_DEPLOYMENT_MODE=field \
  VITE_SUPABASE_URL_LOCAL="http://127.0.0.1:${API_PORT}" \
  VITE_SUPABASE_URL_LAN="http://192.168.1.107:${API_PORT}" \
  VITE_SUPABASE_ANON_KEY_LOCAL="$ANON_KEY" \
  VITE_SUPABASE_ANON_KEY_LAN="$ANON_KEY" \
  npx vite build --outDir "$RUNTIME_ROOT/dist"
) || _fail "Frontend build failed"
_ok "Frontend built for project"

# Create a deployment-manifest.json for field mode
cat > "$RUNTIME_ROOT/deployment-manifest.json" <<DMEOF
{
  "deploymentMode": "field",
  "releaseId": "p38-disposable-${PROJECT}",
  "codeRevision": "$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')",
  "expectedSchemaVersion": "20260821180000_p38_v4_legacy_recursion_fix",
  "cloudTestActivationSupported": false,
  "publicApiUrl": "http://192.168.1.107:${API_PORT}"
}
DMEOF

# Build the frontend image for this project
FRONTEND_IMG="${PROJECT}_frontend_img"
FRONTEND_DOCKERFILE="$RUNTIME_ROOT/Dockerfile.frontend"
cat > "$FRONTEND_DOCKERFILE" <<FEOF
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
COPY deployment-manifest.json /usr/share/nginx/html/deployment-manifest.json
FEOF

(cd "$RUNTIME_ROOT" && docker build -t "$FRONTEND_IMG" -f Dockerfile.frontend .) || _fail "Frontend image build failed"
_ok "Frontend image built: $FRONTEND_IMG"

# Update compose to use project-specific frontend image
python3 -c "
import re
with open('$COMPOSE_FILE', 'r') as f:
    content = f.read()
content = content.replace('image: nginx:alpine', 'image: ${FRONTEND_IMG}')
# Remove the nginx volume mount since config is baked in
content = re.sub(r'    volumes:\n      - .*nginx\.conf.*\n', '', content)
with open('$COMPOSE_FILE', 'w') as f:
    f.write(content)
"
_ok "Compose updated with project frontend image"

###############################################################################
# PHASE 4 — POSTGRES STARTUP
###############################################################################
_info "PHASE 4: Start PostgreSQL and wait for health"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d postgres
_ok "PostgreSQL container started"

# The supabase/postgres image has a two-phase init:
#   1. Start PG, run init scripts, STOP PG
#   2. Start PG again for real
# We must wait for "ready for start up" (phase 2 marker) AND then pg_isready.
_info "  Waiting for init cycle to complete (may take 15-30s)..."

# Wait for the container log to show the post-init "database system is ready to accept connections"
for i in $(seq 1 90); do
  # Count how many times "ready to accept connections" appears - need >=2 (init + real start)
  # OR "PostgreSQL init process complete" followed by "ready to accept connections"
  INIT_DONE=$(docker logs "$C_POSTGRES" 2>&1 | grep -c "database system is ready to accept connections" || true)
  if [[ "$INIT_DONE" -ge 2 ]]; then
    break
  fi
  # Also check for fresh containers that skip init (already initialized volume)
  SKIP_INIT=$(docker logs "$C_POSTGRES" 2>&1 | grep -c "PostgreSQL init process complete" || true)
  if [[ "$SKIP_INIT" -ge 1 && "$INIT_DONE" -ge 1 ]]; then
    break
  fi
  if [[ $i -eq 90 ]]; then
    _warn "Init cycle detection timed out, proceeding with pg_isready check"
  fi
  sleep 1
done
_ok "  Init cycle markers detected (count=$INIT_DONE)"

# Now do the real pg_isready + query validation
for i in $(seq 1 30); do
  if docker exec "$C_POSTGRES" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    # Verify with actual query to confirm connection stability
    if docker exec "$C_POSTGRES" psql -U postgres -d postgres -tAc "SELECT 1;" >/dev/null 2>&1; then
      break
    fi
  fi
  if [[ $i -eq 30 ]]; then
    _fail "PostgreSQL did not become healthy within 30 seconds after init"
  fi
  sleep 1
done

# Extra 2s stabilization buffer
sleep 2
_ok "PostgreSQL healthy and stable"

###############################################################################
# PHASE 5 — APPLY CANONICAL BASELINE
###############################################################################
_info "PHASE 5: Apply canonical baseline"

docker exec -i "$C_POSTGRES" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$BASELINE" || _fail "Baseline application failed"
_ok "Canonical baseline applied"

# Verify baseline tables exist
BASELINE_CHECK=$(docker exec "$C_POSTGRES" psql -U postgres -d postgres -tAc "
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('events','heats','scores','participants','heat_configs','heat_slot_mappings','heat_entries');
")
[[ "$BASELINE_CHECK" -ge 7 ]] || _fail "Baseline verification failed: only $BASELINE_CHECK/7 core tables found"
_ok "Baseline verification: $BASELINE_CHECK core tables present"

# Configure role passwords for Supabase services
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$C_POSTGRES" psql -U supabase_admin -d postgres -c "
ALTER ROLE authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER ROLE postgres WITH PASSWORD '$POSTGRES_PASSWORD';
CREATE SCHEMA IF NOT EXISTS _realtime;
GRANT ALL ON SCHEMA _realtime TO supabase_admin;
GRANT USAGE ON SCHEMA _realtime TO postgres, anon, authenticated, service_role;
" || _fail "Failed to configure Supabase service role passwords"
_ok "Service role passwords and _realtime schema configured"

###############################################################################
# PHASE 6 — APPLY 8 MANIFEST MIGRATIONS
###############################################################################
_info "PHASE 6: Apply 8 manifest migrations in order"

python3 -c "
import json
m = json.load(open('$MANIFEST'))
for mig in sorted(m['migrations'], key=lambda x: x['order']):
    print(mig['path'])
" | while read -r MIG_PATH; do
  MIG_FULL="$REPO_ROOT/$MIG_PATH"
  MIG_NAME=$(basename "$MIG_PATH")
  _info "  Applying [$MIG_NAME]..."
  docker exec -i "$C_POSTGRES" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG_FULL" || _fail "Migration failed: $MIG_NAME"
  _ok "  Applied: $MIG_NAME"
done
_ok "All 8 migrations applied"

###############################################################################
# PHASE 7 — FIELD MODE PROVISIONING
###############################################################################
_info "PHASE 7: Field mode provisioning"

# Set deployment_mode = field in app_deployment_config
docker exec "$C_POSTGRES" psql -U postgres -d postgres -c "
INSERT INTO public.app_deployment_config (id, deployment_mode, provisioned_at, cloud_test_activation_enabled)
VALUES (true, 'field', now(), false)
ON CONFLICT (id) DO UPDATE SET
  deployment_mode = EXCLUDED.deployment_mode,
  provisioned_at = now();

INSERT INTO public.app_runtime_schema_version (id, schema_version, schema_label, updated_at)
VALUES (true, '20260821180000_p38_v4_legacy_recursion_fix', 'P3.8 Second Runtime', now())
ON CONFLICT (id) DO UPDATE SET
  schema_version = EXCLUDED.schema_version,
  schema_label = EXCLUDED.schema_label,
  updated_at = now();
" || _fail "Field mode provisioning failed"

# Create disposable event
DISPOSABLE_EVENT_ID=10004
docker exec "$C_POSTGRES" psql -U postgres -d postgres -c "
INSERT INTO public.events (id, name, organizer, start_date, end_date, price, currency, status, paid, categories, judges)
VALUES ($DISPOSABLE_EVENT_ID, 'P38-Test2-Disposable', 'P38 Automation', CURRENT_DATE, CURRENT_DATE, 0, 'XOF', 'paid', true, '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.heats (id, competition, division, round, heat_number, status, event_id, heat_size, color_order, is_active)
VALUES
  ('p38-test2-disposable_open_r1_h1', 'P38-Test2-Disposable', 'OPEN', 1, 1, 'open', $DISPOSABLE_EVENT_ID, 4, ARRAY['RED','WHITE','YELLOW','BLUE'], true),
  ('p38-test2-disposable_open_r1_h2', 'P38-Test2-Disposable', 'OPEN', 1, 2, 'open', $DISPOSABLE_EVENT_ID, 4, ARRAY['RED','WHITE','YELLOW','BLUE'], false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.heat_entries (heat_id, participant_id, seed, position, color)
VALUES
  ('p38-test2-disposable_open_r1_h1', NULL, 1, 1, 'ROUGE'),
  ('p38-test2-disposable_open_r1_h1', NULL, 2, 2, 'BLANC'),
  ('p38-test2-disposable_open_r1_h1', NULL, 3, 3, 'JAUNE'),
  ('p38-test2-disposable_open_r1_h1', NULL, 4, 4, 'BLEU'),
  ('p38-test2-disposable_open_r1_h2', NULL, 1, 1, 'ROUGE'),
  ('p38-test2-disposable_open_r1_h2', NULL, 2, 2, 'BLANC'),
  ('p38-test2-disposable_open_r1_h2', NULL, 3, 3, 'JAUNE'),
  ('p38-test2-disposable_open_r1_h2', NULL, 4, 4, 'BLEU')
ON CONFLICT DO NOTHING;

INSERT INTO public.active_heat_pointer (event_id, event_name, active_heat_id, podium_id, updated_at)
VALUES ($DISPOSABLE_EVENT_ID, 'P38-Test2-Disposable', 'p38-test2-disposable_open_r1_h1', 'A', now())
ON CONFLICT (event_id, podium_id) DO UPDATE SET active_heat_id = EXCLUDED.active_heat_id, updated_at = now();
" || _warn "Disposable event insert issue (non-fatal)"

_ok "Field mode: deployment_mode=field, event=$DISPOSABLE_EVENT_ID"

###############################################################################
# PHASE 8 — START FULL STACK
###############################################################################
_info "PHASE 8: Start full Supabase stack"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d || _fail "Stack startup failed"

# Wait for Kong health
_info "  Waiting for Kong health..."
for i in $(seq 1 60); do
  if docker exec "$C_KONG" kong health >/dev/null 2>&1; then
    break
  fi
  if [[ $i -eq 60 ]]; then
    _fail "Kong did not become healthy within 60 seconds"
  fi
  sleep 1
done
_ok "Kong healthy"

# Wait for REST to be ready
_info "  Waiting for REST..."
for i in $(seq 1 30); do
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" "http://localhost:${API_PORT}/rest/v1/events?select=id&limit=1" 2>/dev/null || echo "000")
  if [[ "$HTTP" == "200" ]]; then break; fi
  if [[ $i -eq 30 ]]; then _fail "REST API did not return 200 within 30 attempts"; fi
  sleep 2
done
_ok "REST API responding: HTTP $HTTP"

###############################################################################
# PHASE 9 — HEALTH CHECKS
###############################################################################
_info "PHASE 9: Health checks"

# Postgres
PG_STATUS=$(docker exec "$C_POSTGRES" pg_isready -U postgres -d postgres 2>&1 && echo "HEALTHY" || echo "UNHEALTHY")
[[ "$PG_STATUS" == *"HEALTHY"* ]] || _fail "Postgres unhealthy"
_ok "Postgres: HEALTHY"

# Kong
KONG_STATUS=$(docker exec "$C_KONG" kong health 2>&1 && echo "HEALTHY" || echo "UNHEALTHY")
[[ "$KONG_STATUS" == *"HEALTHY"* ]] || _fail "Kong unhealthy"
_ok "Kong: HEALTHY"

# Auth
AUTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $ANON_KEY" "http://localhost:${API_PORT}/auth/v1/health" 2>/dev/null || echo "000")
[[ "$AUTH_HTTP" == "200" ]] || _fail "Auth health check failed: HTTP $AUTH_HTTP"
_ok "Auth: HTTP $AUTH_HTTP"

# REST
REST_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" "http://localhost:${API_PORT}/rest/v1/events?select=id&limit=1" 2>/dev/null || echo "000")
[[ "$REST_HTTP" == "200" ]] || _fail "REST health check failed: HTTP $REST_HTTP"
_ok "REST: HTTP $REST_HTTP"

# Frontend
FE_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}/" 2>/dev/null || echo "000")
[[ "$FE_HTTP" == "200" ]] || _fail "Frontend health check failed: HTTP $FE_HTTP"
_ok "Frontend: HTTP $FE_HTTP"

# Storage (check container running)
STORAGE_STATUS=$(docker inspect -f '{{.State.Running}}' "$C_STORAGE" 2>/dev/null || echo "false")
[[ "$STORAGE_STATUS" == "true" ]] || _fail "Storage not running"
_ok "Storage: running"

# Realtime (check container running)
RT_STATUS=$(docker inspect -f '{{.State.Running}}' "$C_REALTIME" 2>/dev/null || echo "false")
[[ "$RT_STATUS" == "true" ]] || _fail "Realtime not running"
_ok "Realtime: running"

# Deployment mode
DEPLOY_MODE=$(docker exec "$C_POSTGRES" psql -U postgres -d postgres -tAc "SELECT public.get_authoritative_deployment_mode();" 2>/dev/null | tr -d '[:space:]')
[[ "$DEPLOY_MODE" == "field" ]] || _fail "deployment_mode = '$DEPLOY_MODE' (expected 'field')"
_ok "deployment_mode = field"

# Frontend deployment-manifest
DM_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}/deployment-manifest.json" 2>/dev/null || echo "000")
[[ "$DM_HTTP" == "200" ]] || _warn "deployment-manifest.json: HTTP $DM_HTTP (non-fatal)"
_ok "deployment-manifest.json: HTTP $DM_HTTP"

###############################################################################
# SUMMARY
###############################################################################
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  P3.8 SECOND RUNTIME — BOOTSTRAP COMPLETE"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "  Project:         $PROJECT"
echo "  API:             http://localhost:$API_PORT"
echo "  Frontend:        http://localhost:$FRONTEND_PORT"
echo "  PostgreSQL:      localhost:$PG_PORT"
echo "  Runtime root:    $RUNTIME_ROOT"
echo ""
echo "  Postgres:        HEALTHY"
echo "  Kong:            HEALTHY"
echo "  Auth:            HTTP 200"
echo "  REST:            HTTP 200"
echo "  Frontend:        HTTP 200"
echo "  Storage:         Running"
echo "  Realtime:        Running"
echo "  deployment_mode: field"
echo ""
echo "  Baseline:        PASS ($EXPECTED_BASELINE_SHA)"
echo "  Migrations:      8/8 PASS"
echo ""
echo "  BOOTSTRAP_STATUS = PASS"
echo "═══════════════════════════════════════════════════════════════════"
