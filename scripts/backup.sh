#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Database & Content Backup
# ==============================================================================
# Usage:
#   ./scripts/backup.sh [target_directory] [--with-content]
#
# Environment Overrides:
#   COMPOSE_FILE        Docker compose file to target (default: compose.prod.yml if exists, else compose.dev.yml)
#   POSTGRES_SERVICE    Docker compose postgres service name (default: postgres)
#   POSTGRES_HOST       Explicit PostgreSQL host (if set, host pg_dump is preferred)
#   POSTGRES_PORT       Explicit PostgreSQL port
#   POSTGRES_USER       PostgreSQL username (default: vibress)
#   POSTGRES_DB         PostgreSQL database name (default: vibress)
#   POSTGRES_PASSWORD   PostgreSQL password (default: vibress)
#   BACKUP_CONTENT      If set to 1, also backs up local media and themes directory
# ==============================================================================

BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
WITH_CONTENT=0

for arg in "$@"; do
  if [ "$arg" = "--with-content" ]; then
    WITH_CONTENT=1
  fi
done

if [ "${BACKUP_CONTENT:-0}" = "1" ]; then
  WITH_CONTENT=1
fi

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
FILENAME="vibress_backup_${TIMESTAMP}.sql.gz"
TARGET_FILE="${BACKUP_DIR}/${FILENAME}"
TARGET_FILE_TMP="${TARGET_FILE}.tmp.$$"

mkdir -p "${BACKUP_DIR}"

# Ensure temporary files are cleaned up on error or interruption
cleanup() {
  if [ -f "${TARGET_FILE_TMP}" ]; then
    rm -f "${TARGET_FILE_TMP}"
  fi
}
trap cleanup EXIT ERR INT TERM

echo "================================================================================"
echo " Starting Vibress Production Database Backup: ${TIMESTAMP} UTC"
echo " Destination: ${TARGET_FILE}"
echo "================================================================================"

PG_USER="${POSTGRES_USER:-vibress}"
PG_DB="${POSTGRES_DB:-vibress}"
PG_PASSWORD="${POSTGRES_PASSWORD:-vibress}"

# Resolve target compose file if not explicitly set
RESOLVED_COMPOSE=""
if [ -n "${COMPOSE_FILE:-}" ] && [ -f "${COMPOSE_FILE}" ]; then
  RESOLVED_COMPOSE="${COMPOSE_FILE}"
elif [ -f "compose.prod.yml" ] && docker compose -f "compose.prod.yml" ps -q "${POSTGRES_SERVICE:-postgres}" 2>/dev/null | grep -q .; then
  RESOLVED_COMPOSE="compose.prod.yml"
elif [ -f "compose.dev.yml" ] && docker compose -f "compose.dev.yml" ps -q "${POSTGRES_SERVICE:-postgres}" 2>/dev/null | grep -q .; then
  RESOLVED_COMPOSE="compose.dev.yml"
elif [ -f "compose.prod.yml" ]; then
  RESOLVED_COMPOSE="compose.prod.yml"
elif [ -f "compose.dev.yml" ]; then
  RESOLVED_COMPOSE="compose.dev.yml"
fi

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"

# Determine execution strategy
BACKUP_MODE=""
CONTAINER_ID=""

if [ -n "${POSTGRES_HOST:-}" ]; then
  # Explicit host provided (e.g. AWS RDS / Google Cloud SQL / remote database)
  PG_PORT="${POSTGRES_PORT:-5432}"
  echo "Targeting explicit PostgreSQL host: ${POSTGRES_HOST}:${PG_PORT} (DB: ${PG_DB})"
  BACKUP_MODE="host"
elif [ -n "${RESOLVED_COMPOSE}" ] && docker compose -f "${RESOLVED_COMPOSE}" ps -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; then
  # Verified Docker Compose service is running
  CONTAINER_ID=$(docker compose -f "${RESOLVED_COMPOSE}" ps -q "${POSTGRES_SERVICE}" | head -n 1)
  echo "Targeting Docker Compose service '${POSTGRES_SERVICE}' in '${RESOLVED_COMPOSE}' (Container: ${CONTAINER_ID})"
  BACKUP_MODE="compose"
elif [ -n "${RESOLVED_COMPOSE}" ] && docker compose -f "${RESOLVED_COMPOSE}" ps --all -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; then
  # Compose service container exists but may be stopped; use docker compose exec / run
  echo "Targeting Docker Compose service '${POSTGRES_SERVICE}' via '${RESOLVED_COMPOSE}'"
  BACKUP_MODE="compose"
elif command -v pg_dump >/dev/null 2>&1 && [ -z "${RESOLVED_COMPOSE}" ]; then
  PG_HOST="localhost"
  PG_PORT="${POSTGRES_PORT:-5432}"
  echo "Falling back to local pg_dump on ${PG_HOST}:${PG_PORT}..."
  BACKUP_MODE="host"
fi

if [ -z "${BACKUP_MODE}" ]; then
  echo "Error: No valid PostgreSQL target found." >&2
  echo "Must provide either:" >&2
  echo "  1) A running Docker Compose postgres service in '${RESOLVED_COMPOSE:-compose.prod.yml}', or" >&2
  echo "  2) POSTGRES_HOST set to an accessible PostgreSQL host with pg_dump available." >&2
  echo "Refusing to target arbitrary or unknown postgres containers." >&2
  exit 1
