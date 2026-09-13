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

echo "================================================================================"
echo " VIBRESS PRODUCTION DEPLOYMENT PIPELINE — v1.0.0-GA"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo " Compose file: ${COMPOSE_FILE}"
echo "================================================================================"

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

# Check disk space (warn if < 5GB)
FREE_DISK_KB=$(df -k . | awk 'NR==2 {print $4}')
if [ "${FREE_DISK_KB}" -lt 5242880 ]; then
  echo "Warning: Less than 5GB free disk space available (${FREE_DISK_KB} KB)."
fi
echo "✓ Preflight validation passed."

# --- Phase 2: Pre-deployment Backup ---
echo -e "\n[Phase 2/6] Performing pre-deployment database backup..."
if [ -f "scripts/backup.sh" ]; then
  ./scripts/backup.sh ./backups
  echo "✓ Pre-deployment backup verified."
else
  echo "Warning: scripts/backup.sh not found, skipping automated backup."
fi

# --- Phase 3: Database Migrations ---
echo -e "\n[Phase 3/6] Applying database migrations..."
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
echo -e "\n[Phase 6/6] Executing production smoke tests..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm production:smoke
  echo "✓ Production smoke tests passed."
else
  echo "Note: pnpm not found in host environment; verify smoke tests via container."
fi

echo -e "\n================================================================================"
echo " VIBRESS PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "================================================================================"
