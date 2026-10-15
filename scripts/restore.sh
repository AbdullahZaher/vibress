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
WITH_S3=0
S3_FILE=""
TARGET_S3_BUCKET=""
TARGET_S3_PREFIX=""
TARGET_S3_ENDPOINT=""
CONFIRMED=0
SKIP_CHECKSUM=0
ALLOW_UNSIGNED=0
[ "${ALLOW_UNSIGNED_RESTORE:-0}" = "1" ] || [ "${ALLOW_UNSIGNED_RESTORE:-}" = "yes" ] && ALLOW_UNSIGNED=1

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)
      CONFIRMED=1
      ;;
    --skip-checksum)
      SKIP_CHECKSUM=1
      ;;
    --allow-unsigned)
      ALLOW_UNSIGNED=1
      ;;
    --db|--database|--target-db)
      TARGET_DB="$2"
      shift
      ;;
    --archive)
      BACKUP_FILE="$2"
      shift
      ;;
    --manifest)
      MANIFEST_FILE="$2"
      shift
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
    --with-s3)
      WITH_S3=1
      if [ $# -gt 1 ] && [[ "$2" != --* ]] && [[ "$2" == *.tar.gz ]]; then
        S3_FILE="$2"
        shift
      fi
      ;;
    --s3-bucket)
      TARGET_S3_BUCKET="$2"
      shift
      ;;
    --s3-prefix)
      TARGET_S3_PREFIX="$2"
      shift
      ;;
    --s3-endpoint)
      TARGET_S3_ENDPOINT="$2"
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

BACKUP_DIR=$(dirname "${BACKUP_FILE}")
SQL_BASENAME=$(basename "${BACKUP_FILE}")
TS=""
if [[ "${SQL_BASENAME}" =~ ([0-9]{8}_[0-9]{6}) ]]; then
  TS="${BASH_REMATCH[1]}"
fi

# Locate accompanying backup manifest if not explicitly provided
if [ -z "${MANIFEST_FILE:-}" ] && [ -n "${TS}" ]; then
  if [ -f "${BACKUP_DIR}/vibress_backup_manifest_${TS}.json" ]; then
    MANIFEST_FILE="${BACKUP_DIR}/vibress_backup_manifest_${TS}.json"
    echo "Discovered accompanying backup manifest: ${MANIFEST_FILE}"
  fi
fi

# Auto-locate content archive if --with-content was requested without explicit file
if [ "${WITH_CONTENT}" -eq 1 ] && [ -z "${CONTENT_FILE}" ]; then
  if [ -n "${MANIFEST_FILE:-}" ] && [ -f "${MANIFEST_FILE}" ]; then
    M_CONTENT=$(node -e "try { const m=JSON.parse(fs.readFileSync(process.argv[1])); console.log(m.content?.file || ''); } catch(e){}" "${MANIFEST_FILE}" 2>/dev/null || true)
    if [ -n "${M_CONTENT}" ] && [ "${M_CONTENT}" != "none" ] && [ -f "${BACKUP_DIR}/${M_CONTENT}" ]; then
      CONTENT_FILE="${BACKUP_DIR}/${M_CONTENT}"
    fi
  fi
  if [ -z "${CONTENT_FILE}" ] && [ -n "${TS}" ]; then
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

# Auto-locate S3 archive if --with-s3 was requested without explicit file
if [ "${WITH_S3}" -eq 1 ] && [ -z "${S3_FILE}" ]; then
  if [ -n "${MANIFEST_FILE:-}" ] && [ -f "${MANIFEST_FILE}" ]; then
    M_S3=$(node -e "try { const m=JSON.parse(fs.readFileSync(process.argv[1])); console.log(m.s3?.file || ''); } catch(e){}" "${MANIFEST_FILE}" 2>/dev/null || true)
    if [ -n "${M_S3}" ] && [ "${M_S3}" != "none" ] && [ -f "${BACKUP_DIR}/${M_S3}" ]; then
      S3_FILE="${BACKUP_DIR}/${M_S3}"
    fi
  fi
  if [ -z "${S3_FILE}" ] && [ -n "${TS}" ]; then
    if [ -f "${BACKUP_DIR}/vibress_s3_${TS}.tar.gz" ]; then
      S3_FILE="${BACKUP_DIR}/vibress_s3_${TS}.tar.gz"
    fi
  fi
  if [ -z "${S3_FILE}" ]; then
    LATEST_S3=$(ls -t "${BACKUP_DIR}"/vibress_s3_*.tar.gz 2>/dev/null | head -n 1 || true)
    if [ -n "${LATEST_S3}" ] && [ -f "${LATEST_S3}" ]; then
      S3_FILE="${LATEST_S3}"
    fi
  fi
  if [ -z "${S3_FILE}" ]; then
    echo "Error: --with-s3 requested but no matching vibress_s3_*.tar.gz found in ${BACKUP_DIR}." >&2
    exit 1
  fi