fi

echo "Executing pg_dump stream with compression..."

if [ "${BACKUP_MODE}" = "compose" ]; then
  # Execute pg_dump inside the identified compose container
  docker compose -f "${RESOLVED_COMPOSE}" exec -T \
    -e PGPASSWORD="${PG_PASSWORD}" \
    "${POSTGRES_SERVICE}" \
    pg_dump -U "${PG_USER}" -d "${PG_DB}" --clean --if-exists --no-owner --no-privileges \
    | gzip -c > "${TARGET_FILE_TMP}"
elif [ "${BACKUP_MODE}" = "host" ]; then
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "Error: pg_dump client is required for host backup mode but was not found in PATH." >&2
    exit 1
  fi
  PGPASSWORD="${PG_PASSWORD}" pg_dump \
    -h "${POSTGRES_HOST:-localhost}" \
    -p "${PG_PORT:-5432}" \
    -U "${PG_USER}" \
    -d "${PG_DB}" \
    --clean --if-exists --no-owner --no-privileges \
    | gzip -c > "${TARGET_FILE_TMP}"
fi

# --- Structural and Data Integrity Validation ---
echo "Validating backup archive integrity..."

# 1. Non-empty check (an empty gzip stream is ~20 bytes, a real schema dump is at least several kilobytes)
if [ ! -f "${TARGET_FILE_TMP}" ]; then
  echo "Error: Backup output file was not created." >&2
  exit 1
fi

FILE_BYTES=$(wc -c < "${TARGET_FILE_TMP}" | tr -d ' ')
if [ "${FILE_BYTES}" -lt 200 ]; then
  echo "Error: Backup file is too small (${FILE_BYTES} bytes); pg_dump likely produced empty or corrupt output." >&2
  exit 1
fi

# 2. Gzip stream integrity verification
if ! gzip -t "${TARGET_FILE_TMP}"; then
  echo "Error: Gzip archive integrity check failed on ${TARGET_FILE_TMP}." >&2
  exit 1
fi

# 3. SQL content structural signature verification
SQL_HEADER=$(gunzip -c "${TARGET_FILE_TMP}" | head -n 40 || true)
if ! echo "${SQL_HEADER}" | grep -qE 'PostgreSQL database dump|SET statement_timeout|CREATE TABLE|SET client_encoding'; then
  echo "Error: Decompressed archive does not contain valid PostgreSQL dump signatures." >&2
  echo "Initial output snippet:" >&2
  echo "${SQL_HEADER}" | head -n 10 >&2
  exit 1
fi

# Atomic publication: move validated temp file to final target
mv "${TARGET_FILE_TMP}" "${TARGET_FILE}"
chmod 600 "${TARGET_FILE}"

# Generate SHA-256 Checksum
echo "Generating SHA-256 integrity checksum..."
CHECKSUM_FILE="${TARGET_FILE}.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "${BACKUP_DIR}" && sha256sum "${FILENAME}" > "${FILENAME}.sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "${BACKUP_DIR}" && shasum -a 256 "${FILENAME}" > "${FILENAME}.sha256")
fi
chmod 600 "${CHECKSUM_FILE}"

FILESIZE=$(ls -lh "${TARGET_FILE}" | awk '{print $5}')
echo "✓ Database backup created and verified: ${TARGET_FILE} (${FILESIZE})"
echo "✓ Checksum created: ${CHECKSUM_FILE}"

# --- Optional Persistent Content (Media & Themes) Backup ---
if [ "${WITH_CONTENT}" -eq 1 ]; then
  CONTENT_DIR=""
  for candidate in "./content" "/repo/content" "${STORAGE_LOCAL_ROOT:-}"; do
    if [ -n "${candidate}" ] && [ -d "${candidate}" ]; then
      CONTENT_DIR="${candidate}"
      break
    fi
  done

  if [ -n "${CONTENT_DIR}" ]; then
    CONTENT_FILENAME="vibress_content_${TIMESTAMP}.tar.gz"
    CONTENT_TARGET="${BACKUP_DIR}/${CONTENT_FILENAME}"
    echo "Backing up persistent content from '${CONTENT_DIR}'..."
    tar -czf "${CONTENT_TARGET}" -C "$(dirname "${CONTENT_DIR}")" "$(basename "${CONTENT_DIR}")"
    chmod 600 "${CONTENT_TARGET}"
    if command -v sha256sum >/dev/null 2>&1; then
      (cd "${BACKUP_DIR}" && sha256sum "${CONTENT_FILENAME}" > "${CONTENT_FILENAME}.sha256")
    elif command -v shasum >/dev/null 2>&1; then
      (cd "${BACKUP_DIR}" && shasum -a 256 "${CONTENT_FILENAME}" > "${CONTENT_FILENAME}.sha256")
    fi
    chmod 600 "${CONTENT_TARGET}.sha256"
    CONTENT_SIZE=$(ls -lh "${CONTENT_TARGET}" | awk '{print $5}')
    echo "✓ Persistent content backup created: ${CONTENT_TARGET} (${CONTENT_SIZE})"
  else
    echo "Note: No local content directory found to back up; skipping content archive."
  fi
fi

# Reset trap
trap - EXIT ERR INT TERM
echo "================================================================================"
echo " Vibress Backup Completed Successfully at $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"
