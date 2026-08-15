#!/usr/bin/env bash
set -euo pipefail

# Vibress Production Database Restore Script
if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

if [ -f "${BACKUP_FILE}.sha256" ]; then
  echo "Verifying SHA-256 checksum..."
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${BACKUP_FILE}.sha256"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${BACKUP_FILE}.sha256"
  fi
fi

echo "Restoring database from ${BACKUP_FILE}..."
PGPASSWORD="${POSTGRES_PASSWORD:-vibress}" gunzip -c "${BACKUP_FILE}" | psql \
  -h "${POSTGRES_HOST:-localhost}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-vibress}" \
  -d "${POSTGRES_DB:-vibress}"

echo "Database restore completed successfully."
