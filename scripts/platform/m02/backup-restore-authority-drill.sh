#!/usr/bin/env bash
# M02-E07/E09/E14 — disposable backup/restore authority separation.
set -Eeuo pipefail
if [ "${VIBRESS_M02_BACKUP_CONFIRM:-}" != "1" ]; then echo "REFUSED: set VIBRESS_M02_BACKUP_CONFIRM=1" >&2; exit 2; fi
C="vibress_m02_backup_$$"; PORT="${VIBRESS_M02_BACKUP_PORT:-15436}"
FAILED=0
cleanup() { docker rm -f "${C}" >/dev/null 2>&1 || true; }
trap cleanup EXIT ERR INT TERM
check() { local l="$1" e="$2" a="$3"; if [ "$a" = "$e" ]; then echo "PASS ${l}: ${a}"; else echo "FAIL ${l}: expected ${e}, got ${a}" >&2; FAILED=1; fi }
psqlx() { docker exec -i "${C}" psql "$@" 2>&1 || true; }
psql_admin() { psqlx -U vibress -d vibress -v ON_ERROR_STOP=1 -t -A -c "$1"; }
psql_a() { psqlx -U owner_a -d inst_a -v ON_ERROR_STOP=1 -t -A -c "$1" | tail -1; }
psql_b() { psqlx -U owner_b -d inst_b -v ON_ERROR_STOP=1 -t -A -c "$1" | tail -1; }

docker run -d --name "${C}" -p "${PORT}:5432" -e POSTGRES_USER=vibress -e POSTGRES_PASSWORD=vibress -e POSTGRES_DB=vibress postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "${C}" pg_isready -U vibress >/dev/null 2>&1 && break; sleep 1; done

for role in owner_a owner_b restore_a restore_b runtime_a runtime_b; do
  psql_admin "CREATE ROLE ${role} LOGIN PASSWORD 'drill-secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" >/dev/null
done
psql_admin "CREATE DATABASE inst_a OWNER owner_a;" >/dev/null
psql_admin "CREATE DATABASE inst_b OWNER owner_b;" >/dev/null
psql_admin "REVOKE CONNECT ON DATABASE inst_b FROM PUBLIC;" >/dev/null
psql_admin "REVOKE CONNECT ON DATABASE inst_a FROM PUBLIC;" >/dev/null
psql_admin "GRANT CONNECT ON DATABASE inst_a TO owner_a, restore_a, runtime_a;" >/dev/null
psql_admin "GRANT CONNECT ON DATABASE inst_b TO owner_b, restore_b, runtime_b;" >/dev/null
psql_a "CREATE TABLE records (id text primary key, value text not null);" >/dev/null
psql_b "CREATE TABLE records (id text primary key, value text not null);" >/dev/null
psql_a "INSERT INTO records VALUES ('a1','A_SECRET');" >/dev/null
psql_b "INSERT INTO records VALUES ('b1','B_SECRET');" >/dev/null

echo "=== Backup/restore authority assertions ==="
docker exec -e PGPASSWORD=drill-secret "${C}" pg_dump -U owner_a -h 127.0.0.1 -d inst_a -Fc -f /tmp/inst_a.backup >/dev/null
DIGEST=$(docker exec "${C}" sh -c 'sha256sum /tmp/inst_a.backup | cut -d" " -f1')
[ -n "${DIGEST}" ] && echo "PASS backup integrity digest: ${DIGEST}" || { echo "FAIL backup digest" >&2; FAILED=1; }
check "A reads own data" "A_SECRET" "$(psql_a "SELECT value FROM records WHERE id='a1';")"
check "B reads own data" "B_SECRET" "$(psql_b "SELECT value FROM records WHERE id='b1';")"
CROSS=$(psqlx -U restore_a -d inst_b -v VERBOSITY=sqlstate -c 'SELECT 1;' 2>&1 || true)
if printf '%s' "$CROSS" | grep -qi 'permission denied for database'; then echo "PASS A restore role cannot connect to B: permission denied"; else echo "FAIL A restore role cross-connect: ${CROSS}" >&2; FAILED=1; fi
CROSS2=$(psqlx -U runtime_a -d inst_b -v VERBOSITY=sqlstate -c 'SELECT 1;' 2>&1 || true)
if printf '%s' "$CROSS2" | grep -qi 'permission denied for database'; then echo "PASS A runtime role cannot connect to B: permission denied"; else echo "FAIL A runtime cross-connect: ${CROSS2}" >&2; FAILED=1; fi
psql_a "DELETE FROM records WHERE id='a1';" >/dev/null
docker exec -e PGPASSWORD=drill-secret "${C}" pg_restore -U owner_a -h 127.0.0.1 -d inst_a --clean --if-exists /tmp/inst_a.backup >/dev/null 2>&1 || true
check "authorized restore recovers A data" "A_SECRET" "$(psql_a "SELECT value FROM records WHERE id='a1';")"
check "backup did not leak into B" "0" "$(psql_b "SELECT count(*) FROM records WHERE id='a1';")"
check "roles are not superuser/BYPASSRLS" "f|f" "$(psql_admin "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='restore_a';")"
echo "=== Backup/restore drill: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
