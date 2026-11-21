#!/usr/bin/env bash
# M03 D-02 — disposable PostgreSQL 16 Backfill retained/rewound PITR drill.
#
# SAFETY: refuses to run without VIBRESS_DRILL_CONFIRM=1. Uses only a unique
# throwaway container, throwaway port and throwaway directory. Never reads
# production data, never changes Migration 0061, never creates roles/grants.
set -Eeuo pipefail

if [ "${VIBRESS_DRILL_CONFIRM:-}" != "1" ]; then
  echo "REFUSED: set VIBRESS_DRILL_CONFIRM=1 to run this disposable drill." >&2
  exit 2
fi

DRILL_ID="m03_backfill_$$"
DRILL_PORT="${VIBRESS_DRILL_PORT:-15439}"
DRILL_DIR="/tmp/vibress_m03_backfill_${DRILL_ID}"
PRIMARY="vibress_m03_bf_primary_${DRILL_ID}"
RECOVERY="vibress_m03_bf_recovery_${DRILL_ID}"
PG_PASS="drillsecret"
DB="vibress_m03_backfill"
FAILED=0

mkdir -p "${DRILL_DIR}/wal_archive" "${DRILL_DIR}/base_backup" "${DRILL_DIR}/recovered_data"
chmod 777 "${DRILL_DIR}/wal_archive" "${DRILL_DIR}/base_backup" "${DRILL_DIR}/recovered_data"

cleanup() {
  docker rm -f "${PRIMARY}" >/dev/null 2>&1 || true
  docker rm -f "${RECOVERY}" >/dev/null 2>&1 || true
  rm -rf "${DRILL_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT ERR INT TERM

sql() {
  docker exec -i "${PRIMARY}" psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -t -A -c "$1"
}
recovered_sql() {
  docker exec -i "${RECOVERY}" psql -U postgres -d "${DB}" -v ON_ERROR_STOP=1 -t -A -c "$1"
}
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "${actual}" = "${expected}" ]; then
    echo "PASS ${label}: ${actual}"
  else
    echo "FAIL ${label}: expected ${expected}, got ${actual}" >&2
    FAILED=1
  fi
}

echo "=== M03 D-02 Backfill PITR drill ${DRILL_ID} on disposable port ${DRILL_PORT} ==="

docker run -d --name "${PRIMARY}" -p "${DRILL_PORT}:5432" \
  -e POSTGRES_PASSWORD="${PG_PASS}" -e POSTGRES_DB="${DB}" \
  -v "${DRILL_DIR}/wal_archive:/var/lib/postgresql/wal_archive" \
  -v "${DRILL_DIR}/base_backup:/var/lib/postgresql/base_backup" \
  postgres:16-alpine postgres \
  -c wal_level=replica -c archive_mode=on \
  -c "archive_command=test ! -f /var/lib/postgresql/wal_archive/%f && cp %p /var/lib/postgresql/wal_archive/%f" \
  -c archive_timeout=60 >/dev/null

for _ in $(seq 1 60); do
  docker exec "${PRIMARY}" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${PRIMARY}" pg_isready -U postgres >/dev/null 2>&1 || { echo "FAIL primary not healthy" >&2; exit 1; }

sql "CREATE TABLE backfill_chunk (chunk_id text primary key, tenant_id text not null, revision text not null, payload text not null, status text not null, committed_at timestamptz default clock_timestamp());"
sql "CREATE TABLE chunk_journal (chunk_id text primary key, tenant_id text not null, revision text not null, acked boolean not null default false);"
sql "CREATE TABLE recovery_authority (anchor text primary key, authority text not null, created_at timestamptz default clock_timestamp());"

# External recovery anchor: digest lives outside PostgreSQL and is compared
# against the persisted value after recovery.
printf 'm03-d02-external-authority-v1' > "${DRILL_DIR}/authority.txt"
ANCHOR_DIGEST=$(shasum -a 256 "${DRILL_DIR}/authority.txt" | awk '{print $1}')
sql "INSERT INTO recovery_authority(anchor,authority) VALUES ('${ANCHOR_DIGEST}','disposable-drill-authority');"

# Retained committed chunk before the base backup.
sql "INSERT INTO backfill_chunk(chunk_id,tenant_id,revision,payload,status) VALUES ('chunk-retained','tenant-a','rev-1','retained','COMMITTED');"
sql "INSERT INTO chunk_journal(chunk_id,tenant_id,revision,acked) VALUES ('chunk-retained','tenant-a','rev-1',true);"

docker exec -e PGPASSWORD="${PG_PASS}" "${PRIMARY}" \
  pg_basebackup -h 127.0.0.1 -U postgres -D /var/lib/postgresql/base_backup -Ft -z -X fetch
[ -f "${DRILL_DIR}/base_backup/base.tar.gz" ] || { echo "FAIL base backup missing" >&2; exit 1; }

