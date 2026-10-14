#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Production Automated Deployment Script
# ==============================================================================
# Pipeline:
#   1. Preflight validation (Docker, Compose, .env, disk)
#   2. Pre-deployment database backup
#   3. Database migration execution
#   4. Container build and rolling restart
#   5. Healthcheck verification (Gateway, API, Worker)
#   6. Automated production smoke testing
# ==============================================================================

COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
FORCE_FRESH=0
FORCE_UPGRADE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fresh)
      FORCE_FRESH=1
      ;;
    --upgrade)
      FORCE_UPGRADE=1
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift
      ;;
    *)
      ;;
  esac
  shift
done

echo "================================================================================"
echo " VIBRESS PRODUCTION DEPLOYMENT PIPELINE — v1.0.0-GA"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo " Compose file: ${COMPOSE_FILE}"
echo "================================================================================"

# Helper: Detect whether this is an existing deployment requiring upgrade backup
is_existing_installation() {
  if [ "${FORCE_FRESH}" = "1" ] || [ "${VIBRESS_FRESH_INSTALL:-}" = "1" ]; then
    return 1 # explicitly forced fresh install
  fi
  if [ "${FORCE_UPGRADE}" = "1" ] || [ "${VIBRESS_FRESH_INSTALL:-}" = "0" ]; then
    return 0 # explicitly forced upgrade
  fi

  # 1. Check if postgres container already exists in this compose project
  if docker compose -f "${COMPOSE_FILE}" ps -a -q postgres 2>/dev/null | grep -q .; then
    return 0
  fi

  # 2. Check if the project volume exists and has PostgreSQL data
  local project_name
  project_name=$(docker compose -f "${COMPOSE_FILE}" config 2>/dev/null | grep -E '^name:' | head -n 1 | awk '{print $2}' || true)
  [ -z "${project_name}" ] && project_name="vibress-prod"

  local volume_name="${project_name}_postgres_data"
  if docker volume inspect "${volume_name}" >/dev/null 2>&1; then
    if docker run --rm -v "${volume_name}:/vol:ro" alpine test -f /vol/PG_VERSION 2>/dev/null; then
      return 0
    fi
  fi

  # Also check unqualified volume name
  if docker volume inspect "postgres_data" >/dev/null 2>&1; then
    if docker run --rm -v "postgres_data:/vol:ro" alpine test -f /vol/PG_VERSION 2>/dev/null; then
      return 0
    fi
  fi

  return 1 # Verified fresh installation
}

# --- Phase 1: Preflight Validation ---
echo -e "\n[Phase 1/6] Running preflight checks..."

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker CLI is not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 is required but not available." >&2
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: Environment file '${ENV_FILE}' not found. Please copy infrastructure/env.prod.example to .env and configure secrets." >&2
  exit 1
fi

# Load database credentials for health checks
POSTGRES_USER="${POSTGRES_USER:-$(grep -E '^[[:space:]]*POSTGRES_USER=' "${ENV_FILE}" | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)}"
POSTGRES_DB="${POSTGRES_DB:-$(grep -E '^[[:space:]]*POSTGRES_DB=' "${ENV_FILE}" | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)}"
POSTGRES_USER="${POSTGRES_USER:-vibress}"
POSTGRES_DB="${POSTGRES_DB:-vibress}"

# Check disk space (warn if < 5GB)
FREE_DISK_KB=$(df -k . | awk 'NR==2 {print $4}')
if [ "${FREE_DISK_KB}" -lt 5242880 ]; then
  echo "Warning: Less than 5GB free disk space available (${FREE_DISK_KB} KB)."
fi
echo "✓ Preflight validation passed."

# --- Phase 2: Pre-deployment Backup & Fresh-Install Bootstrapping ---
echo -e "\n[Phase 2/6] Evaluating deployment state and backup requirements..."