fi

TARGET_S3_BUCKET="${TARGET_S3_BUCKET:-${S3_BUCKET:-${AWS_S3_BUCKET:-}}}"
if [ "${WITH_S3}" -eq 1 ] && [ -z "${TARGET_S3_BUCKET}" ]; then
  echo "Error: S3 restore requested (--with-s3) but no target bucket specified (--s3-bucket or S3_BUCKET)." >&2
  exit 1
fi

echo "================================================================================"
echo " Starting Vibress Production Restore"
echo " Source DB Backup: ${BACKUP_FILE}"
echo " Target Database:  ${TARGET_DB}"
if [ -n "${MANIFEST_FILE:-}" ]; then
  echo " Backup Manifest:  ${MANIFEST_FILE}"
fi
if [ "${WITH_CONTENT}" -eq 1 ]; then
  echo " Source Content:   ${CONTENT_FILE}"
fi
if [ "${WITH_S3}" -eq 1 ]; then
  echo " Source S3 Backup: ${S3_FILE}"
  echo " Target S3 Bucket: ${TARGET_S3_BUCKET}${TARGET_S3_PREFIX:+ (Prefix: \"${TARGET_S3_PREFIX}\")}"
fi
echo " Date:             $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"

# --- Step 1: Pre-restore Manifest & Checksum Verification ---
# Step 1A: Manifest Authentication & Signature Policy Gate (MANDATORY & PRECEDES ALL CHECKS)
echo "Verifying backup security, signature policy, and authentication..."

IS_PROD_RESTORE=0
[ "${NODE_ENV:-}" = "production" ] && IS_PROD_RESTORE=1
[ "${REQUIRE_SIGNED_BACKUP:-0}" -eq 1 ] && IS_PROD_RESTORE=1

IS_SIGNED_BACKUP=0
M_SIG_ALG="none"

if [ -n "${MANIFEST_FILE:-}" ] && [ -f "${MANIFEST_FILE}" ]; then
  M_SIG_ALG=$(node -e "try { const m=JSON.parse(fs.readFileSync(process.argv[1])); console.log(m.signatureAlgorithm || 'none'); } catch(e){ console.log('none'); }" "${MANIFEST_FILE}" 2>/dev/null || true)
  if [ "${M_SIG_ALG}" = "hmac-sha256" ] || [ -f "${MANIFEST_FILE}.sig" ]; then
    IS_SIGNED_BACKUP=1
  fi
elif [ -f "${BACKUP_FILE}.sig" ]; then
  IS_SIGNED_BACKUP=1
fi

# Strict Policy Gate: --skip-checksum must NEVER bypass signature verification or be allowed on signed/production backups
if [ "${SKIP_CHECKSUM}" -eq 1 ]; then
  if [ "${IS_SIGNED_BACKUP}" -eq 1 ]; then
    echo "Error: --skip-checksum is strictly forbidden on cryptographically signed backup sets." >&2
    echo "Cryptographic signature and integrity verification cannot be bypassed on authenticated backups." >&2
    exit 1
  fi
  if [ "${IS_PROD_RESTORE}" -eq 1 ] && [ "${ALLOW_UNSIGNED}" -ne 1 ]; then
    echo "Error: --skip-checksum is strictly forbidden for production restores without explicit --allow-unsigned." >&2
    echo "Production data integrity cannot be bypassed without explicit --allow-unsigned." >&2
    exit 1
  fi
fi

