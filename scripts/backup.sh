#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Database & Content Backup
# ==============================================================================
# Usage:
#   ./scripts/backup.sh [target_directory] [--with-content]
#
# Environment Overrides:
#   ENV_FILE            Path to environment file to source (default: .env if present)
#   COMPOSE_FILE        Docker compose file to target (default: compose.prod.yml if exists, else compose.dev.yml)
#   POSTGRES_SERVICE    Docker compose postgres service name (default: postgres)
#   POSTGRES_HOST       Explicit PostgreSQL host (if set, host pg_dump is preferred)
#   POSTGRES_PORT       Explicit PostgreSQL port
#   POSTGRES_USER       PostgreSQL username (default: from .env or vibress)
#   POSTGRES_DB         PostgreSQL database name (default: from .env or vibress)
#   POSTGRES_PASSWORD   PostgreSQL password (default: from .env or vibress)
#   CONTENT_VOLUME      Docker named volume to back up (default: detected vibress_content volume)
#   STORAGE_LOCAL_ROOT  Local storage root path
#   BACKUP_CONTENT      If set to 1, also backs up persistent media and themes
# ==============================================================================

BACKUP_DIR=""
WITH_CONTENT=0
WITH_S3=0

while [ $# -gt 0 ]; do
  case "$1" in
    --with-content)
      WITH_CONTENT=1
      ;;
    --with-s3)
      WITH_S3=1
      ;;
    --env-file)
      ENV_FILE="$2"
      shift
      ;;
    --content-volume)
      CONTENT_VOLUME="$2"
      shift
      ;;
    --s3-bucket)
      S3_BUCKET="$2"
      shift
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift
      ;;
    *)
      if [ -z "${BACKUP_DIR}" ] && [[ "$1" != --* ]]; then
        BACKUP_DIR="$1"
      fi
      ;;
  esac
  shift
done

BACKUP_DIR="${BACKUP_DIR:-${BACKUP_DIR_DEFAULT:-./backups}}"

if [ "${BACKUP_CONTENT:-0}" = "1" ]; then
  WITH_CONTENT=1
fi
if [ "${BACKUP_S3:-0}" = "1" ]; then
  WITH_S3=1
fi

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

# Resolve target compose file with strict isolation and environment validation
RESOLVED_COMPOSE=""
if [ -n "${COMPOSE_FILE:-}" ]; then
  if [ ! -f "${COMPOSE_FILE}" ]; then
    echo "Error: Specified COMPOSE_FILE '${COMPOSE_FILE}' not found." >&2
    exit 1
  fi
  RESOLVED_COMPOSE="${COMPOSE_FILE}"
else
  # Default strictly to production compose file if present
  if [ -f "compose.prod.yml" ]; then
    RESOLVED_COMPOSE="compose.prod.yml"
  elif [ "${NODE_ENV:-}" = "development" ] && [ -f "compose.dev.yml" ]; then
    RESOLVED_COMPOSE="compose.dev.yml"
  fi
fi

# Reject environment mismatches (e.g. production targeting dev compose)
if [ "${NODE_ENV:-}" = "production" ] && [ -n "${RESOLVED_COMPOSE}" ] && [[ "${RESOLVED_COMPOSE}" =~ (dev|development) ]]; then
  echo "Error: Environment mismatch detected. NODE_ENV is 'production', but target compose file is '${RESOLVED_COMPOSE}'." >&2
  echo "Production backups must never accidentally target a development database." >&2
  exit 1
fi

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"

# Determine execution strategy
BACKUP_MODE=""
CONTAINER_ID=""