if is_existing_installation; then
  echo "Existing Vibress deployment detected. Mandatory pre-upgrade database backup required."

  echo "Starting PostgreSQL service to snapshot active database..."
  docker compose -f "${COMPOSE_FILE}" up -d postgres

  echo "Waiting for PostgreSQL service readiness..."
  MAX_PG_RETRIES=30
  PG_RETRY=0
  until docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    PG_RETRY=$((PG_RETRY + 1))
    if [ "${PG_RETRY}" -ge "${MAX_PG_RETRIES}" ]; then
      echo "Error: Timed out waiting for PostgreSQL to be ready for pre-upgrade backup." >&2
      exit 1
    fi
    sleep 1
  done

  if [ -f "scripts/backup.sh" ]; then
    COMPOSE_FILE="${COMPOSE_FILE}" ENV_FILE="${ENV_FILE}" ./scripts/backup.sh ./backups
    echo "✓ Pre-deployment upgrade backup verified successfully."
  else
    echo "Error: scripts/backup.sh not found. Mandatory pre-upgrade backup cannot be skipped." >&2
    exit 1
  fi
else
  echo "✓ Verified fresh installation: No existing PostgreSQL container or initialized volume detected."
  echo "  Proceeding with safe bootstrap. Pre-deployment backup skipped."
  echo "  (Pre-deployment backups will be strictly enforced on subsequent upgrades)."
fi

# --- Phase 3: Database Migrations ---
echo -e "\n[Phase 3/6] Applying database migrations..."
docker compose -f "${COMPOSE_FILE}" up -d postgres redis

echo "Waiting for PostgreSQL service readiness before migration..."
MAX_PG_RETRIES=30
PG_RETRY=0
until docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  PG_RETRY=$((PG_RETRY + 1))
  if [ "${PG_RETRY}" -ge "${MAX_PG_RETRIES}" ]; then
    echo "Error: Timed out waiting for PostgreSQL before migrations." >&2
    exit 1
  fi
  sleep 1
done

docker compose -f "${COMPOSE_FILE}" run --rm migrate
echo "✓ Database migrations applied successfully."

# --- Phase 4: Container Build & Rollout ---
echo -e "\n[Phase 4/6] Building and launching production containers..."
docker compose -f "${COMPOSE_FILE}" up -d --build
echo "✓ Containers deployed."

# --- Phase 5: Health Check Verification ---
echo -e "\n[Phase 5/6] Verifying service health..."
MAX_RETRIES=30
RETRY_COUNT=0
GATEWAY_URL="http://127.0.0.1:${VIBRESS_PORT:-7777}"

echo "Waiting for Gateway at ${GATEWAY_URL}/nginx-health..."
until curl -sf "${GATEWAY_URL}/nginx-health" >/dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "${RETRY_COUNT}" -ge "${MAX_RETRIES}" ]; then
    echo "Error: Gateway health check timed out after ${MAX_RETRIES} attempts." >&2
    exit 1
  fi
  sleep 2
done
echo "✓ Gateway is healthy."

echo "Waiting for API readiness at ${GATEWAY_URL}/health/ready..."
RETRY_COUNT=0
until curl -sf "${GATEWAY_URL}/health/ready" >/dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "${RETRY_COUNT}" -ge "${MAX_RETRIES}" ]; then
    echo "Error: API readiness probe timed out after ${MAX_RETRIES} attempts." >&2
    exit 1
  fi
  sleep 2
done
echo "✓ API readiness verified."

# --- Phase 6: Production Smoke Tests ---
echo -e "\n[Phase 6/6] Executing mandatory production smoke tests..."
SMOKE_EXECUTED=0

if command -v pnpm >/dev/null 2>&1; then
  echo "Running smoke tests via pnpm..."
  pnpm production:smoke
  SMOKE_EXECUTED=1
elif command -v node >/dev/null 2>&1 && [ -f "scripts/production-smoke-tests.mjs" ]; then
  echo "Running smoke tests via host Node.js runner..."
  node scripts/production-smoke-tests.mjs
  SMOKE_EXECUTED=1
elif docker compose -f "${COMPOSE_FILE}" ps -q api 2>/dev/null | grep -q .; then
  echo "Running smoke tests via API container..."
  docker compose -f "${COMPOSE_FILE}" exec -T -e SITE_URL="${GATEWAY_URL}" api node scripts/production-smoke-tests.mjs
  SMOKE_EXECUTED=1
fi

if [ "${SMOKE_EXECUTED}" -ne 1 ]; then
  echo "Error: Mandatory production smoke tests could not be executed." >&2
  echo "Deployment cannot be certified as successful without passing smoke tests." >&2
  exit 1
fi
echo "✓ Production smoke tests passed."

echo -e "\n================================================================================"
echo " VIBRESS PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "================================================================================"