# Manifest and Signature Verification Gate
if [ -n "${MANIFEST_FILE:-}" ]; then
  if [ ! -f "${MANIFEST_FILE}" ]; then
    echo "Error: Specified manifest file not found: ${MANIFEST_FILE}" >&2
    exit 1
  fi

  if [ "${IS_SIGNED_BACKUP}" -eq 1 ]; then
    # 1. Enforce signature presence: Cannot bypass by deleting .sig
    if [ ! -f "${MANIFEST_FILE}.sig" ]; then
      echo "Error: Backup manifest declares signatureAlgorithm 'hmac-sha256', but detached signature '${MANIFEST_FILE}.sig' is missing!" >&2
      echo "Deleting the signature file to bypass authentication is strictly forbidden. Aborting restore." >&2
      exit 1
    fi

    # 2. Enforce BACKUP_SIGNING_KEY presence
    SIGNING_KEY="${BACKUP_SIGNING_KEY:-}"
    if [ -z "${SIGNING_KEY}" ]; then
      echo "Error: Backup manifest has detached HMAC-SHA256 signature (${MANIFEST_FILE}.sig), but BACKUP_SIGNING_KEY is not configured in environment." >&2
      echo "Aborting restore to protect against unauthenticated data restoration." >&2
      exit 1
    fi

    # 3. Compute HMAC safely in Node subshell (P0: Zero key exposure in OS process table argv)
    CALC_SIG=$(
      export BACKUP_SIGNING_KEY="${SIGNING_KEY}"
      node -e '
        const crypto = require("node:crypto");
        const fs = require("node:fs");
        const key = process.env.BACKUP_SIGNING_KEY;
        if (!key) process.exit(1);
        const content = fs.readFileSync(process.argv[1]);
        process.stdout.write(crypto.createHmac("sha256", key).update(content).digest("hex") + "\n");
      ' "${MANIFEST_FILE}" 2>/dev/null || true
    )
    STORED_SIG=$(tr -d '[:space:]' < "${MANIFEST_FILE}.sig")
    if [ -z "${CALC_SIG}" ] || [ "${CALC_SIG}" != "${STORED_SIG}" ]; then
      echo "Error: Manifest HMAC-SHA256 signature verification FAILED! Backup manifest is forged or corrupted." >&2
      exit 1
    fi
    echo "✓ Backup manifest HMAC-SHA256 cryptographic signature verified."
  else
    # Manifest is unsigned: enforce production unsigned policy
    if [ "${IS_PROD_RESTORE}" -eq 1 ] && [ "${ALLOW_UNSIGNED}" -ne 1 ]; then
      echo "Error: Production restore policy requires cryptographically signed backup sets." >&2
      echo "The backup manifest is unsigned or lacks an authenticated signature." >&2
      echo "To restore legacy or emergency unauthenticated backups, pass --allow-unsigned or set ALLOW_UNSIGNED_RESTORE=yes." >&2
      exit 1
    elif [ "${ALLOW_UNSIGNED}" -eq 1 ]; then
      echo "Warning: Restoring unsigned backup set because --allow-unsigned was explicitly specified."
    fi
  fi
else
  # No manifest provided: enforce production unsigned policy
  if [ "${IS_PROD_RESTORE}" -eq 1 ] && [ "${ALLOW_UNSIGNED}" -ne 1 ]; then
    echo "Error: In production mode (NODE_ENV=production), restoring unverified backups without an authenticated manifest is forbidden." >&2
    echo "Provide a backup set containing an authenticated manifest, or pass --allow-unsigned to override." >&2
    exit 1
  fi
fi

# Step 1B: Archive SHA-256 Checksum Verification
if [ "${SKIP_CHECKSUM}" -eq 1 ]; then
  echo "Warning: Archive SHA-256 checksum verification explicitly bypassed via --skip-checksum."
