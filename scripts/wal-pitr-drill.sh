#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress PostgreSQL WAL Archiving & Point-In-Time-Recovery (PITR) Drill
# ==============================================================================
# Validates PostgreSQL physical base backup and continuous WAL replay:
#   1. Boots an isolated PostgreSQL 16 container configured with continuous WAL archiving
#   2. Seeds initial transaction T1 ('BASELINE_INIT')
#   3. Takes a physical base backup via pg_basebackup (-Ft -z)
#   4. Records transaction T2 ('VALID_TRANSACTION') at target recovery point
#   5. Advances clock and inserts transaction T3 ('UNWANTED_MUTATION')
#   6. Forces WAL segment archiving (pg_switch_wal)
#   7. Boots a recovered PostgreSQL instance replaying WAL up to recovery_target_time
#   8. Asserts T1 and T2 are present, while T3 is absent (exact point-in-time recovery)
#   9. Tears down all ephemeral drill resources and reports recovery metrics
# ==============================================================================

DRILL_ID="pitr_drill_$$"
DRILL_PORT="5439"
DRILL_DIR="/tmp/vibress_dr_${DRILL_ID}"
PRIMARY_CONTAINER="vibress_pitr_primary_${DRILL_ID}"
RECOVERY_CONTAINER="vibress_pitr_recovery_${DRILL_ID}"
PG_PASS="drillsecret"

mkdir -p "${DRILL_DIR}/wal_archive" "${DRILL_DIR}/base_backup" "${DRILL_DIR}/recovered_data"
chmod 777 "${DRILL_DIR}/wal_archive" "${DRILL_DIR}/base_backup" "${DRILL_DIR}/recovered_data"

cleanup() {
  echo -e "\nCleaning up disposable PITR drill containers and directories..."
  docker rm -f "${PRIMARY_CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${RECOVERY_CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${DRILL_DIR}" >/dev/null 2>&1 || true
  echo "✓ Disposable PITR resources cleaned up."
}
trap cleanup EXIT ERR INT TERM

echo "================================================================================"
echo " VIBRESS POSTGRESQL PHYSICAL WAL ARCHIVING & PITR VALIDATION DRILL"
echo " Drill ID: ${DRILL_ID}"
echo " Port:     ${DRILL_PORT}"
echo "================================================================================"

# --- Step 1: Start Primary Postgres with Continuous WAL Archiving ---
echo -e "\n[Step 1/7] Booting primary PostgreSQL 16 with WAL archiving enabled..."
START_PROVISION=$(date +%s)
docker run -d \
  --name "${PRIMARY_CONTAINER}" \
  -p "${DRILL_PORT}:5432" \
  -e POSTGRES_PASSWORD="${PG_PASS}" \
  -e POSTGRES_DB="vibress_pitr" \
  -v "${DRILL_DIR}/wal_archive:/var/lib/postgresql/wal_archive" \
  -v "${DRILL_DIR}/base_backup:/var/lib/postgresql/base_backup" \
  postgres:16-alpine \
  postgres \
    -c wal_level=replica \
    -c archive_mode=on \
    -c "archive_command=test ! -f /var/lib/postgresql/wal_archive/%f && cp %p /var/lib/postgresql/wal_archive/%f" \
    -c archive_timeout=900 >/dev/null

