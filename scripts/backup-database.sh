#!/usr/bin/env bash
set -euo pipefail

# Vibress Production Database Backup Script
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="vibress_backup_${TIMESTAMP}.sql.gz"
TARGET_FILE="${BACKUP_DIR}/${FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "Starting database backup at ${TIMESTAMP}..."
PGPASSWORD="${POSTGRES_PASSWORD:-vibress}" pg_dump \
  -h "${POSTGRES_HOST:-localhost}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-vibress}" \
  -d "${POSTGRES_DB:-vibress}" \
  --clean --if-exists --no-owner --no-privileges | gzip > "${TARGET_FILE}"

echo "Generating SHA-256 checksum..."
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${TARGET_FILE}" > "${TARGET_FILE}.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${TARGET_FILE}" > "${TARGET_FILE}.sha256"
fi

echo "Backup completed successfully: ${TARGET_FILE}"