else
  # Correlate Database SHA-256 against manifest
  if [ -n "${MANIFEST_FILE:-}" ] && [ -f "${MANIFEST_FILE}" ]; then
    M_DB_SHA=$(node -e "try { const m=JSON.parse(fs.readFileSync(process.argv[1])); console.log(m.database?.sha256 || ''); } catch(e){}" "${MANIFEST_FILE}" 2>/dev/null || true)
    if [ -n "${M_DB_SHA}" ] && [ "${M_DB_SHA}" != "none" ]; then
      ACTUAL_DB_SHA=""
      if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL_DB_SHA=$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')
      elif command -v shasum >/dev/null 2>&1; then
        ACTUAL_DB_SHA=$(shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}')
      fi
      if [ "${ACTUAL_DB_SHA}" != "${M_DB_SHA}" ]; then
        echo "Error: Database backup SHA-256 does not match manifest entry!" >&2
        echo "  Expected (manifest): ${M_DB_SHA}" >&2
        echo "  Actual (archive):    ${ACTUAL_DB_SHA}" >&2
        exit 1
      fi
      echo "✓ Database archive SHA-256 matches authenticated backup manifest."
    fi

    # Correlate Content SHA-256 against manifest if requested
    if [ "${WITH_CONTENT}" -eq 1 ] && [ -n "${CONTENT_FILE:-}" ] && [ -f "${CONTENT_FILE}" ]; then
      M_C_SHA=$(node -e "try { const m=JSON.parse(fs.readFileSync(process.argv[1])); console.log(m.content?.sha256 || ''); } catch(e){}" "${MANIFEST_FILE}" 2>/dev/null || true)
      if [ -n "${M_C_SHA}" ] && [ "${M_C_SHA}" != "none" ]; then
        ACTUAL_C_SHA=""
        if command -v sha256sum >/dev/null 2>&1; then
          ACTUAL_C_SHA=$(sha256sum "${CONTENT_FILE}" | awk '{print $1}')
        elif command -v shasum >/dev/null 2>&1; then
          ACTUAL_C_SHA=$(shasum -a 256 "${CONTENT_FILE}" | awk '{print $1}')
        fi
        if [ "${ACTUAL_C_SHA}" != "${M_C_SHA}" ]; then
          echo "Error: Content backup SHA-256 does not match manifest entry!" >&2
          echo "  Expected (manifest): ${M_C_SHA}" >&2
          echo "  Actual (archive):    ${ACTUAL_C_SHA}" >&2
          exit 1
        fi
        echo "✓ Content archive SHA-256 matches authenticated backup manifest."
      fi
    fi

    # Correlate S3 SHA-256 against manifest if requested
    if [ "${WITH_S3}" -eq 1 ] && [ -n "${S3_FILE:-}" ] && [ -f "${S3_FILE}" ]; then
      M_S3_SHA=$(node -e "try { const m=JSON.parse(fs.readFileSync(process.argv[1])); console.log(m.s3?.sha256 || ''); } catch(e){}" "${MANIFEST_FILE}" 2>/dev/null || true)
      if [ -n "${M_S3_SHA}" ] && [ "${M_S3_SHA}" != "none" ]; then
        ACTUAL_S3_SHA=""
        if command -v sha256sum >/dev/null 2>&1; then
          ACTUAL_S3_SHA=$(sha256sum "${S3_FILE}" | awk '{print $1}')
        elif command -v shasum >/dev/null 2>&1; then
          ACTUAL_S3_SHA=$(shasum -a 256 "${S3_FILE}" | awk '{print $1}')
        fi
        if [ "${ACTUAL_S3_SHA}" != "${M_S3_SHA}" ]; then
          echo "Error: S3 backup SHA-256 does not match manifest entry!" >&2
          echo "  Expected (manifest): ${M_S3_SHA}" >&2
          echo "  Actual (archive):    ${ACTUAL_S3_SHA}" >&2
          exit 1
        fi
        echo "✓ S3 archive SHA-256 matches authenticated backup manifest."
      fi
    fi
  fi

  # Fallback to database .sha256 file if present
  CHECKSUM_FILE="${BACKUP_FILE}.sha256"
  if [ -f "${CHECKSUM_FILE}" ]; then
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
  elif [ -z "${MANIFEST_FILE:-}" ]; then
    echo "Warning: No accompanying database .sha256 file or manifest found. Proceeding with caution."
  fi
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

# --- Step 3B: Validate S3 Object Archive If Requested ---
if [ "${WITH_S3}" -eq 1 ]; then
  echo "Validating S3 object backup archive integrity..."
  if [ ! -f "${S3_FILE}" ]; then
    echo "Error: S3 backup file not found: ${S3_FILE}" >&2
    exit 1
  fi

  S3_CHECKSUM="${S3_FILE}.sha256"
  if [ "${SKIP_CHECKSUM}" -eq 1 ]; then
    echo "Warning: S3 checksum verification explicitly bypassed."
  elif [ -f "${S3_CHECKSUM}" ]; then
    S3_DIR=$(dirname "${S3_FILE}")
    S3_BASE=$(basename "${S3_FILE}")
    S3_CHK_BASE=$(basename "${S3_CHECKSUM}")
    S3_PASSED=0
    if command -v sha256sum >/dev/null 2>&1; then
      if (cd "${S3_DIR}" && sha256sum -c "${S3_CHK_BASE}" >/dev/null 2>&1); then
        S3_PASSED=1
      fi
    elif command -v shasum >/dev/null 2>&1; then
      if (cd "${S3_DIR}" && shasum -a 256 -c "${S3_CHK_BASE}" >/dev/null 2>&1); then
        S3_PASSED=1
      fi
    fi
    if [ "${S3_PASSED}" -eq 1 ]; then
      echo "✓ S3 archive SHA-256 checksum verified."
    else
      echo "Error: S3 checksum verification FAILED for ${S3_FILE}!" >&2
      exit 1
    fi
  fi

  if ! gzip -t "${S3_FILE}"; then
    echo "Error: S3 archive ${S3_FILE} failed gzip integrity check." >&2
    exit 1
  fi
  if ! tar -tzf "${S3_FILE}" >/dev/null 2>&1; then
    echo "Error: S3 archive ${S3_FILE} failed tar table check." >&2
    exit 1
  fi
  echo "✓ S3 object archive verified."
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

