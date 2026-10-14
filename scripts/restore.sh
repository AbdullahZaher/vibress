#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Database & Content Restore
# ==============================================================================
# Usage:
#   ./scripts/restore.sh <path-to-backup.sql.gz> [target_database] [options]
#
# Arguments:
#   1: path-to-backup.sql.gz  Required. Path to the compressed backup file.
#   2: target_database        Optional. Target database name (default: POSTGRES_DB or 'vibress')
#
# Options:
#   --with-content [path]     Restore persistent content (media/themes) archive.
#                             If path omitted, detects corresponding vibress_content_*.tar.gz.
#   --content-volume <name>   Target Docker volume name (default: detected vibress_content volume)
#   --content-dir <path>      Target host directory for local content
#   --confirm                 Confirm destructive operation (required in non-interactive mode)
#   --skip-checksum           Bypass SHA-256 integrity verification
#
# Environment Overrides:
#   ENV_FILE                  Path to environment file to source (default: .env if present)
#   CONFIRM_DESTRUCTIVE_RESTORE  Set to 'yes' or 'true' to confirm non-interactive restore
#   COMPOSE_FILE              Docker compose file to target (default: compose.prod.yml if exists, else compose.dev.yml)
#   POSTGRES_SERVICE          Docker compose postgres service name (default: postgres)
#   POSTGRES_HOST             Explicit PostgreSQL host (if set, host psql is preferred)
#   POSTGRES_PORT             Explicit PostgreSQL port
#   POSTGRES_USER             PostgreSQL username (default: from .env or vibress)
#   POSTGRES_DB               Default database name (default: from .env or vibress)
#   POSTGRES_PASSWORD         PostgreSQL password (default: from .env or vibress)
#   CONTENT_VOLUME            Target Docker volume name
# ==============================================================================

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz> [target_database] [--with-content [path]] [--content-volume <name>] [--confirm] [--skip-checksum]" >&2
  exit 1
fi

BACKUP_FILE=""
TARGET_DB=""
WITH_CONTENT=0
CONTENT_FILE=""
TARGET_CONTENT_VOLUME=""
TARGET_CONTENT_DIR=""
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
    --with-content)
      WITH_CONTENT=1
      if [ $# -gt 1 ] && [[ "$2" != --* ]] && [[ "$2" == *.tar.gz ]]; then
        CONTENT_FILE="$2"
        shift
      fi
      ;;
    --content-volume)
      TARGET_CONTENT_VOLUME="$2"
      shift
      ;;
    --content-dir)
      TARGET_CONTENT_DIR="$2"
      shift
      ;;
    *)
      if [ -z "${BACKUP_FILE}" ]; then
        BACKUP_FILE="$1"
      elif [ -z "${TARGET_DB}" ]; then
        TARGET_DB="$1"
      else
        echo "Unknown option: $1" >&2
        exit 1
      fi
      ;;
  esac
  shift
done

