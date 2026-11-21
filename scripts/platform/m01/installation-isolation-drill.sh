#!/usr/bin/env bash
# M01-E10 — disposable A/B installation isolation drill (nonproduction only).
set -Eeuo pipefail
if [ "${VIBRESS_M01_DRILL_CONFIRM:-}" != "1" ]; then
  echo "REFUSED: set VIBRESS_M01_DRILL_CONFIRM=1" >&2
  exit 2
fi
ID="m01_iso_$$"
PG="vibress_m01_iso_pg_${ID}"
REDIS="vibress_m01_iso_redis_${ID}"
PGPORT="${VIBRESS_M01_PG_PORT:-15434}"
RPORT="${VIBRESS_M01_REDIS_PORT:-16380}"
FAILED=0
cleanup() {
  docker rm -f "${PG}" "${REDIS}" >/dev/null 2>&1 || true
}
trap cleanup EXIT ERR INT TERM
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "${actual}" = "${expected}" ]; then echo "PASS ${label}: ${actual}"; else echo "FAIL ${label}: expected ${expected}, got ${actual}" >&2; FAILED=1; fi
}
psql_boot() { docker exec -i "${PG}" psql -U vibress -d vibress -v ON_ERROR_STOP=1 -t -A -c "$1"; }
psql_admin() { docker exec -i "${PG}" psql -U vibress -d installations -v ON_ERROR_STOP=1 -t -A -c "$1"; }
psql_a() { docker exec -i "${PG}" psql -U inst_a -d installations -v ON_ERROR_STOP=1 -t -A -c "$1"; }
psql_b() { docker exec -i "${PG}" psql -U inst_b -d installations -v ON_ERROR_STOP=1 -t -A -c "$1"; }

docker run -d --name "${PG}" -p "${PGPORT}:5432" \
  -e POSTGRES_USER=vibress -e POSTGRES_PASSWORD=vibress -e POSTGRES_DB=vibress \
  postgres:16-alpine >/dev/null
docker run -d --name "${REDIS}" -p "127.0.0.1:${RPORT}:6379" redis:7-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "${PG}" pg_isready -U vibress >/dev/null 2>&1 && break; sleep 1; done
for _ in $(seq 1 60); do docker exec "${REDIS}" redis-cli ping >/dev/null 2>&1 && break; sleep 1; done

psql_boot "CREATE DATABASE installations;" >/dev/null
psql_boot "CREATE ROLE inst_a LOGIN PASSWORD 'a-secret';" >/dev/null
psql_boot "CREATE ROLE inst_b LOGIN PASSWORD 'b-secret';" >/dev/null
psql_admin "CREATE SCHEMA inst_a AUTHORIZATION inst_a;" >/dev/null
psql_admin "CREATE SCHEMA inst_b AUTHORIZATION inst_b;" >/dev/null
psql_a "CREATE TABLE inst_a.secrets (id text primary key, value text not null);" >/dev/null
psql_b "CREATE TABLE inst_b.secrets (id text primary key, value text not null);" >/dev/null
psql_a "INSERT INTO inst_a.secrets VALUES ('a','A_SECRET');" >/dev/null
psql_b "INSERT INTO inst_b.secrets VALUES ('b','B_SECRET');" >/dev/null

check "A reads own secret" "A_SECRET" "$(psql_a "SELECT value FROM inst_a.secrets WHERE id='a';" || true)"
check "B reads own secret" "B_SECRET" "$(psql_b "SELECT value FROM inst_b.secrets WHERE id='b';" || true)"
CROSS=$(docker exec -i "${PG}" psql -U inst_a -d installations -t -A -c 'SELECT value FROM inst_b.secrets;' 2>&1 || true)
if printf '%s' "${CROSS}" | grep -qi 'permission denied'; then echo "PASS A cannot read B: permission denied"; else echo "FAIL A cannot read B: ${CROSS}" >&2; FAILED=1; fi
check "A is not superuser" "f|f|f" "$(psql_admin "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='inst_a';")"
check "B is not superuser" "f|f|f" "$(psql_admin "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='inst_b';")"

docker exec "${REDIS}" redis-cli -n 0 SET m01:a A_SECRET >/dev/null
docker exec "${REDIS}" redis-cli -n 1 SET m01:b B_SECRET >/dev/null
check "Redis db1 cannot see db0" "" "$(docker exec "${REDIS}" redis-cli -n 1 GET m01:a)"
check "Redis db0 cannot see db1" "" "$(docker exec "${REDIS}" redis-cli -n 0 GET m01:b)"

echo "=== M01 isolation drill: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
