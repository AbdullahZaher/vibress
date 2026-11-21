#!/usr/bin/env bash
# M02-E04/E05/E12/E13 — disposable PostgreSQL 16 RLS + effective privilege drill.
# No production data, no shared database, no grant applied outside this container.
set -Eeuo pipefail
if [ "${VIBRESS_M02_PG_CONFIRM:-}" != "1" ]; then
  echo "REFUSED: set VIBRESS_M02_PG_CONFIRM=1" >&2; exit 2
fi
ID="m02_rls_$$"
C="vibress_m02_pg_${ID}"
PORT="${VIBRESS_M02_PG_PORT:-15435}"
FAILED=0
cleanup() { docker rm -f "${C}" >/dev/null 2>&1 || true; }
trap cleanup EXIT ERR INT TERM
admin() { docker exec -i "${C}" psql -U vibress -d vibress -v ON_ERROR_STOP=1 -t -A -c "$1"; }
owner() { docker exec -i "${C}" psql -U m02_owner -d m02_rls -v ON_ERROR_STOP=1 -t -A -c "$1" 2>&1 | tail -1; }
owner_neg() { docker exec -i "${C}" psql -U m02_owner -d m02_rls -v VERBOSITY=sqlstate -t -A -c "$1" 2>&1 || true; }
role_a() { docker exec -i "${C}" psql -U m02_role_a -d m02_rls -v ON_ERROR_STOP=1 -t -A -c "$1" 2>&1 | tail -1; }
role_a_neg() { docker exec -i "${C}" psql -U m02_role_a -d m02_rls -v VERBOSITY=sqlstate -t -A -c "$1" 2>&1 || true; }
role_nogrant_neg() { docker exec -i "${C}" psql -U m02_nogrant -d m02_rls -v VERBOSITY=sqlstate -t -A -c "$1" 2>&1 || true; }
check() { local l="$1" e="$2" a="$3"; if [ "$a" = "$e" ]; then echo "PASS ${l}: ${a}"; else echo "FAIL ${l}: expected ${e}, got ${a}" >&2; FAILED=1; fi }
expect_sqlstate() { local l="$1" s="$2" out="$3"; if printf '%s' "$out" | grep -q "$s"; then echo "PASS ${l}: ${s}"; else echo "FAIL ${l}: expected ${s}, got ${out}" >&2; FAILED=1; fi }

docker run -d --name "${C}" -p "${PORT}:5432" -e POSTGRES_USER=vibress -e POSTGRES_PASSWORD=vibress -e POSTGRES_DB=vibress postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "${C}" pg_isready -U vibress >/dev/null 2>&1 && break; sleep 1; done

admin "CREATE ROLE m02_owner LOGIN PASSWORD 'owner-secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" >/dev/null
admin "CREATE ROLE m02_role_a LOGIN PASSWORD 'a-secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" >/dev/null
admin "CREATE ROLE m02_nogrant LOGIN PASSWORD 'n-secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" >/dev/null
admin "CREATE DATABASE m02_rls OWNER m02_owner;" >/dev/null
owner "CREATE TABLE tenant_records (id text primary key, tenant_id text not null, value text not null);" >/dev/null
owner "ALTER TABLE tenant_records ENABLE ROW LEVEL SECURITY;" >/dev/null
owner "ALTER TABLE tenant_records FORCE ROW LEVEL SECURITY;" >/dev/null
owner "CREATE POLICY tenant_isolation ON tenant_records USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));" >/dev/null
owner "GRANT USAGE ON SCHEMA public TO m02_role_a, m02_nogrant;" >/dev/null
owner "GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_records TO m02_role_a;" >/dev/null
owner "CREATE FUNCTION public.safe_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS \$\$ SELECT count(*) FROM tenant_records \$\$;" >/dev/null
owner "REVOKE ALL ON FUNCTION public.safe_count() FROM PUBLIC;" >/dev/null
owner "GRANT EXECUTE ON FUNCTION public.safe_count() TO m02_role_a;" >/dev/null
owner "CREATE VIEW public.tenant_view AS SELECT * FROM tenant_records;" >/dev/null
owner "SET app.tenant_id = 'tenant-a'; INSERT INTO tenant_records VALUES ('a1','tenant-a','A_VALUE');" >/dev/null
owner "SET app.tenant_id = 'tenant-b'; INSERT INTO tenant_records VALUES ('b1','tenant-b','B_VALUE');" >/dev/null

echo "=== Effective RLS and privilege assertions ==="
check "own tenant visible" "1" "$(role_a "SET app.tenant_id = 'tenant-a'; SELECT count(*) FROM tenant_records;")"
check "other tenant hidden" "0" "$(role_a "SET app.tenant_id = 'tenant-a'; SELECT count(*) FROM tenant_records WHERE tenant_id='tenant-b';")"
expect_sqlstate "cross-tenant insert denied" "42501" "$(role_a_neg "SET app.tenant_id = 'tenant-a'; INSERT INTO tenant_records VALUES ('x','tenant-b','X');")"
check "owner forced RLS applies to owner" "0" "$(owner "SET app.tenant_id = 'tenant-a'; SELECT count(*) FROM tenant_records WHERE tenant_id='tenant-b';")"
check "FORCE RLS catalog" "t" "$(owner "SELECT relforcerowsecurity FROM pg_class WHERE relname='tenant_records';")"
check "RLS enabled catalog" "t" "$(owner "SELECT relrowsecurity FROM pg_class WHERE relname='tenant_records';")"
expect_sqlstate "TRUNCATE denied to runtime" "42501" "$(role_a_neg "TRUNCATE tenant_records;")"
expect_sqlstate "function EXECUTE denied without grant" "42501" "$(role_nogrant_neg "SELECT public.safe_count();")"
check "PUBLIC EXECUTE absent" "f" "$(owner "SELECT has_function_privilege('public','public.safe_count()','EXECUTE');")"
check "SECURITY DEFINER" "t" "$(owner "SELECT prosecdef FROM pg_proc WHERE proname='safe_count';")"
check "search_path hardened" "t" "$(owner "SELECT proconfig::text LIKE '%search_path%' FROM pg_proc WHERE proname='safe_count';")"
check "runtime not superuser" "f|f|f|f" "$(owner "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='m02_role_a';")"
check "view owner is forced-RLS owner" "m02_owner" "$(owner "SELECT relowner::regrole::text FROM pg_class WHERE relname='tenant_view';")"
check "session A sees own tenant" "A_VALUE" "$(role_a "SET app.tenant_id='tenant-a'; SELECT value FROM tenant_records WHERE id='a1';")"
check "session B scope cannot see A row" "0" "$(role_a "SET app.tenant_id='tenant-b'; SELECT count(*) FROM tenant_records WHERE id='a1';")"

echo "=== M02 PG16 RLS/privilege drill: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
