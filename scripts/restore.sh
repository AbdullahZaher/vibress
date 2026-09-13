#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Database Restore
# ==============================================================================
# Usage:
#   ./scripts/restore.sh <path-to-backup.sql.gz>
# ==============================================================================

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "=================================================="
echo " Starting Vibress Database Restore"
echo " Source: ${BACKUP_FILE}"
echo "=================================================="

if [ -f "${BACKUP_FILE}.sha256" ]; then
  echo "Verifying SHA-256 checksum..."
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${BACKUP_FILE}.sha256"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${BACKUP_FILE}.sha256"
  fi
  echo "✓ Checksum verification passed."
else
  echo "Warning: No .sha256 file found. Proceeding without checksum check."
fi

PG_USER="${POSTGRES_USER:-vibress}"
PG_DB="${POSTGRES_DB:-vibress}"
PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-5433}"
PG_PASSWORD="${POSTGRES_PASSWORD:-vibress}"

if command -v psql >/dev/null 2>&1; then
  echo "Restoring database via host psql client..."
  PGPASSWORD="${PG_PASSWORD}" gunzip -c "${BACKUP_FILE}" | psql \
    -h "${PG_HOST}" \
    -p "${PG_PORT}" \
    -U "${PG_USER}" \
    -d "${PG_DB}"
elif docker ps --format '{{.Names}}' | grep -qE 'vibress.*postgres|postgres'; then
  CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep -E 'vibress.*postgres' | head -n 1 || docker ps --format '{{.Names}}' | grep 'postgres' | head -n 1)
  echo "Restoring database via Docker container (${CONTAINER_NAME})..."
  gunzip -c "${BACKUP_FILE}" | docker exec -i -e PGPASSWORD="${PG_PASSWORD}" "${CONTAINER_NAME}" \
    psql -U "${PG_USER}" -d "${PG_DB}"
else
  echo "Error: Neither psql nor a running PostgreSQL Docker container was found."
  exit 1
fi

echo "✓ Database restore completed successfully."
