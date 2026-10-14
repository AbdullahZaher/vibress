#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Database Restore
# ==============================================================================
# Usage:
#   ./scripts/restore.sh <path-to-backup.sql.gz> [target_database] [--confirm] [--skip-checksum]
#
# Arguments:
#   1: path-to-backup.sql.gz  Required. Path to the compressed backup file.
#   2: target_database        Optional. Target database name (default: POSTGRES_DB or 'vibress')
#   --confirm                 Confirm destructive operation (required in non-interactive mode)
#   --skip-checksum           Bypass SHA-256 integrity verification
#
# Environment Overrides:
#   CONFIRM_DESTRUCTIVE_RESTORE  Set to 'yes' or 'true' to confirm non-interactive restore
#   COMPOSE_FILE                 Docker compose file to target (default: compose.prod.yml if exists, else compose.dev.yml)
#   POSTGRES_SERVICE             Docker compose postgres service name (default: postgres)
#   POSTGRES_HOST                Explicit PostgreSQL host (if set, host psql is preferred)
#   POSTGRES_PORT                Explicit PostgreSQL port
#   POSTGRES_USER                PostgreSQL username (default: vibress)
#   POSTGRES_DB                  Default database name (default: vibress)
#   POSTGRES_PASSWORD            PostgreSQL password (default: vibress)
# ==============================================================================

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz> [target_database] [--confirm] [--skip-checksum]" >&2
  exit 1
fi

BACKUP_FILE="$1"
shift

TARGET_DB=""
CONFIRMED=0
SKIP_CHECKSUM=0

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)
      CONFIRMED=1
      ;;
    --skip-checksum)
      SKIP_CHECKSUM=1
      ;;
    *)
      if [ -z "${TARGET_DB}" ]; then
        TARGET_DB="$1"
      else
        echo "Unknown option: $1" >&2
        exit 1
      fi
      ;;
  esac
  shift
done

TARGET_DB="${TARGET_DB:-${POSTGRES_DB:-vibress}}"

if [ "${CONFIRM_DESTRUCTIVE_RESTORE:-no}" = "yes" ] || [ "${CONFIRM_DESTRUCTIVE_RESTORE:-no}" = "true" ]; then
  CONFIRMED=1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "================================================================================"
echo " Starting Vibress Database Restore"
echo " Source Backup: ${BACKUP_FILE}"
echo " Target Database: ${TARGET_DB}"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"

# --- Step 1: Pre-restore Checksum Verification ---
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ "${SKIP_CHECKSUM}" -eq 1 ]; then
  echo "Warning: Checksum verification explicitly bypassed via --skip-checksum."
elif [ -f "${CHECKSUM_FILE}" ]; then
  echo "Verifying SHA-256 integrity checksum..."
  BACKUP_DIR=$(dirname "${BACKUP_FILE}")
  BACKUP_BASENAME=$(basename "${BACKUP_FILE}")
  CHECKSUM_BASENAME=$(basename "${CHECKSUM_FILE}")

  CHECKSUM_PASSED=0
  if command -v sha256sum >/dev/null 2>&1; then
    if (cd "${BACKUP_DIR}" && sha256sum -c "${CHECKSUM_BASENAME}" >/dev/null 2>&1); then
      CHECKSUM_PASSED=1
    fi
  elif command -v shasum >/dev/null 2>&1; then
    if (cd "${BACKUP_DIR}" && shasum -a 256 -c "${CHECKSUM_BASENAME}" >/dev/null 2>&1); then
      CHECKSUM_PASSED=1
    fi
  else
    echo "Warning: Neither sha256sum nor shasum available on host."
  fi

  if [ "${CHECKSUM_PASSED}" -eq 1 ]; then
    echo "✓ SHA-256 integrity checksum verified successfully."
  else
    echo "Error: Checksum verification FAILED for ${BACKUP_FILE}!" >&2
    echo "The backup file may be corrupt or tampered with. Aborting restore." >&2
    exit 1
  fi
else
  echo "Warning: No accompanying .sha256 file found. Proceeding with caution."
fi

# --- Step 2: Validate Archive Gzip Structure ---
echo "Validating archive format and uncompressed stream integrity..."
if ! gzip -t "${BACKUP_FILE}"; then
  echo "Error: Backup archive ${BACKUP_FILE} is corrupted (gzip integrity test failed)." >&2
  exit 1
