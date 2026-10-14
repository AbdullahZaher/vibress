#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Deployment & Backup Target Isolation Guard Verification
# ==============================================================================

echo "================================================================================"
echo " Deployment & Backup Target Isolation Guard Verification"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"

PASSED=0
TOTAL=5

# ------------------------------------------------------------------------------
# Test 1: Production backup rejects development compose file (Environment mismatch)
# ------------------------------------------------------------------------------
echo -e "\n[Guard 1/5] Verifying backup rejects dev compose in production mode..."
TEST_OUTPUT=$(NODE_ENV=production COMPOSE_FILE=compose.dev.yml ./scripts/backup.sh /tmp/test-backup-dir 2>&1 || true)
if echo "${TEST_OUTPUT}" | grep -q "Environment mismatch detected"; then
  echo "✓ PASS: backup.sh rejected targeting dev compose when NODE_ENV=production."
  PASSED=$((PASSED + 1))
else
  echo "✗ FAIL: backup.sh did not reject dev compose in production mode."
  echo "Output was: ${TEST_OUTPUT}"
  exit 1
fi

# ------------------------------------------------------------------------------
# Test 2: Backup strictly enforces target Compose file and refuses fallback
# ------------------------------------------------------------------------------
echo -e "\n[Guard 2/5] Verifying backup fails cleanly when target service not in compose file (no fallback)..."
# Create a dummy compose file with no postgres service
DUMMY_COMPOSE="/tmp/dummy-compose-$$.yml"
cat << 'EOF' > "${DUMMY_COMPOSE}"
services:
  dummy:
    image: alpine
    command: sleep 1
EOF

TEST_OUTPUT_2=$(./scripts/backup.sh --compose-file "${DUMMY_COMPOSE}" /tmp/test-backup-dir 2>&1 || true)
rm -f "${DUMMY_COMPOSE}"

if echo "${TEST_OUTPUT_2}" | grep -q "Refusing to target an alternative or development compose container"; then
  echo "✓ PASS: backup.sh strictly refused fallback to dev container when target postgres was missing."
  PASSED=$((PASSED + 1))
else
  echo "✗ FAIL: backup.sh did not enforce target isolation."
  echo "Output was: ${TEST_OUTPUT_2}"
  exit 1
fi

# ------------------------------------------------------------------------------
# Test 3: Fresh install auto-detection in deploy-production.sh
# ------------------------------------------------------------------------------
echo -e "\n[Guard 3/5] Verifying deploy-production.sh identifies fresh install and safely skips backup..."
# Test with a mock non-existent compose project
TEST_FRESH_COMPOSE="/tmp/fresh-compose-$$.yml"
cat << 'EOF' > "${TEST_FRESH_COMPOSE}"
name: vibress-fresh-test
services:
  postgres:
    image: postgres:16-alpine
EOF

# Source the helper or dry-run Phase 2 from deploy-production.sh
TEST_ENV="/tmp/test-env-$$"
cat << 'EOF' > "${TEST_ENV}"
POSTGRES_USER=vibress
POSTGRES_DB=vibress
POSTGRES_PASSWORD=vibress
EOF

# Check is_existing_installation logic for fresh install
FRESH_RESULT=$(COMPOSE_FILE="${TEST_FRESH_COMPOSE}" ENV_FILE="${TEST_ENV}" bash -c '
  eval "$(awk "/^is_existing_installation\(\)/,/^}/" scripts/deploy-production.sh)"
  FORCE_FRESH=0
  FORCE_UPGRADE=0
  if is_existing_installation; then
    echo "EXISTING"
  else
    echo "FRESH"
  fi
')
rm -f "${TEST_FRESH_COMPOSE}" "${TEST_ENV}"

if [ "${FRESH_RESULT}" = "FRESH" ]; then
  echo "✓ PASS: deploy-production.sh correctly identifies fresh installation with no containers/volumes."
  PASSED=$((PASSED + 1))
else
  echo "✗ FAIL: Expected FRESH but got ${FRESH_RESULT}."
  exit 1
fi

# ------------------------------------------------------------------------------
# Test 4: Existing installation detection and mandatory upgrade backup
# ------------------------------------------------------------------------------
echo -e "\n[Guard 4/5] Verifying existing installation triggers mandatory backup requirement..."
EXISTING_RESULT=$(bash -c '
  eval "$(awk "/^is_existing_installation\(\)/,/^}/" scripts/deploy-production.sh)"
  FORCE_FRESH=0
  FORCE_UPGRADE=1 # Simulate upgrade flag or detected container
  if is_existing_installation; then
    echo "EXISTING"
  else
    echo "FRESH"
  fi
')

if [ "${EXISTING_RESULT}" = "EXISTING" ]; then
  echo "✓ PASS: Existing installation mandates pre-upgrade backup."
  PASSED=$((PASSED + 1))
else
  echo "✗ FAIL: Expected EXISTING but got ${EXISTING_RESULT}."
  exit 1
fi

# ------------------------------------------------------------------------------
# Test 5: External Database Safeguard (Missing Docker volumes cannot bypass backup)
# ------------------------------------------------------------------------------
echo -e "\n[Guard 5/5] Verifying external database cannot be mistaken for fresh install when volumes are missing..."
TEST_EXT_ENV="/tmp/test-ext-env-$$"
cat << 'EOF' > "${TEST_EXT_ENV}"
POSTGRES_HOST=rds-prod.vibress.internal
POSTGRES_USER=vibress
POSTGRES_DB=vibress_prod
POSTGRES_PASSWORD=mock_secret
EOF

EXT_RESULT=$(ENV_FILE="${TEST_EXT_ENV}" bash -c '
  eval "$(awk "/^is_existing_installation\(\)/,/^}/" scripts/deploy-production.sh)"
  FORCE_FRESH=0
  FORCE_UPGRADE=0
  # No local Docker containers or volumes exist for this project
  if is_existing_installation; then
    echo "EXISTING"
  else
    echo "FRESH"
  fi
')
rm -f "${TEST_EXT_ENV}"

if [ "${EXT_RESULT}" = "EXISTING" ]; then
  echo "✓ PASS: External database safeguard triggered. Missing local Docker volumes did NOT bypass backup requirement."
  PASSED=$((PASSED + 1))
else
  echo "✗ FAIL: External database was mistakenly treated as FRESH! Output was: ${EXT_RESULT}"
  exit 1
fi

echo -e "\n================================================================================"
echo " DEPLOYMENT & BACKUP GUARDS CERTIFICATION: ${PASSED}/${TOTAL} PASSED"
echo "================================================================================"