# Load environment configuration from .env if present (aligning with Docker Compose)
ENV_FILE="${ENV_FILE:-.env}"
if [ -f "${ENV_FILE}" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(echo "$line" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      val=$(echo "$val" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
      if [ -z "${!key+x}" ]; then
        export "${key}=${val}"
      fi
    fi
  done < "${ENV_FILE}"
fi

TARGET_DB="${TARGET_DB:-${POSTGRES_DB:-vibress}}"

if [ "${CONFIRM_DESTRUCTIVE_RESTORE:-no}" = "yes" ] || [ "${CONFIRM_DESTRUCTIVE_RESTORE:-no}" = "true" ]; then
  CONFIRMED=1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

# Auto-locate content archive if --with-content was requested without explicit file
if [ "${WITH_CONTENT}" -eq 1 ] && [ -z "${CONTENT_FILE}" ]; then
  BACKUP_DIR=$(dirname "${BACKUP_FILE}")
  SQL_BASENAME=$(basename "${BACKUP_FILE}")
  if [[ "${SQL_BASENAME}" =~ vibress_backup_([0-9]{8}_[0-9]{6})\.sql\.gz ]]; then
    TS="${BASH_REMATCH[1]}"
    if [ -f "${BACKUP_DIR}/vibress_content_${TS}.tar.gz" ]; then
      CONTENT_FILE="${BACKUP_DIR}/vibress_content_${TS}.tar.gz"
    fi
  fi
  if [ -z "${CONTENT_FILE}" ]; then
    LATEST_CONTENT=$(ls -t "${BACKUP_DIR}"/vibress_content_*.tar.gz 2>/dev/null | head -n 1 || true)
    if [ -n "${LATEST_CONTENT}" ] && [ -f "${LATEST_CONTENT}" ]; then
      CONTENT_FILE="${LATEST_CONTENT}"
    fi
  fi
  if [ -z "${CONTENT_FILE}" ]; then
    echo "Error: --with-content requested but no matching vibress_content_*.tar.gz found in ${BACKUP_DIR}." >&2
    exit 1
  fi
fi

echo "================================================================================"
echo " Starting Vibress Production Restore"
echo " Source DB Backup: ${BACKUP_FILE}"
echo " Target Database:  ${TARGET_DB}"
if [ "${WITH_CONTENT}" -eq 1 ]; then
  echo " Source Content:   ${CONTENT_FILE}"
fi
echo " Date:             $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"

# --- Step 1: Pre-restore Database Checksum Verification ---
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ "${SKIP_CHECKSUM}" -eq 1 ]; then
  echo "Warning: Database checksum verification explicitly bypassed via --skip-checksum."
elif [ -f "${CHECKSUM_FILE}" ]; then
  echo "Verifying database SHA-256 integrity checksum..."
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
    echo "✓ Database SHA-256 integrity checksum verified successfully."
  else
    echo "Error: Checksum verification FAILED for ${BACKUP_FILE}!" >&2
    echo "The backup file may be corrupt or tampered with. Aborting restore." >&2
    exit 1
  fi
else
  echo "Warning: No accompanying database .sha256 file found. Proceeding with caution."
fi

# --- Step 2: Validate Database Archive Gzip Structure ---
echo "Validating database archive format and uncompressed stream integrity..."
if ! gzip -t "${BACKUP_FILE}"; then
  echo "Error: Backup archive ${BACKUP_FILE} is corrupted (gzip integrity test failed)." >&2
  exit 1
fi

SQL_HEADER=$(gunzip -c "${BACKUP_FILE}" | head -n 40 || true)
if ! echo "${SQL_HEADER}" | grep -qE 'PostgreSQL database dump|SET statement_timeout|CREATE TABLE|SET client_encoding'; then
  echo "Error: Archive does not contain valid PostgreSQL dump data. Aborting restore." >&2
  exit 1
fi
echo "✓ Database archive format and SQL structure verified."

# --- Step 3: Validate Content Archive If Requested ---
if [ "${WITH_CONTENT}" -eq 1 ]; then
  echo "Validating persistent content archive integrity..."
  if [ ! -f "${CONTENT_FILE}" ]; then
    echo "Error: Content backup file not found: ${CONTENT_FILE}" >&2
    exit 1
  fi

  CONTENT_CHECKSUM="${CONTENT_FILE}.sha256"
  if [ "${SKIP_CHECKSUM}" -eq 1 ]; then
    echo "Warning: Content checksum verification explicitly bypassed."
  elif [ -f "${CONTENT_CHECKSUM}" ]; then
    C_DIR=$(dirname "${CONTENT_FILE}")
    C_BASE=$(basename "${CONTENT_FILE}")
    C_CHK_BASE=$(basename "${CONTENT_CHECKSUM}")
    C_PASSED=0
    if command -v sha256sum >/dev/null 2>&1; then
      if (cd "${C_DIR}" && sha256sum -c "${C_CHK_BASE}" >/dev/null 2>&1); then
        C_PASSED=1
      fi
    elif command -v shasum >/dev/null 2>&1; then
      if (cd "${C_DIR}" && shasum -a 256 -c "${C_CHK_BASE}" >/dev/null 2>&1); then
        C_PASSED=1
      fi
    fi
    if [ "${C_PASSED}" -eq 1 ]; then
      echo "✓ Content archive SHA-256 checksum verified."
    else
      echo "Error: Content checksum verification FAILED for ${CONTENT_FILE}!" >&2
      exit 1
    fi
  fi

  if ! gzip -t "${CONTENT_FILE}"; then
    echo "Error: Content archive ${CONTENT_FILE} failed gzip integrity check." >&2
    exit 1
  fi
  if ! tar -tzf "${CONTENT_FILE}" >/dev/null 2>&1; then
    echo "Error: Content archive ${CONTENT_FILE} failed tar table check." >&2
    exit 1
  fi
  echo "✓ Content archive verified."
fi

# --- Step 4: Target Resolution ---
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
  CONTAINER_ID=$(docker compose -f "${RESOLVED_COMPOSE}" ps -q "${POSTGRES_SERVICE}" | head -n 1)
  C_PASS=$(docker inspect "${CONTAINER_ID}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^POSTGRES_PASSWORD=' | cut -d= -f2- || true)
  [ -n "${C_PASS}" ] && PG_PASSWORD="${C_PASS}"
  C_USER=$(docker inspect "${CONTAINER_ID}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^POSTGRES_USER=' | cut -d= -f2- || true)
  [ -n "${C_USER}" ] && PG_USER="${C_USER}"
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

# Resolve content target volume or directory if --with-content is active
RESOLVED_CONTENT_VOL=""
RESOLVED_CONTENT_DIR=""
if [ "${WITH_CONTENT}" -eq 1 ]; then
  if [ -n "${TARGET_CONTENT_VOLUME}" ]; then
    RESOLVED_CONTENT_VOL="${TARGET_CONTENT_VOLUME}"
  elif [ -n "${CONTENT_VOLUME:-}" ]; then
    RESOLVED_CONTENT_VOL="${CONTENT_VOLUME}"
  elif command -v docker >/dev/null 2>&1; then
    # Detect volume from running compose service
    if [ -n "${RESOLVED_COMPOSE}" ]; then
      for svc in api web worker; do
        CID=$(docker compose -f "${RESOLVED_COMPOSE}" ps -q "${svc}" 2>/dev/null | head -n 1 || true)
        if [ -n "${CID}" ]; then
          DETECTED_VOL=$(docker inspect "${CID}" --format '{{range .Mounts}}{{if or (eq .Destination "/repo/content") (eq .Destination "/repo/apps/api/content")}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' 2>/dev/null || true)
          if [ -n "${DETECTED_VOL}" ]; then
            RESOLVED_CONTENT_VOL="${DETECTED_VOL}"
            break
          fi
        fi
      done
    fi
    # Check candidate volume name
    if [ -z "${RESOLVED_CONTENT_VOL}" ] && [ -n "${RESOLVED_COMPOSE}" ]; then
      PROJECT_NAME=$(docker compose -f "${RESOLVED_COMPOSE}" config 2>/dev/null | grep -E '^name:' | head -n 1 | awk '{print $2}' || true)
      PROJECT_NAME="${PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-vibress-prod}}"
      CANDIDATE_VOL="${PROJECT_NAME}_vibress_content"
      if docker volume inspect "${CANDIDATE_VOL}" >/dev/null 2>&1; then
        RESOLVED_CONTENT_VOL="${CANDIDATE_VOL}"
      fi
    fi
    if [ -z "${RESOLVED_CONTENT_VOL}" ]; then
      MATCHING_VOL=$(docker volume ls -q --filter "name=vibress_content" | head -n 1 || true)
      if [ -n "${MATCHING_VOL}" ]; then
        RESOLVED_CONTENT_VOL="${MATCHING_VOL}"
      fi
    fi
  fi

  if [ -z "${RESOLVED_CONTENT_VOL}" ]; then
    RESOLVED_CONTENT_DIR="${TARGET_CONTENT_DIR:-${STORAGE_LOCAL_ROOT:-./content}}"
  fi
fi

# --- Step 5: Destructive Confirmation Gate ---
echo -e "\n--------------------------------------------------------------------------------"
echo " ATTENTION: DESTRUCTIVE OPERATION"
echo " Database Destination: ${TARGET_DESC} -> Database '${TARGET_DB}'"
echo "   (Existing tables and records in '${TARGET_DB}' will be dropped and replaced)"
if [ "${WITH_CONTENT}" -eq 1 ]; then
  if [ -n "${RESOLVED_CONTENT_VOL}" ]; then
    echo " Content Destination:  Docker named volume '${RESOLVED_CONTENT_VOL}'"
  else
    echo " Content Destination:  Host directory '${RESOLVED_CONTENT_DIR}'"
  fi
  echo "   (Existing media and themes in content destination will be replaced)"
fi
echo "--------------------------------------------------------------------------------"

if [ "${CONFIRMED}" -ne 1 ]; then
  if [ -t 0 ]; then
    read -r -p "Type 'RESTORE' to proceed with overwrite: " PROMPT_ANSWER
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

# --- Step 6: Execute Database Restore ---
echo "Applying database restore with ON_ERROR_STOP=1..."
export PGPASSWORD="${PG_PASSWORD}"

if [ "${RESTORE_MODE}" = "compose" ]; then
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
echo "✓ Database restored into '${TARGET_DB}' successfully."

# --- Step 7: Execute Content Restore If Requested ---
if [ "${WITH_CONTENT}" -eq 1 ]; then
  CONTENT_DIR_ABS=$(cd "$(dirname "${CONTENT_FILE}")" && pwd)
  CONTENT_BASENAME=$(basename "${CONTENT_FILE}")

  if [ -n "${RESOLVED_CONTENT_VOL}" ]; then
    echo "Restoring persistent content into Docker named volume '${RESOLVED_CONTENT_VOL}'..."
    # If the volume doesn't exist yet, create it
    if ! docker volume inspect "${RESOLVED_CONTENT_VOL}" >/dev/null 2>&1; then
      docker volume create "${RESOLVED_CONTENT_VOL}" >/dev/null
    fi
    docker run --rm \
      -v "${RESOLVED_CONTENT_VOL}:/volume" \
      -v "${CONTENT_DIR_ABS}:/backup:ro" \
      alpine:latest sh -c "rm -rf /volume/* /volume/..?* /volume/.[!.]* 2>/dev/null || true; tar -xzf \"/backup/${CONTENT_BASENAME}\" -C /volume; if [ -d /volume/content ] && [ ! -d /volume/media ]; then cp -rn /volume/content/* /volume/ 2>/dev/null || true; rm -rf /volume/content; fi"
    echo "✓ Persistent content restored into Docker volume '${RESOLVED_CONTENT_VOL}'."
  elif [ -n "${RESOLVED_CONTENT_DIR}" ]; then
    echo "Restoring persistent content into host directory '${RESOLVED_CONTENT_DIR}'..."
    mkdir -p "${RESOLVED_CONTENT_DIR}"
    tar -xzf "${CONTENT_FILE}" -C "${RESOLVED_CONTENT_DIR}"
    if [ -d "${RESOLVED_CONTENT_DIR}/content" ] && [ ! -d "${RESOLVED_CONTENT_DIR}/media" ]; then
      cp -rn "${RESOLVED_CONTENT_DIR}/content/"* "${RESOLVED_CONTENT_DIR}/" 2>/dev/null || true
      rm -rf "${RESOLVED_CONTENT_DIR}/content"
    fi
    echo "✓ Persistent content restored into host directory '${RESOLVED_CONTENT_DIR}'."
  fi
fi

echo "================================================================================"
echo "✓ Vibress Restore Completed Successfully at $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"