# If POSTGRES_HOST is not explicitly set, check if DATABASE_URL points to an external host
if [ -z "${POSTGRES_HOST:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  if [[ "${DATABASE_URL}" =~ @([^:/]+) ]]; then
    EXTRACTED_HOST="${BASH_REMATCH[1]}"
    if [ "${EXTRACTED_HOST}" != "postgres" ] && [ "${EXTRACTED_HOST}" != "localhost" ] && [ "${EXTRACTED_HOST}" != "127.0.0.1" ]; then
      POSTGRES_HOST="${EXTRACTED_HOST}"
    fi
  fi
fi

if [ -n "${POSTGRES_HOST:-}" ]; then
  # Explicit host provided (e.g. AWS RDS / Google Cloud SQL / remote database)
  PG_PORT="${POSTGRES_PORT:-5432}"
  echo "Targeting explicit PostgreSQL host: ${POSTGRES_HOST}:${PG_PORT} (DB: ${PG_DB})"
  BACKUP_MODE="host"
elif [ -n "${RESOLVED_COMPOSE}" ]; then
  COMPOSE_ARGS=()
  if [ -n "${ENV_FILE:-}" ] && [ -f "${ENV_FILE}" ]; then
    COMPOSE_ARGS+=(--env-file "${ENV_FILE}")
  fi
  COMPOSE_ARGS+=(-f "${RESOLVED_COMPOSE}")

  # Target strictly within the resolved Compose file; refuse to fallback across compose files
  if docker compose "${COMPOSE_ARGS[@]}" ps -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; then
    CONTAINER_ID=$(docker compose "${COMPOSE_ARGS[@]}" ps -q "${POSTGRES_SERVICE}" | head -n 1)
    BACKUP_MODE="compose"
  elif docker compose "${COMPOSE_ARGS[@]}" ps --all -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; then
    echo "PostgreSQL container in '${RESOLVED_COMPOSE}' is stopped. Starting '${POSTGRES_SERVICE}'..."
    docker compose "${COMPOSE_ARGS[@]}" up -d "${POSTGRES_SERVICE}"
    MAX_WAIT=30
    WAIT_COUNT=0
    until docker compose "${COMPOSE_ARGS[@]}" ps -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; do
      WAIT_COUNT=$((WAIT_COUNT + 1))
      [ "${WAIT_COUNT}" -ge "${MAX_WAIT}" ] && break
      sleep 1
    done
    CONTAINER_ID=$(docker compose "${COMPOSE_ARGS[@]}" ps -q "${POSTGRES_SERVICE}" | head -n 1)
    BACKUP_MODE="compose"
  else
    echo "Error: PostgreSQL service '${POSTGRES_SERVICE}' not found in target '${RESOLVED_COMPOSE}'." >&2
    echo "Refusing to target an alternative or development compose container." >&2
    exit 1
  fi

  if [ -n "${CONTAINER_ID}" ]; then
    C_PASS=$(docker inspect "${CONTAINER_ID}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^POSTGRES_PASSWORD=' | cut -d= -f2- || true)
    [ -n "${C_PASS}" ] && PG_PASSWORD="${C_PASS}"
    C_USER=$(docker inspect "${CONTAINER_ID}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^POSTGRES_USER=' | cut -d= -f2- || true)
    [ -n "${C_USER}" ] && PG_USER="${C_USER}"
    C_DB=$(docker inspect "${CONTAINER_ID}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^POSTGRES_DB=' | cut -d= -f2- || true)
    [ -n "${C_DB}" ] && PG_DB="${C_DB}"
    echo "Targeting Docker Compose service '${POSTGRES_SERVICE}' in '${RESOLVED_COMPOSE}' (Container: ${CONTAINER_ID})"
  fi
elif command -v pg_dump >/dev/null 2>&1; then
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
  # Execute pg_dump inside the identified compose container using container environment (no plaintext secret on host CLI)
  docker compose "${COMPOSE_ARGS[@]}" exec -T \
    "${POSTGRES_SERVICE}" \
    sh -c 'PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -U "$1" -d "$2" --clean --if-exists --no-owner --no-privileges' _ "${PG_USER}" "${PG_DB}" \
    | gzip -c > "${TARGET_FILE_TMP}"
elif [ "${BACKUP_MODE}" = "host" ]; then
  if command -v pg_dump >/dev/null 2>&1; then
    PGPASSWORD="${PG_PASSWORD}" pg_dump \
      -h "${POSTGRES_HOST:-localhost}" \
      -p "${PG_PORT:-5432}" \
      -U "${PG_USER}" \
      -d "${PG_DB}" \
      --clean --if-exists --no-owner --no-privileges \
      | gzip -c > "${TARGET_FILE_TMP}"
  elif command -v docker >/dev/null 2>&1; then
    echo "Running pg_dump via ephemeral postgres container targeting ${POSTGRES_HOST}..."
    PG_TMP_ENV="/tmp/.pg_env_$$.tmp"
    (umask 077 && printf 'PGPASSWORD=%s\n' "${PG_PASSWORD}" > "${PG_TMP_ENV}")
    docker run --rm --network host \
      --env-file "${PG_TMP_ENV}" \
      postgres:16-alpine \
      pg_dump -h "${POSTGRES_HOST}" -p "${PG_PORT:-5432}" -U "${PG_USER}" -d "${PG_DB}" \
      --clean --if-exists --no-owner --no-privileges \
      | gzip -c > "${TARGET_FILE_TMP}"
    rm -f "${PG_TMP_ENV}"
  else
    echo "Error: pg_dump client is required for host backup mode but was not found in PATH." >&2
    exit 1
  fi
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

# --- Persistent Content (Media & Themes) Backup ---
if [ "${WITH_CONTENT}" -eq 1 ]; then
  echo -e "\n--- Processing Persistent Content Backup ---"
  RESOLVED_VOLUME=""
  if [ -n "${CONTENT_VOLUME:-}" ]; then
    if docker volume inspect "${CONTENT_VOLUME}" >/dev/null 2>&1; then
      RESOLVED_VOLUME="${CONTENT_VOLUME}"
      echo "Using explicitly configured content volume: ${RESOLVED_VOLUME}"
    else
      echo "Error: Explicit content volume '${CONTENT_VOLUME}' does not exist." >&2
      exit 1
    fi
  elif command -v docker >/dev/null 2>&1; then
    # 1. Detect volume strictly from compose services belonging to THIS project (api, web, worker)
    if [ -n "${RESOLVED_COMPOSE}" ]; then
      COMPOSE_ARGS=()
      if [ -n "${ENV_FILE:-}" ] && [ -f "${ENV_FILE}" ]; then
        COMPOSE_ARGS+=(--env-file "${ENV_FILE}")
      fi
      COMPOSE_ARGS+=(-f "${RESOLVED_COMPOSE}")

      for svc in api web worker; do
        CID=$(docker compose "${COMPOSE_ARGS[@]}" ps -q "${svc}" 2>/dev/null | head -n 1 || true)
        if [ -n "${CID}" ]; then
          DETECTED_VOL=$(docker inspect "${CID}" --format '{{range .Mounts}}{{if or (eq .Destination "/repo/content") (eq .Destination "/repo/apps/api/content")}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}{{end}}' 2>/dev/null | head -n 1 | tr -d '[:space:]' || true)
          if [ -n "${DETECTED_VOL}" ]; then
            RESOLVED_VOLUME="${DETECTED_VOL}"
            echo "Detected Docker content volume '${RESOLVED_VOLUME}' from running service '${svc}' in project '${RESOLVED_COMPOSE}'."
            break
          fi
        fi
      done
    fi

    # 2. If services are stopped, resolve the project-scoped volume name from Compose configuration
    if [ -z "${RESOLVED_VOLUME}" ] && [ -n "${RESOLVED_COMPOSE}" ]; then
      PROJECT_NAME=$(docker compose "${COMPOSE_ARGS[@]}" config 2>/dev/null | grep -E '^name:' | head -n 1 | awk '{print $2}' || true)
      PROJECT_NAME="${PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-vibress-prod}}"
      CANDIDATE_VOL="${PROJECT_NAME}_vibress_content"
      if docker volume inspect "${CANDIDATE_VOL}" >/dev/null 2>&1; then
        RESOLVED_VOLUME="${CANDIDATE_VOL}"
        echo "Found Docker content volume '${RESOLVED_VOLUME}' for project '${PROJECT_NAME}'."
      fi
    fi

    # CRITICAL SECURITY FIX (P0-2): Never perform cross-project volume discovery via `docker volume ls`
    # Refuse to silently substitute or match an unrelated project's content volume.
  fi

  CONTENT_BACKED_UP=0
  CONTENT_FILENAME="vibress_content_${TIMESTAMP}.tar.gz"
  CONTENT_TARGET="${BACKUP_DIR}/${CONTENT_FILENAME}"
  CONTENT_TARGET_TMP="${CONTENT_TARGET}.tmp.$$"
  BACKUP_DIR_ABS=$(cd "${BACKUP_DIR}" && pwd)

  if [ -n "${RESOLVED_VOLUME}" ]; then
    echo "Backing up Docker named volume '${RESOLVED_VOLUME}' into '${CONTENT_TARGET}'..."
    docker run --rm \
      -v "${RESOLVED_VOLUME}:/volume:ro" \
      -v "${BACKUP_DIR_ABS}:/backup" \
      alpine:latest tar -czf "/backup/${CONTENT_FILENAME}.tmp.$$" -C /volume .

    if [ -f "${CONTENT_TARGET_TMP}" ]; then
      mv "${CONTENT_TARGET_TMP}" "${CONTENT_TARGET}"
      CONTENT_BACKED_UP=1
    fi
  elif [ -z "${RESOLVED_COMPOSE}" ]; then
    # Fallback to local host directory only in standalone host mode (no Docker Compose)
    CONTENT_DIR=""
    for candidate in "${STORAGE_LOCAL_ROOT:-}" "./content" "/repo/content"; do
      if [ -n "${candidate}" ] && [ -d "${candidate}" ]; then
        CONTENT_DIR="${candidate}"
        break
      fi
    done

    if [ -n "${CONTENT_DIR}" ]; then
      echo "Backing up host content directory '${CONTENT_DIR}' into '${CONTENT_TARGET}'..."
      tar -czf "${CONTENT_TARGET_TMP}" -C "${CONTENT_DIR}" .
      if [ -f "${CONTENT_TARGET_TMP}" ]; then
        mv "${CONTENT_TARGET_TMP}" "${CONTENT_TARGET}"
        CONTENT_BACKED_UP=1
      fi
    else
      echo "Error: Content backup requested (--with-content) but no valid host content directory was found." >&2
      exit 1
    fi
  else
    echo "Error: Content backup requested (--with-content) but no project-scoped Docker volume ('${CANDIDATE_VOL:-vibress_content}') was found for project '${PROJECT_NAME:-vibress-prod}' in '${RESOLVED_COMPOSE}'." >&2
    echo "Refusing to proceed without backing up required application content or guessing other projects' volumes." >&2
    exit 1
  fi

  if [ "${CONTENT_BACKED_UP}" -eq 1 ]; then
    # Validate content archive integrity
    if ! gzip -t "${CONTENT_TARGET}"; then
      echo "Error: Content backup archive ${CONTENT_TARGET} is corrupted (gzip check failed)." >&2
      rm -f "${CONTENT_TARGET}"
      exit 1
    fi
    if ! tar -tzf "${CONTENT_TARGET}" >/dev/null 2>&1; then
      echo "Error: Content backup archive ${CONTENT_TARGET} is not a valid tar archive." >&2
      rm -f "${CONTENT_TARGET}"
      exit 1
    fi

    chmod 600 "${CONTENT_TARGET}"
    CONTENT_CHECKSUM="${CONTENT_TARGET}.sha256"
    if command -v sha256sum >/dev/null 2>&1; then
      (cd "${BACKUP_DIR}" && sha256sum "${CONTENT_FILENAME}" > "${CONTENT_FILENAME}.sha256")
    elif command -v shasum >/dev/null 2>&1; then
      (cd "${BACKUP_DIR}" && shasum -a 256 "${CONTENT_FILENAME}" > "${CONTENT_FILENAME}.sha256")
    fi
    chmod 600 "${CONTENT_CHECKSUM}"
    CONTENT_SIZE=$(ls -lh "${CONTENT_TARGET}" | awk '{print $5}')
    echo "✓ Persistent content backup created and verified: ${CONTENT_TARGET} (${CONTENT_SIZE})"
    echo "✓ Content Checksum created: ${CONTENT_CHECKSUM}"
  else
    echo "Error: Failed to create content backup archive '${CONTENT_TARGET}'." >&2
    exit 1
  fi
fi

# --- S3 / Object Storage Backup ---
S3_BUCKET_NAME="${S3_BUCKET:-${AWS_S3_BUCKET:-}}"
STORAGE_PROV="${STORAGE_PROVIDER:-local}"
S3_REQUIRED=0
if [ "${STORAGE_PROV}" = "s3" ] || [ "${WITH_S3:-0}" -eq 1 ]; then
  S3_REQUIRED=1
fi

S3_BACKUP_SUCCESS=0
if [ "${S3_REQUIRED}" -eq 1 ] || { [ "${WITH_CONTENT}" -eq 1 ] && [ -n "${S3_BUCKET_NAME}" ]; }; then
  echo -e "\n--- Processing S3 / Object Storage Backup ---"
  if [ -z "${S3_BUCKET_NAME}" ]; then
    echo "Error: S3 backup requested/required but no bucket configured (S3_BUCKET / AWS_S3_BUCKET)." >&2
    if [ "${S3_REQUIRED}" -eq 1 ]; then
      exit 1
    fi
  else
    # CRITICAL SECURITY FIX (P1-3): Never pass credentials as CLI arguments!
    # Pass access key and secret key strictly through the subprocess environment.
    S3_BACKUP_CMD=(pnpm exec tsx scripts/s3-backup.mjs --bucket "${S3_BUCKET_NAME}" --output "${BACKUP_DIR}")
    if [ -n "${S3_ENDPOINT:-${AWS_ENDPOINT_URL:-${STORAGE_S3_ENDPOINT:-}}}" ]; then
      S3_BACKUP_CMD+=(--endpoint "${S3_ENDPOINT:-${AWS_ENDPOINT_URL:-${STORAGE_S3_ENDPOINT:-}}}")
    fi
    if [ -n "${S3_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}" ]; then
      S3_BACKUP_CMD+=(--region "${S3_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}")
    fi
    if [ -n "${S3_PREFIX:-}" ]; then
      S3_BACKUP_CMD+=(--prefix "${S3_PREFIX}")
    fi
    if [ -n "${ENV_FILE:-}" ]; then
      S3_BACKUP_CMD+=(--env-file "${ENV_FILE}")
    fi

    echo "Executing S3 backup engine (Fail-Closed, credentials protected from OS process table)..."
    if (
      export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
      export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
      "${S3_BACKUP_CMD[@]}"
    ); then
      echo "✓ S3 object storage backup completed successfully."
      S3_BACKUP_SUCCESS=1
    else
      echo "Error: S3 backup failed." >&2
      if [ "${S3_REQUIRED}" -eq 1 ]; then
        echo "FAIL-CLOSED: S3 is active storage provider or explicitly requested; aborting backup." >&2
        exit 1
      fi
    fi
  fi
fi

# --- Backup Set Manifest Generation & Authentication (Blocker P1-4) ---
MANIFEST_FILE="${BACKUP_DIR}/vibress_backup_manifest_${TIMESTAMP}.json"
DB_SHA=""
[ -f "${CHECKSUM_FILE}" ] && DB_SHA=$(awk '{print $1}' "${CHECKSUM_FILE}")
CONTENT_SHA=""
[ -n "${CONTENT_CHECKSUM:-}" ] && [ -f "${CONTENT_CHECKSUM}" ] && CONTENT_SHA=$(awk '{print $1}' "${CONTENT_CHECKSUM}")

S3_FILE="none"
S3_SHA="none"
if [ "${S3_BACKUP_SUCCESS:-0}" -eq 1 ]; then
  LATEST_S3_ARCHIVE=$(ls -t "${BACKUP_DIR}"/vibress_s3_*.tar.gz 2>/dev/null | head -n 1 || true)
  if [ -n "${LATEST_S3_ARCHIVE}" ] && [ -f "${LATEST_S3_ARCHIVE}" ]; then
    S3_FILE=$(basename "${LATEST_S3_ARCHIVE}")
    if [ -f "${LATEST_S3_ARCHIVE}.sha256" ]; then
      S3_SHA=$(awk '{print $1}' "${LATEST_S3_ARCHIVE}.sha256")
    elif command -v sha256sum >/dev/null 2>&1; then
      S3_SHA=$(sha256sum "${LATEST_S3_ARCHIVE}" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      S3_SHA=$(shasum -a 256 "${LATEST_S3_ARCHIVE}" | awk '{print $1}')
    fi
  fi
fi

# Determine signing capability
SIGNING_KEY="${BACKUP_SIGNING_KEY:-${VIBRESS_ENCRYPTION_KEY:-}}"
SIG_ALG="none"
HMAC_SIG="none"

if [ -n "${SIGNING_KEY}" ] && command -v openssl >/dev/null 2>&1; then
  SIG_ALG="hmac-sha256"
fi

cat << EOF > "${MANIFEST_FILE}"
{
  "backupSetId": "vibress_backup_${TIMESTAMP}",
  "timestamp": "$(date -u +"%Y-%m-%d %H:%M:%S UTC")",
  "project": "${PROJECT_NAME:-vibress-prod}",
  "storageProvider": "${STORAGE_PROV}",
  "database": {
    "file": "${FILENAME}",
    "sha256": "${DB_SHA}",
    "size": "${FILESIZE}"
  },
  "content": {
    "backedUp": $( [ "${CONTENT_BACKED_UP:-0}" -eq 1 ] && echo "true" || echo "false" ),
    "volume": "${RESOLVED_VOLUME:-none}",
    "file": "${CONTENT_FILENAME:-none}",
    "sha256": "${CONTENT_SHA:-none}"
  },
  "s3": {
    "backedUp": $( [ "${S3_BACKUP_SUCCESS:-0}" -eq 1 ] && echo "true" || echo "false" ),
    "bucket": "${S3_BUCKET_NAME:-none}",
    "prefix": "${S3_PREFIX:-none}",
    "file": "${S3_FILE}",
    "sha256": "${S3_SHA}"
  },
  "signatureAlgorithm": "${SIG_ALG}"
}
EOF
chmod 600 "${MANIFEST_FILE}"

if [ "${SIG_ALG}" = "hmac-sha256" ]; then
  HMAC_SIG=$(openssl dgst -sha256 -hmac "${SIGNING_KEY}" "${MANIFEST_FILE}" | awk '{print $NF}')
  printf '%s\n' "${HMAC_SIG}" > "${MANIFEST_FILE}.sig"
  chmod 600 "${MANIFEST_FILE}.sig"
  echo "✓ Backup set manifest cryptographically signed with HMAC-SHA256: ${MANIFEST_FILE}"
else
  echo "✓ Backup set manifest created with SHA-256 integrity digests (unsigned): ${MANIFEST_FILE}"
fi

# Reset trap
trap - EXIT ERR INT TERM
echo "================================================================================"
echo " Vibress Backup Completed Successfully at $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"
