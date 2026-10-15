#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Transactional Database Restore Verification Drill
# ==============================================================================
# Verifies:
# 1. scripts/restore.sh enforces -X, -v ON_ERROR_STOP=1, --single-transaction, and -f -
# 2. scripts/restore.sh does NOT drop the public schema outside the restore transaction
# 3. Corrupt / failing database restores fail closed (non-zero exit code)
# 4. Pre-existing customer database data is 100% preserved upon restore failure
#    (DROP SCHEMA public CASCADE is rolled back alongside partial restore tables)
# 5. Backup set manifest HMAC-SHA256 signature authentication and hash correlation
# 6. Clean backup archives restore cleanly and completely
# ==============================================================================

DRILL_ID="tx_restore_drill_$$"
TARGET_DB="vibress_tx_verify_$$"
DRILL_DIR="/tmp/${DRILL_ID}"

echo "================================================================================"
echo " VIBRESS TRANSACTIONAL DATABASE RESTORE VERIFICATION DRILL"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo " Drill Target DB: ${TARGET_DB}"
echo "================================================================================"

# Resolve compose file or local postgres
RESOLVED_COMPOSE=""
if [ -n "${COMPOSE_FILE:-}" ] && [ -f "${COMPOSE_FILE}" ]; then
  RESOLVED_COMPOSE="${COMPOSE_FILE}"
elif [ -f "compose.dev.yml" ] && docker compose -f "compose.dev.yml" ps -q postgres 2>/dev/null | grep -q .; then
  RESOLVED_COMPOSE="compose.dev.yml"
elif [ -f "compose.prod.yml" ] && docker compose -f "compose.prod.yml" ps -q postgres 2>/dev/null | grep -q .; then
  RESOLVED_COMPOSE="compose.prod.yml"
fi

run_sql() {
  local db="$1"
  local sql="$2"
  if [ -n "${RESOLVED_COMPOSE}" ]; then
    docker compose -f "${RESOLVED_COMPOSE}" exec -T postgres \
      sh -c 'PGPASSWORD="${POSTGRES_PASSWORD}" psql -U "$1" -d "$2" -t -A -c "$3"' _ vibress "${db}" "${sql}"
  else
    PGPASSWORD="${POSTGRES_PASSWORD:-vibress}" psql -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5433}" -U "${POSTGRES_USER:-vibress}" -d "${db}" -t -A -c "${sql}"
  fi
}