COMPOSE_CMD=(docker compose)
if [ -n "${ENV_FILE:-}" ] && [ -f "${ENV_FILE}" ]; then
  COMPOSE_CMD+=(--env-file "${ENV_FILE}")
fi
if [ -n "${RESOLVED_COMPOSE}" ]; then
  COMPOSE_CMD+=(-f "${RESOLVED_COMPOSE}")
fi

if [ -n "${POSTGRES_HOST:-}" ]; then
  PG_PORT="${POSTGRES_PORT:-5432}"
  RESTORE_MODE="host"
  TARGET_DESC="host ${POSTGRES_HOST}:${PG_PORT}"
elif [ -n "${RESOLVED_COMPOSE}" ] && "${COMPOSE_CMD[@]}" ps -q "${POSTGRES_SERVICE}" 2>/dev/null | grep -q .; then
  CONTAINER_ID=$("${COMPOSE_CMD[@]}" ps -q "${POSTGRES_SERVICE}" | head -n 1)
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
        CID=$("${COMPOSE_CMD[@]}" ps -q "${svc}" 2>/dev/null | head -n 1 || true)
        if [ -n "${CID}" ]; then
          DETECTED_VOL=$(docker inspect "${CID}" --format '{{range .Mounts}}{{if or (eq .Destination "/repo/content") (eq .Destination "/repo/apps/api/content")}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}{{end}}' 2>/dev/null | head -n 1 | tr -d '[:space:]' || true)
          if [ -n "${DETECTED_VOL}" ]; then
            RESOLVED_CONTENT_VOL="${DETECTED_VOL}"
            break
          fi
        fi
      done
    fi
    # Check candidate volume name
    if [ -z "${RESOLVED_CONTENT_VOL}" ] && [ -n "${RESOLVED_COMPOSE}" ]; then
      PROJECT_NAME=$("${COMPOSE_CMD[@]}" config 2>/dev/null | grep -E '^name:' | head -n 1 | awk '{print $2}' || true)
      PROJECT_NAME="${PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-vibress-prod}}"
      CANDIDATE_VOL="${PROJECT_NAME}_vibress_content"
      RESOLVED_CONTENT_VOL="${CANDIDATE_VOL}"
    fi
    # CRITICAL SECURITY FIX (P0-2): Never perform cross-project volume discovery via `docker volume ls`
    # Refuse to silently substitute or match an unrelated project's content volume.
  fi

  if [ -z "${RESOLVED_CONTENT_VOL}" ]; then
    if [ -z "${RESOLVED_COMPOSE}" ]; then
      RESOLVED_CONTENT_DIR="${TARGET_CONTENT_DIR:-${STORAGE_LOCAL_ROOT:-./content}}"
    else
      echo "Error: Content restore requested (--with-content) in Compose mode but no project-scoped volume could be established." >&2
      exit 1
    fi
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
if [ "${WITH_S3}" -eq 1 ]; then
  echo " S3 Destination:       Bucket '${TARGET_S3_BUCKET}'${TARGET_S3_PREFIX:+ (Prefix: \"${TARGET_S3_PREFIX}\")}"
  echo "   (Existing objects in target bucket/prefix may be overwritten)"
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
echo "Ensuring target database '${TARGET_DB}' exists..."
export PGPASSWORD="${PG_PASSWORD}"

