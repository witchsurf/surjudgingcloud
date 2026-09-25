#!/usr/bin/env bash
set -euo pipefail

HP_HOST="${SURF_HP_HOST:-192.168.1.2}"
HP_USER="${SURF_HP_USER:-admin-surfjudging}"
EVENT_ID="${SURF_HP_EVENT_ID:-all}"
RETENTION="${SURF_HP_BACKUP_RETENTION:-12}"
REMOTE_DIR="${SURF_HP_BACKUP_DIR:-surfjudging-backups}"

if [[ ! "$RETENTION" =~ ^[1-9][0-9]*$ ]]; then
  echo "SURF_HP_BACKUP_RETENTION doit être un entier positif." >&2
  exit 1
fi

SAFE_EVENT="${EVENT_ID//[^a-zA-Z0-9_-]/_}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="surfjudging_event-${SAFE_EVENT}_${TIMESTAMP}.dump"

echo "Création du snapshot PostgreSQL sur le HP ${HP_HOST}..."
ssh -o BatchMode=yes -o ConnectTimeout=5 "${HP_USER}@${HP_HOST}" \
  "set -eu
   umask 077
   mkdir -p \"\$HOME/${REMOTE_DIR}\"
   cleanup_partial() {
     rm -f -- \"\$HOME/${REMOTE_DIR}/${FILENAME}.partial\"
   }
   trap cleanup_partial EXIT HUP INT TERM
   docker exec surfjudging_postgres sh -c \
     'PGPASSWORD=\"\$POSTGRES_PASSWORD\" exec pg_dump -U supabase_admin -d postgres --format=custom --compress=6 --no-owner --no-privileges' \
     > \"\$HOME/${REMOTE_DIR}/${FILENAME}.partial\"
   test -s \"\$HOME/${REMOTE_DIR}/${FILENAME}.partial\"
   docker exec -i surfjudging_postgres pg_restore --list \
     < \"\$HOME/${REMOTE_DIR}/${FILENAME}.partial\" >/dev/null
   mv \"\$HOME/${REMOTE_DIR}/${FILENAME}.partial\" \"\$HOME/${REMOTE_DIR}/${FILENAME}\"
   trap - EXIT HUP INT TERM
   (cd \"\$HOME/${REMOTE_DIR}\" && sha256sum \"${FILENAME}\" > \"${FILENAME}.sha256\")
   cd \"\$HOME/${REMOTE_DIR}\"
   stale=\$(ls -1t surfjudging_event-*.dump 2>/dev/null | tail -n +$((RETENTION + 1)) || true)
   if [ -n \"\$stale\" ]; then
     printf '%s\n' \"\$stale\" | while IFS= read -r dump; do
       rm -f -- \"\$dump\" \"\$dump.sha256\"
     done
   fi
   sha256sum -c \"${FILENAME}.sha256\"
   ls -lh \"${FILENAME}\""

echo
echo "Snapshot terminé: ~/${REMOTE_DIR}/${FILENAME}"
echo "Rétention: ${RETENTION} snapshots maximum."
echo "Aucune donnée métier n’a été modifiée."