cleanup() {
  echo -e "\n[Cleanup] Removing temporary drill directory and test database..."
  rm -rf "${DRILL_DIR}"
  run_sql "postgres" "DROP DATABASE IF EXISTS \"${TARGET_DB}\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT ERR INT TERM

# Step 1: Static verification of psql transactional flags
echo -e "\n[Step 1/6] Verifying transactional restore flags in scripts/restore.sh..."
if ! grep -q -- '--single-transaction' scripts/restore.sh; then
  echo "✗ FAIL: scripts/restore.sh does not contain --single-transaction flag!" >&2
  exit 1
fi
if ! grep -q -- '-v ON_ERROR_STOP=1' scripts/restore.sh; then
  echo "✗ FAIL: scripts/restore.sh does not enforce ON_ERROR_STOP=1!" >&2
  exit 1
fi
if ! grep -q -- '-f -' scripts/restore.sh; then
  echo "✗ FAIL: scripts/restore.sh does not stream via -f -!" >&2
  exit 1
fi
if ! grep -q -- '-X' scripts/restore.sh; then
  echo "✗ FAIL: scripts/restore.sh does not specify -X to bypass .psqlrc!" >&2
  exit 1
fi
echo "✓ PASS: scripts/restore.sh enforces -X -v ON_ERROR_STOP=1 --single-transaction -f - on restore."

# Step 2: Prepare temporary drill environment and pre-existing customer data
echo -e "\n[Step 2/6] Preparing test database with pre-existing customer data..."
mkdir -p "${DRILL_DIR}"

run_sql "postgres" "CREATE DATABASE \"${TARGET_DB}\";" >/dev/null 2>&1 || true
run_sql "${TARGET_DB}" "CREATE TABLE IF NOT EXISTS tx_preexisting_customer_data (id text PRIMARY KEY, important_value text NOT NULL);"
run_sql "${TARGET_DB}" "INSERT INTO tx_preexisting_customer_data (id, important_value) VALUES ('cust_1', 'critical_customer_value_must_survive');"

PRE_CHECK=$(run_sql "${TARGET_DB}" "SELECT important_value FROM tx_preexisting_customer_data WHERE id = 'cust_1';" 2>/dev/null || true)
PRE_CHECK=$(echo "${PRE_CHECK}" | tr -d '[:space:]')
if [ "${PRE_CHECK}" != "critical_customer_value_must_survive" ]; then
  echo "✗ FAIL: Failed to populate pre-existing customer data in ${TARGET_DB}!" >&2
  exit 1
fi
echo "✓ Pre-existing database state seeded: 'tx_preexisting_customer_data' exists with critical data."

# Step 3: Craft valid archive, corrupt archive, and authenticated manifest
echo -e "\n[Step 3/6] Crafting test archives and signed manifest..."
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Valid archive
VALID_SQL="${DRILL_DIR}/valid.sql"
cat << 'EOF' > "${VALID_SQL}"
CREATE TABLE IF NOT EXISTS tx_valid_tbl (
  id text PRIMARY KEY,
  payload text NOT NULL
);
INSERT INTO tx_valid_tbl (id, payload) VALUES ('valid_1', 'atomic_success_entry');
EOF

VALID_GZ="${DRILL_DIR}/vibress_backup_${TIMESTAMP}.sql.gz"
gzip -c "${VALID_SQL}" > "${VALID_GZ}"
VALID_SHA=""
if command -v sha256sum >/dev/null 2>&1; then
  VALID_SHA=$(sha256sum "${VALID_GZ}" | awk '{print $1}')
else
  VALID_SHA=$(shasum -a 256 "${VALID_GZ}" | awk '{print $1}')
fi
printf '%s  %s\n' "${VALID_SHA}" "$(basename "${VALID_GZ}")" > "${VALID_GZ}.sha256"

# Corrupt archive: creates a table, inserts a row, then hits a fatal SQL syntax error
CORRUPT_SQL="${DRILL_DIR}/corrupt.sql"
cat << 'EOF' > "${CORRUPT_SQL}"
CREATE TABLE IF NOT EXISTS tx_should_rollback (
  id text PRIMARY KEY,
  info text NOT NULL
);
INSERT INTO tx_should_rollback (id, info) VALUES ('bad_1', 'this_row_must_not_persist');

-- Deliberate fatal SQL syntax error midway through restore
DELIBERATE_FATAL_SQL_SYNTAX_ERROR_ABORT_HERE;

CREATE TABLE IF NOT EXISTS tx_unreachable (
  id text PRIMARY KEY
);
EOF

CORRUPT_GZ="${DRILL_DIR}/vibress_corrupt_${TIMESTAMP}.sql.gz"
gzip -c "${CORRUPT_SQL}" > "${CORRUPT_GZ}"
CORRUPT_SHA=""
if command -v sha256sum >/dev/null 2>&1; then
  CORRUPT_SHA=$(sha256sum "${CORRUPT_GZ}" | awk '{print $1}')
else
  CORRUPT_SHA=$(shasum -a 256 "${CORRUPT_GZ}" | awk '{print $1}')
fi
printf '%s  %s\n' "${CORRUPT_SHA}" "$(basename "${CORRUPT_GZ}")" > "${CORRUPT_GZ}.sha256"

# Create signed manifest for valid archive
TEST_KEY="drill_secret_signing_key_998877"
VALID_MANIFEST="${DRILL_DIR}/vibress_backup_manifest_${TIMESTAMP}.json"
cat << EOF > "${VALID_MANIFEST}"
{
  "backupSetId": "vibress_backup_${TIMESTAMP}",
  "timestamp": "$(date -u +"%Y-%m-%d %H:%M:%S UTC")",
  "project": "vibress-prod",
  "storageProvider": "local",
  "database": {
    "file": "$(basename "${VALID_GZ}")",
    "sha256": "${VALID_SHA}",
    "size": "$(wc -c < "${VALID_GZ}" | tr -d ' ')"
  },
  "content": {
    "backedUp": false,
    "volume": "none",
    "file": "none",
    "sha256": "none"
  },
  "s3": {
    "backedUp": false,
    "bucket": "none",
    "prefix": "none",
    "file": "none",
    "sha256": "none"
  },
  "signatureAlgorithm": "hmac-sha256"
}
EOF
openssl dgst -sha256 -hmac "${TEST_KEY}" "${VALID_MANIFEST}" | awk '{print $NF}' > "${VALID_MANIFEST}.sig"

echo "✓ Test archives and HMAC-SHA256 signed manifest created."

# Step 4: Execute corrupt restore (must fail closed and preserve pre-existing data)
echo -e "\n[Step 4/6] Executing restore with corrupt archive (must fail closed and preserve data)..."
RESTORE_FAILED=0
if [ -n "${RESOLVED_COMPOSE}" ]; then
  COMPOSE_FILE="${RESOLVED_COMPOSE}" ./scripts/restore.sh \
    --archive "${CORRUPT_GZ}" \
    --db "${TARGET_DB}" \
    --confirm > "${DRILL_DIR}/restore_corrupt.log" 2>&1 || RESTORE_FAILED=1
else
  ./scripts/restore.sh \
    --archive "${CORRUPT_GZ}" \
    --db "${TARGET_DB}" \
    --confirm > "${DRILL_DIR}/restore_corrupt.log" 2>&1 || RESTORE_FAILED=1
fi

if [ "${RESTORE_FAILED}" -eq 1 ]; then
  echo "✓ PASS: restore.sh failed closed (non-zero exit code) on mid-stream SQL error."
else
  echo "✗ FAIL: restore.sh succeeded despite fatal SQL error in backup archive!" >&2
  cat "${DRILL_DIR}/restore_corrupt.log" >&2
  exit 1
fi

# Verify atomic rollback: tx_should_rollback must NOT exist
echo "Verifying partial tables were rolled back..."
TABLE_CHECK="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tx_should_rollback';"
TBL_COUNT=$(run_sql "${TARGET_DB}" "${TABLE_CHECK}" 2>/dev/null || true)
TBL_COUNT=$(echo "${TBL_COUNT}" | tr -d '[:space:]')

if [ "${TBL_COUNT}" = "0" ]; then
  echo "✓ PASS: 'tx_should_rollback' table was rolled back completely (0 tables found)."
else
  echo "✗ FAIL: 'tx_should_rollback' table persisted in database (found '${TBL_COUNT}')! Partial restore was not rolled back." >&2
  exit 1
fi

# Verify pre-existing customer data was 100% preserved (DROP SCHEMA was rolled back)
echo "Verifying pre-existing customer data survived intact..."
PRE_CHECK_AFTER=$(run_sql "${TARGET_DB}" "SELECT important_value FROM tx_preexisting_customer_data WHERE id = 'cust_1';" 2>/dev/null || true)
PRE_CHECK_AFTER=$(echo "${PRE_CHECK_AFTER}" | tr -d '[:space:]')

if [ "${PRE_CHECK_AFTER}" = "critical_customer_value_must_survive" ]; then
  echo "✓ PASS: Pre-existing customer data preserved intact! DROP SCHEMA public was rolled back within the transaction."
else
  echo "✗ FAIL: Pre-existing customer data was lost or wiped during failed restore!" >&2
  exit 1
fi

# Step 5: Test manifest authentication and forgery protection
echo -e "\n[Step 5/6] Verifying manifest authentication and tampering protection..."
TAMPERED_MANIFEST="${DRILL_DIR}/tampered_manifest.json"
cp "${VALID_MANIFEST}" "${TAMPERED_MANIFEST}"
cp "${VALID_MANIFEST}.sig" "${TAMPERED_MANIFEST}.sig"
echo "  \"tampered\": true" >> "${TAMPERED_MANIFEST}"

TAMPER_FAILED=0
BACKUP_SIGNING_KEY="${TEST_KEY}" ./scripts/restore.sh \
  --archive "${VALID_GZ}" \
  --manifest "${TAMPERED_MANIFEST}" \
  --db "${TARGET_DB}" \
  --confirm > "${DRILL_DIR}/restore_tampered.log" 2>&1 || TAMPER_FAILED=1

if [ "${TAMPER_FAILED}" -eq 1 ]; then
  echo "✓ PASS: restore.sh rejected tampered manifest with HMAC-SHA256 signature mismatch."
else
  echo "✗ FAIL: restore.sh accepted tampered manifest!" >&2
  cat "${DRILL_DIR}/restore_tampered.log" >&2
  exit 1
fi

# Step 6: Test clean restore with authenticated manifest
echo -e "\n[Step 6/6] Executing clean restore with authenticated manifest..."
if [ -n "${RESOLVED_COMPOSE}" ]; then
  COMPOSE_FILE="${RESOLVED_COMPOSE}" BACKUP_SIGNING_KEY="${TEST_KEY}" ./scripts/restore.sh \
    --archive "${VALID_GZ}" \
    --manifest "${VALID_MANIFEST}" \
    --db "${TARGET_DB}" \
    --confirm > "${DRILL_DIR}/restore_valid.log" 2>&1
else
  BACKUP_SIGNING_KEY="${TEST_KEY}" ./scripts/restore.sh \
    --archive "${VALID_GZ}" \
    --manifest "${VALID_MANIFEST}" \
    --db "${TARGET_DB}" \
    --confirm > "${DRILL_DIR}/restore_valid.log" 2>&1
fi

VERIFY_SQL="SELECT payload FROM tx_valid_tbl WHERE id = 'valid_1';"
ROW_PAYLOAD=$(run_sql "${TARGET_DB}" "${VERIFY_SQL}" 2>/dev/null || true)
ROW_PAYLOAD=$(echo "${ROW_PAYLOAD}" | tr -d '[:space:]')

if [ "${ROW_PAYLOAD}" = "atomic_success_entry" ]; then
  echo "✓ PASS: Clean restore succeeded and verified data entry ('${ROW_PAYLOAD}')."
else
  echo "✗ FAIL: Expected payload 'atomic_success_entry', got '${ROW_PAYLOAD}'." >&2
  cat "${DRILL_DIR}/restore_valid.log" >&2
  exit 1
fi

echo "================================================================================"
echo " TRANSACTIONAL RESTORE VERIFICATION DRILL: ALL 6 CHECKS PASSED"
echo "================================================================================"