# Unknown COMMIT outcome must be preserved, not silently resumed.
sql "INSERT INTO backfill_chunk(chunk_id,tenant_id,revision,payload,status) VALUES ('chunk-unknown','tenant-a','rev-1','unknown-commit','UNKNOWN');"

sleep 2
TARGET_TIMESTAMP=$(sql "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.US OF');")
echo "Recovery target: ${TARGET_TIMESTAMP}"

sleep 2
# Unwanted chunk after the target must be rewound by PITR.
sql "INSERT INTO backfill_chunk(chunk_id,tenant_id,revision,payload,status) VALUES ('chunk-rewound','tenant-a','rev-9','unwanted','COMMITTED');"
sql "INSERT INTO chunk_journal(chunk_id,tenant_id,revision,acked) VALUES ('chunk-rewound','tenant-a','rev-9',true);"

sql "SELECT pg_switch_wal();" >/dev/null
sleep 2
WAL_COUNT=$(find "${DRILL_DIR}/wal_archive" -type f | wc -l | tr -d ' ')
echo "Archived WAL files: ${WAL_COUNT}"
docker stop "${PRIMARY}" >/dev/null

tar -xzf "${DRILL_DIR}/base_backup/base.tar.gz" -C "${DRILL_DIR}/recovered_data"
chmod 700 "${DRILL_DIR}/recovered_data"
touch "${DRILL_DIR}/recovered_data/recovery.signal"
chmod 600 "${DRILL_DIR}/recovered_data/recovery.signal"
cat <<EOF >> "${DRILL_DIR}/recovered_data/postgresql.auto.conf"
restore_command = 'test -f /var/lib/postgresql/wal_archive/%f && cp /var/lib/postgresql/wal_archive/%f %p'
recovery_target_time = '${TARGET_TIMESTAMP}'
recovery_target_action = 'promote'
EOF

docker run -d --name "${RECOVERY}" -p "${DRILL_PORT}:5432" \
  -e POSTGRES_PASSWORD="${PG_PASS}" \
  -v "${DRILL_DIR}/recovered_data:/var/lib/postgresql/data" \
  -v "${DRILL_DIR}/wal_archive:/var/lib/postgresql/wal_archive:ro" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  docker exec "${RECOVERY}" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${RECOVERY}" pg_isready -U postgres >/dev/null 2>&1 || { echo "FAIL recovery not healthy" >&2; docker logs "${RECOVERY}" | tail -20 >&2; exit 1; }

echo "=== Recovered assertions ==="
assert_eq "retained chunk present" "1" "$(recovered_sql "SELECT count(*) FROM backfill_chunk WHERE chunk_id='chunk-retained';")"
assert_eq "rewound chunk absent" "0" "$(recovered_sql "SELECT count(*) FROM backfill_chunk WHERE chunk_id='chunk-rewound';")"
assert_eq "unknown COMMIT preserved" "UNKNOWN" "$(recovered_sql "SELECT status FROM backfill_chunk WHERE chunk_id='chunk-unknown';")"
assert_eq "journal consistent" "1" "$(recovered_sql "SELECT count(*) FROM chunk_journal WHERE chunk_id='chunk-retained' AND acked;")"
assert_eq "rewound journal absent" "0" "$(recovered_sql "SELECT count(*) FROM chunk_journal WHERE chunk_id='chunk-rewound';")"
assert_eq "external authority anchor" "disposable-drill-authority" "$(recovered_sql "SELECT authority FROM recovery_authority WHERE anchor='${ANCHOR_DIGEST}';")"

# Duplicate prevention: same chunk id cannot be applied twice.
recovered_sql "INSERT INTO backfill_chunk(chunk_id,tenant_id,revision,payload,status) VALUES ('chunk-retained','tenant-a','rev-1','duplicate','COMMITTED') ON CONFLICT (chunk_id) DO NOTHING;" >/dev/null
assert_eq "duplicate prevention" "1" "$(recovered_sql "SELECT count(*) FROM backfill_chunk WHERE chunk_id='chunk-retained';")"

# Safe operator forward-fix with a new revision after recovery.
recovered_sql "INSERT INTO backfill_chunk(chunk_id,tenant_id,revision,payload,status) VALUES ('chunk-rewound','tenant-a','rev-2','operator-forward-fix','COMMITTED');" >/dev/null
recovered_sql "INSERT INTO chunk_journal(chunk_id,tenant_id,revision,acked) VALUES ('chunk-rewound','tenant-a','rev-2',true);" >/dev/null
assert_eq "forward-fix revision" "rev-2" "$(recovered_sql "SELECT revision FROM backfill_chunk WHERE chunk_id='chunk-rewound';")"
assert_eq "forward-fix journal" "1" "$(recovered_sql "SELECT count(*) FROM chunk_journal WHERE chunk_id='chunk-rewound' AND revision='rev-2' AND acked;")"

echo "=== Drill result: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