fi

# Verify SQL signature in archive
SQL_HEADER=$(gunzip -c "${BACKUP_FILE}" | head -n 40 || true)
if ! echo "${SQL_HEADER}" | grep -qE 'PostgreSQL database dump|SET statement_timeout|CREATE TABLE|SET client_encoding'; then
  echo "Error: Archive does not contain valid PostgreSQL dump data. Aborting restore." >&2
  exit 1
fi
echo "✓ Archive format and SQL structure verified."

# --- Step 3: Target Resolution ---
PG_USER="${POSTGRES_USER:-vibress}"
PG_PASSWORD="${POSTGRES_PASSWORD:-vibress}"

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
RESTORE_MODE=""

if [ -n "${POSTGRES_HOST:-}" ]; then
  PG_PORT="${POSTGRES_PORT:-5432}"
  RESTORE_MODE="host"
  TARGET_DESC="host ${POSTGRES_HOST}:${PG_PORT}"
elif [ -n "${RESOLVED_COMPOSE}" ] && docker compose -f "${RESOLVED_COMPOSE}" ps -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; then
  RESTORE_MODE="compose"
  TARGET_DESC="Docker Compose service '${POSTGRES_SERVICE}' (${RESOLVED_COMPOSE})"
elif command -v psql >/dev/null 2>&1 && [ -z "${RESOLVED_COMPOSE}" ]; then
  POSTGRES_HOST="localhost"
  PG_PORT="${POSTGRES_PORT:-5432}"
  RESTORE_MODE="host"
  TARGET_DESC="local psql at ${POSTGRES_HOST}:${PG_PORT}"
fi

if [ -z "${RESTORE_MODE}" ]; then
  echo "Error: No valid PostgreSQL destination found for restore." >&2
  echo "Refusing to target arbitrary or unverified postgres containers." >&2
  exit 1
fi

# --- Step 4: Destructive Confirmation Gate ---
echo -e "\n--------------------------------------------------------------------------------"
echo " ATTENTION: DESTRUCTIVE OPERATION"
echo " Destination: ${TARGET_DESC} -> Database '${TARGET_DB}'"
echo " Existing tables in '${TARGET_DB}' will be dropped/overwritten by the backup."
echo "--------------------------------------------------------------------------------"

if [ "${CONFIRMED}" -ne 1 ]; then
  if [ -t 0 ]; then
    read -r -p "Type 'RESTORE' to proceed with database overwrite: " PROMPT_ANSWER
    if [ "${PROMPT_ANSWER}" != "RESTORE" ]; then
      echo "Restore operation cancelled by operator."
      exit 1
    fi
  else
    echo "Error: Destructive restore requires explicit confirmation in non-interactive mode." >&2
    echo "Provide '--confirm' as an argument or set CONFIRM_DESTRUCTIVE_RESTORE=yes in the environment." >&2
    exit 1
  fi
fi

# --- Step 5: Execute Restore ---
echo "Applying database restore with ON_ERROR_STOP=1..."

# Export PGPASSWORD to ensure child psql processes receive credentials reliably
export PGPASSWORD="${PG_PASSWORD}"

if [ "${RESTORE_MODE}" = "compose" ]; then
  # Stream through docker compose exec with ON_ERROR_STOP=1 and explicit env credentials
  gunzip -c "${BACKUP_FILE}" | docker compose -f "${RESOLVED_COMPOSE}" exec -T \
    -e PGPASSWORD="${PG_PASSWORD}" \
    "${POSTGRES_SERVICE}" \
    psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${TARGET_DB}"
elif [ "${RESTORE_MODE}" = "host" ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "Error: psql client is required for host restore mode but was not found in PATH." >&2
    exit 1
  fi
  gunzip -c "${BACKUP_FILE}" | psql \
    -v ON_ERROR_STOP=1 \
    -h "${POSTGRES_HOST}" \
    -p "${PG_PORT:-5432}" \
    -U "${PG_USER}" \
    -d "${TARGET_DB}"
fi

echo "================================================================================"
echo "✓ Vibress Database Restore Completed Successfully: ${TARGET_DB}"
echo "================================================================================"