if [ "${RESTORE_MODE}" = "compose" ]; then
  CHECK_SQL="SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}';"
  DB_EXISTS=$("${COMPOSE_CMD[@]}" exec -T \
    "${POSTGRES_SERVICE}" \
    sh -c 'PGPASSWORD="${POSTGRES_PASSWORD}" psql -U "$1" -d "postgres" -t -A -c "$2"' _ "${PG_USER}" "${CHECK_SQL}" 2>/dev/null || true)
  if [ "${DB_EXISTS}" != "1" ]; then
    echo "Creating target database '${TARGET_DB}'..."
    CREATE_SQL="CREATE DATABASE \"${TARGET_DB}\";"
    "${COMPOSE_CMD[@]}" exec -T \
      "${POSTGRES_SERVICE}" \
      sh -c 'PGPASSWORD="${POSTGRES_PASSWORD}" psql -U "$1" -d "postgres" -c "$2"' _ "${PG_USER}" "${CREATE_SQL}"
  fi
elif [ "${RESTORE_MODE}" = "host" ]; then
  if command -v psql >/dev/null 2>&1; then
    DB_EXISTS=$(PGPASSWORD="${PG_PASSWORD}" psql -h "${POSTGRES_HOST}" -p "${PG_PORT:-5432}" -U "${PG_USER}" -d "postgres" -t -A -c "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}';" 2>/dev/null || true)
    if [ "${DB_EXISTS}" != "1" ]; then
      echo "Creating target database '${TARGET_DB}'..."
      PGPASSWORD="${PG_PASSWORD}" psql -h "${POSTGRES_HOST}" -p "${PG_PORT:-5432}" -U "${PG_USER}" -d "postgres" -c "CREATE DATABASE \"${TARGET_DB}\";"
    fi
  fi
fi

SCHEMA_RESET_SQL="DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO \"${PG_USER}\"; GRANT ALL ON SCHEMA public TO public;"

echo "Applying transactional database restore (-X -v ON_ERROR_STOP=1 --single-transaction -f -)..."

if [ "${RESTORE_MODE}" = "compose" ]; then
  ( printf '%s\n' "${SCHEMA_RESET_SQL}"; gunzip -c "${BACKUP_FILE}" ) | "${COMPOSE_CMD[@]}" exec -T \
    "${POSTGRES_SERVICE}" \
    sh -c 'PGPASSWORD="${POSTGRES_PASSWORD}" psql -X -v ON_ERROR_STOP=1 --single-transaction -f - -U "$1" -d "$2"' _ "${PG_USER}" "${TARGET_DB}"
elif [ "${RESTORE_MODE}" = "host" ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "Error: psql client is required for host restore mode but was not found in PATH." >&2
    exit 1
  fi
  ( printf '%s\n' "${SCHEMA_RESET_SQL}"; gunzip -c "${BACKUP_FILE}" ) | psql \
    -X \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    -f - \
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

# --- Step 8: Execute S3 Object Restore If Requested ---
if [ "${WITH_S3}" -eq 1 ]; then
  echo -e "\nRestoring S3 objects into '${TARGET_S3_BUCKET}'..."
  S3_RESTORE_CMD=(pnpm exec tsx scripts/s3-restore.mjs --archive "${S3_FILE}" --bucket "${TARGET_S3_BUCKET}" --confirm)
  if [ -n "${TARGET_S3_PREFIX}" ]; then
    S3_RESTORE_CMD+=(--prefix "${TARGET_S3_PREFIX}")
  fi
  if [ -n "${TARGET_S3_ENDPOINT:-${S3_ENDPOINT:-${AWS_ENDPOINT_URL:-${STORAGE_S3_ENDPOINT:-}}}}" ]; then
    S3_RESTORE_CMD+=(--endpoint "${TARGET_S3_ENDPOINT:-${S3_ENDPOINT:-${AWS_ENDPOINT_URL:-${STORAGE_S3_ENDPOINT:-}}}}")
  fi
  if [ -n "${S3_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}" ]; then
    S3_RESTORE_CMD+=(--region "${S3_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}")
  fi
  if [ -n "${ENV_FILE:-}" ]; then
    S3_RESTORE_CMD+=(--env-file "${ENV_FILE}")
  fi

  echo "Executing S3 restore engine (credentials protected from OS process table)..."
  if (
    [ -n "${S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" ] && export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
    [ -n "${S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" ] && export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
    "${S3_RESTORE_CMD[@]}"
  ); then
    echo "✓ S3 objects restored and verified successfully."
  else
    echo "Error: S3 restore failed." >&2
    exit 1
  fi
fi

echo "================================================================================"
echo "✓ Vibress Restore Completed Successfully at $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"