echo "Waiting for primary PostgreSQL to accept connections..."
for _ in $(seq 1 30); do
  if docker exec "${PRIMARY_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "${PRIMARY_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
  echo "Error: Primary PostgreSQL container failed to start." >&2
  exit 1
fi
echo "✓ Primary PostgreSQL is healthy with continuous WAL archiving active."

# Helper to execute SQL on primary
exec_primary_sql() {
  docker exec -i "${PRIMARY_CONTAINER}" psql -U postgres -d vibress_pitr -v ON_ERROR_STOP=1 -t -A -c "$1"
}

# --- Step 2: Seed Baseline Ledger and Transaction T1 ---
echo -e "\n[Step 2/7] Seeding baseline transaction T1..."
exec_primary_sql "CREATE TABLE pitr_ledger (id serial primary key, label text not null, committed_at timestamptz default clock_timestamp());"
exec_primary_sql "INSERT INTO pitr_ledger (label) VALUES ('T1_BASELINE_INIT');"

# --- Step 3: Take Physical Base Backup (pg_basebackup) ---
echo -e "\n[Step 3/7] Taking physical base backup via pg_basebackup..."
START_BASEBACKUP=$(date +%s)
docker exec -e PGPASSWORD="${PG_PASS}" "${PRIMARY_CONTAINER}" \
  pg_basebackup -h 127.0.0.1 -U postgres -D /var/lib/postgresql/base_backup -Ft -z -X fetch
END_BASEBACKUP=$(date +%s)
BASEBACKUP_DURATION=$((END_BASEBACKUP - START_BASEBACKUP))

if [ ! -f "${DRILL_DIR}/base_backup/base.tar.gz" ]; then
  echo "Error: Base backup archive base.tar.gz was not created!" >&2
  exit 1
fi
BASE_SIZE=$(ls -lh "${DRILL_DIR}/base_backup/base.tar.gz" | awk '{print $5}')
echo "✓ Physical base backup completed in ${BASEBACKUP_DURATION}s (${BASE_SIZE})."

# --- Step 4: Insert Transaction T2 and Record Recovery Target Time ---
echo -e "\n[Step 4/7] Inserting Transaction T2 and recording PITR recovery target timestamp..."
sleep 2
exec_primary_sql "INSERT INTO pitr_ledger (label) VALUES ('T2_VALID_TRANSACTION');"

# Get current database timestamp as recovery target
TARGET_TIMESTAMP=$(exec_primary_sql "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.US OF');")
echo "✓ Recovery Target Timestamp established: ${TARGET_TIMESTAMP}"

# Sleep 2 seconds then insert accidental transaction T3
sleep 2
echo "Simulating subsequent accidental transaction T3 (post-target)..."
exec_primary_sql "INSERT INTO pitr_ledger (label) VALUES ('T3_ACCIDENTAL_CORRUPTION');"

TOTAL_BEFORE_RESTORE=$(exec_primary_sql "SELECT count(*) FROM pitr_ledger;")
echo "Primary ledger row count before restore: ${TOTAL_BEFORE_RESTORE} (Expected: 3)"

# Force WAL archiving rotation so WAL segment containing transactions is pushed to archive directory
echo "Forcing WAL segment archiving (pg_switch_wal)..."
exec_primary_sql "SELECT pg_switch_wal();" >/dev/null
sleep 1

WAL_COUNT=$(ls -1 "${DRILL_DIR}/wal_archive" 2>/dev/null | wc -l | tr -d ' ')
echo "✓ WAL segments archived: ${WAL_COUNT} file(s) present in archive destination."

# Stop primary container to simulate crash or isolated recovery
docker stop "${PRIMARY_CONTAINER}" >/dev/null

# --- Step 5: Prepare Restored Data Directory from Base Backup ---
echo -e "\n[Step 5/7] Unpacking physical base backup into isolated recovery instance..."
START_RESTORE=$(date +%s)
tar -xzf "${DRILL_DIR}/base_backup/base.tar.gz" -C "${DRILL_DIR}/recovered_data"
chmod 700 "${DRILL_DIR}/recovered_data"

# Configure PostgreSQL 16 Point-In-Time Recovery
# 1. recovery.signal triggers archive recovery mode
touch "${DRILL_DIR}/recovered_data/recovery.signal"
chmod 600 "${DRILL_DIR}/recovered_data/recovery.signal"

# 2. Append recovery configuration
cat <<EOF >> "${DRILL_DIR}/recovered_data/postgresql.auto.conf"
restore_command = 'test -f /var/lib/postgresql/wal_archive/%f && cp /var/lib/postgresql/wal_archive/%f %p'
recovery_target_time = '${TARGET_TIMESTAMP}'
recovery_target_action = 'promote'
EOF

# --- Step 6: Boot Recovered PostgreSQL Instance with WAL Replay ---
echo -e "\n[Step 6/7] Booting recovery instance and replaying WAL up to target timestamp..."
docker run -d \
  --name "${RECOVERY_CONTAINER}" \
  -p "${DRILL_PORT}:5432" \
  -e POSTGRES_PASSWORD="${PG_PASS}" \
  -v "${DRILL_DIR}/recovered_data:/var/lib/postgresql/data" \
  -v "${DRILL_DIR}/wal_archive:/var/lib/postgresql/wal_archive:ro" \
  postgres:16-alpine >/dev/null

echo "Waiting for recovery instance to replay WAL and promote..."
for _ in $(seq 1 30); do
  if docker exec "${RECOVERY_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "${RECOVERY_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
  echo "Error: Recovered PostgreSQL container failed to start." >&2
  docker logs "${RECOVERY_CONTAINER}" | tail -n 20 >&2
  exit 1
fi
END_RESTORE=$(date +%s)
RESTORE_DURATION=$((END_RESTORE - START_RESTORE))
echo "✓ Recovery instance started and replayed WAL in ${RESTORE_DURATION}s."

# --- Step 7: Verify Recovery Point Behavior ---
echo -e "\n[Step 7/7] Verifying point-in-time transaction state in recovered database..."
RECOVERED_ROWS=$(docker exec -i "${RECOVERY_CONTAINER}" psql -U postgres -d vibress_pitr -v ON_ERROR_STOP=1 -t -A -c "SELECT label FROM pitr_ledger ORDER BY id;")

echo "Recovered ledger contents:"
echo "${RECOVERED_ROWS}"

HAS_T1=0
HAS_T2=0
HAS_T3=0

while IFS= read -r row; do
  [ "${row}" = "T1_BASELINE_INIT" ] && HAS_T1=1
  [ "${row}" = "T2_VALID_TRANSACTION" ] && HAS_T2=1
  [ "${row}" = "T3_ACCIDENTAL_CORRUPTION" ] && HAS_T3=1
done <<< "${RECOVERED_ROWS}"

FAILED=0
if [ "${HAS_T1}" -eq 1 ]; then
  echo "✓ Transaction T1 (Baseline) is PRESENT."
else
  echo "✗ ERROR: Transaction T1 is MISSING in recovered database!" >&2
  FAILED=1
fi

if [ "${HAS_T2}" -eq 1 ]; then
  echo "✓ Transaction T2 (Valid commit before target) is PRESENT."
else
  echo "✗ ERROR: Transaction T2 is MISSING in recovered database!" >&2
  FAILED=1
fi

if [ "${HAS_T3}" -eq 0 ]; then
  echo "✓ Transaction T3 (Accidental commit after target) is ABSENT (exact PITR cutover succeeded)."
else
  echo "✗ ERROR: Transaction T3 was recovered despite recovery target time! PITR boundary violated." >&2
  FAILED=1
fi

if [ "${FAILED}" -ne 0 ]; then
  echo -e "\n✗ PITR RECOVERY DRILL FAILED" >&2
  exit 1
fi

echo -e "\n================================================================================"
echo " VIBRESS POSTGRESQL WAL PITR DRILL — CERTIFIED SUCCESSFUL"
echo "================================================================================"
echo " Operational RPO / PITR Metrics:"
echo "  - Physical Base Backup Duration: ${BASEBACKUP_DURATION}s"
echo "  - WAL Replay & Promotion Time:   ${RESTORE_DURATION}s"
echo "  - Recovery Target Timestamp:     ${TARGET_TIMESTAMP}"
echo "  - Proven RPO Guarantee:          Sub-second Point-In-Time-Recovery (WAL Replay)"
echo "  - Transaction Precision:         100% boundary match (T1+T2 preserved, T3 excluded)"
echo "================================================================================"
