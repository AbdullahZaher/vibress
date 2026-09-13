#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Database Backup
# ==============================================================================
# Usage:
#   ./scripts/backup.sh [target_directory]
# ==============================================================================

BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="vibress_backup_${TIMESTAMP}.sql.gz"
TARGET_FILE="${BACKUP_DIR}/${FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "=================================================="
echo " Starting Vibress Database Backup: ${TIMESTAMP}"
echo " Destination: ${TARGET_FILE}"
echo "=================================================="

PG_USER="${POSTGRES_USER:-vibress}"
PG_DB="${POSTGRES_DB:-vibress}"
PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-5433}"
PG_PASSWORD="${POSTGRES_PASSWORD:-vibress}"

if command -v pg_dump >/dev/null 2>&1; then
  echo "Using host pg_dump client..."
  PGPASSWORD="${PG_PASSWORD}" pg_dump \
    -h "${PG_HOST}" \
    -p "${PG_PORT}" \
    -U "${PG_USER}" \
    -d "${PG_DB}" \
    --clean --if-exists --no-owner --no-privileges | gzip > "${TARGET_FILE}"
elif docker ps --format '{{.Names}}' | grep -qE 'vibress.*postgres|postgres'; then
  CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep -E 'vibress.*postgres' | head -n 1 || docker ps --format '{{.Names}}' | grep 'postgres' | head -n 1)
  echo "Using Docker container (${CONTAINER_NAME}) pg_dump..."
  docker exec -e PGPASSWORD="${PG_PASSWORD}" "${CONTAINER_NAME}" \
    pg_dump -U "${PG_USER}" -d "${PG_DB}" --clean --if-exists --no-owner --no-privileges | gzip > "${TARGET_FILE}"
else
  echo "Error: Neither pg_dump nor a running PostgreSQL Docker container was found."
  exit 1
fi

echo "Generating SHA-256 checksum..."
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${TARGET_FILE}" > "${TARGET_FILE}.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${TARGET_FILE}" > "${TARGET_FILE}.sha256"
fi

FILESIZE=$(ls -lh "${TARGET_FILE}" | awk '{print $5}')
echo "✓ Backup created successfully: ${TARGET_FILE} (${FILESIZE})"
echo "✓ Checksum created: ${TARGET_FILE}.sha256"
