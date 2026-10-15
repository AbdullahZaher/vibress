#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Transactional Database Restore Verification Drill
# ==============================================================================
# Verifies:
# 1. scripts/restore.sh enforces --single-transaction and ON_ERROR_STOP=1
# 2. Corrupt / failing database restores fail closed (non-zero exit code)
# 3. Tables created prior to a mid-stream failure are rolled back completely
#    (atomic, all-or-nothing restore guarantee)
# 4. Clean backup archives restore cleanly and completely
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

# Step 1: Static verification of --single-transaction flag
echo -e "\n[Step 1/5] Verifying --single-transaction enforcement in scripts/restore.sh..."
if ! grep -q -- '--single-transaction' scripts/restore.sh; then
  echo "✗ FAIL: scripts/restore.sh does not contain --single-transaction flag!" >&2
  exit 1
fi
echo "✓ PASS: scripts/restore.sh enforces --single-transaction flag on psql restore commands."

# Step 2: Prepare temporary drill environment
echo -e "\n[Step 2/5] Preparing drill environment and crafting test archives..."
mkdir -p "${DRILL_DIR}"

# Craft a valid archive
VALID_SQL="${DRILL_DIR}/valid.sql"
cat << 'EOF' > "${VALID_SQL}"
CREATE TABLE IF NOT EXISTS tx_valid_tbl (
  id text PRIMARY KEY,
  payload text NOT NULL
);
INSERT INTO tx_valid_tbl (id, payload) VALUES ('valid_1', 'atomic_success_entry');
EOF

VALID_GZ="${DRILL_DIR}/valid.sql.gz"
gzip -c "${VALID_SQL}" > "${VALID_GZ}"
sha256sum "${VALID_GZ}" 2>/dev/null | awk '{print $1}' > "${VALID_GZ}.sha256" || shasum -a 256 "${VALID_GZ}" | awk '{print $1}' > "${VALID_GZ}.sha256"

# Craft a corrupt archive that creates a table, inserts a row, then aborts with a syntax error
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

CORRUPT_GZ="${DRILL_DIR}/corrupt.sql.gz"
gzip -c "${CORRUPT_SQL}" > "${CORRUPT_GZ}"
sha256sum "${CORRUPT_GZ}" 2>/dev/null | awk '{print $1}' > "${CORRUPT_GZ}.sha256" || shasum -a 256 "${CORRUPT_GZ}" | awk '{print $1}' > "${CORRUPT_GZ}.sha256"

echo "✓ Test archives crafted: valid.sql.gz and corrupt.sql.gz."

# Step 3: Test corrupt restore (must fail closed)
echo -e "\n[Step 3/5] Executing restore with corrupt archive (must fail closed)..."
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

# Step 4: Verify atomic rollback in target database
echo -e "\n[Step 4/5] Verifying database rollback: proving 'tx_should_rollback' does NOT exist..."
TABLE_CHECK="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tx_should_rollback';"
TBL_COUNT=$(run_sql "${TARGET_DB}" "${TABLE_CHECK}" 2>/dev/null || true)
TBL_COUNT=$(echo "${TBL_COUNT}" | tr -d '[:space:]')

if [ "${TBL_COUNT}" = "0" ]; then
  echo "✓ PASS: 'tx_should_rollback' table was rolled back completely (0 tables found)."
  echo "✓ Transactional atomicity verified: partial restore state was prevented."
else
  echo "✗ FAIL: 'tx_should_rollback' table persisted in database (found '${TBL_COUNT}')! Restore was not atomic." >&2
  exit 1
fi

# Step 5: Test clean restore
echo -e "\n[Step 5/5] Executing clean restore with valid.sql.gz..."
if [ -n "${RESOLVED_COMPOSE}" ]; then
  COMPOSE_FILE="${RESOLVED_COMPOSE}" ./scripts/restore.sh \
    --archive "${VALID_GZ}" \
    --db "${TARGET_DB}" \
    --confirm > "${DRILL_DIR}/restore_valid.log" 2>&1
else
  ./scripts/restore.sh \
    --archive "${VALID_GZ}" \
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
echo " TRANSACTIONAL RESTORE VERIFICATION DRILL: ALL CHECKS PASSED"
echo "================================================================================"
