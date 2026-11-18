#!/usr/bin/env bash
# Disposable physical-schema and WAL rehearsal. No URL, external data, or runtime entry point.
set -euo pipefail
umask 077
[[ $# == 0 && "$(id -un)" == postgres && -f /.dockerenv ]]
[[ "$(cat /sys/class/net/lo/type)" == 772 ]]
[[ "$(ls /sys/class/net | wc -l | tr -d ' ')" == 1 ]]
root="$(mktemp -d /tmp/vibress-readiness.XXXXXXXX)"
primary="$root/primary"
backup="$root/backup"
restored="$root/restored"
archive="$root/archive"
mkdir "$archive"
# Never remove or operate on a caller-provided directory. Container --rm owns cleanup.
cleanup() {
  if [[ -f "$restored/postmaster.pid" ]]; then pg_ctl -D "$restored" -m immediate -w stop || true; fi
  if [[ -f "$primary/postmaster.pid" ]]; then pg_ctl -D "$primary" -m immediate -w stop || true; fi
}
trap cleanup EXIT
unset PGHOST PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGDATA
initdb -D "$primary" --username=postgres --auth-local=trust --auth-host=reject >/dev/null
cat >>"$primary/postgresql.conf" <<EOF
listen_addresses = ''
unix_socket_directories = '$root'
port = 55432
wal_level = replica
archive_mode = on
archive_command = 'test ! -f $archive/%f && cp %p $archive/%f'
fsync = on
full_page_writes = on
synchronous_commit = on
track_commit_timestamp = on
EOF
pg_ctl -D "$primary" -l "$root/primary.log" -w start
sql() { psql -X --no-password -h "$root" -p "$1" -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq; }
version="$(sql 55432 <<< 'SHOW server_version_num;')"
[[ "$version" -ge 160016 && "$version" -lt 170000 ]]
echo "PG16_VERSION=$version"
# Fixed test schema only; deliberately not a migration, generator or normative RLS policy.
sql 55432 <<'SQL'
CREATE ROLE tenant_a NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE tenant_b NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE SCHEMA readiness;
REVOKE ALL ON SCHEMA readiness FROM PUBLIC;
CREATE TABLE readiness.installation (
 singleton boolean PRIMARY KEY CHECK (singleton),
 installation_id text NOT NULL CHECK (installation_id = 'disposable-crm')
);
INSERT INTO readiness.installation VALUES (true,'disposable-crm');
CREATE TABLE readiness.customers (
 tenant_id name NOT NULL,
 id bigint NOT NULL,
 label text NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY (tenant_id,id)
);
CREATE TABLE readiness.deals (
 tenant_id name NOT NULL, id bigint NOT NULL, customer_id bigint NOT NULL,
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY (tenant_id,customer_id) REFERENCES readiness.customers(tenant_id,id)
);
ALTER TABLE readiness.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE readiness.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness.deals FORCE ROW LEVEL SECURITY;
CREATE POLICY fixture_scope ON readiness.customers TO tenant_a,tenant_b
 USING (tenant_id=current_user) WITH CHECK (tenant_id=current_user);
CREATE POLICY fixture_scope ON readiness.deals TO tenant_a,tenant_b
 USING (tenant_id=current_user) WITH CHECK (tenant_id=current_user);
GRANT USAGE ON SCHEMA readiness TO tenant_a,tenant_b;
GRANT SELECT,INSERT,UPDATE ON readiness.customers,readiness.deals TO tenant_a,tenant_b;
INSERT INTO readiness.customers VALUES
 ('tenant_a',1,'A base',1),('tenant_b',1,'B base',1),('tenant_b',2,'B only',1);
INSERT INTO readiness.deals VALUES ('tenant_a',1,1),('tenant_b',1,1);
CREATE TABLE readiness.markers(label text PRIMARY KEY);
INSERT INTO readiness.markers VALUES ('base');
SQL
pg_basebackup -h "$root" -p 55432 -U postgres -D "$backup" -X stream -c fast --manifest-checksums=SHA256
pg_verifybackup "$backup"
echo BASE_BACKUP_VERIFIED=1
# Prove same-role version compare and rollback of out-of-scope writes.
probe() {
  sql "$1" <<'SQL'
BEGIN;
SET SESSION AUTHORIZATION tenant_a;
DO $$
DECLARE n bigint;
BEGIN
 IF (SELECT count(*) FROM readiness.customers) <> 1 THEN RAISE EXCEPTION 'tenant A leak'; END IF;
 IF EXISTS (SELECT 1 FROM readiness.customers WHERE tenant_id='tenant_b') THEN RAISE EXCEPTION 'cross tenant read'; END IF;
 BEGIN
  INSERT INTO readiness.deals VALUES ('tenant_a',9,2);
  RAISE EXCEPTION 'cross-tenant FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO readiness.customers VALUES ('tenant_b',9,'denied',1);
  RAISE EXCEPTION 'cross-tenant write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  ALTER TABLE readiness.customers ADD COLUMN forbidden text;
  RAISE EXCEPTION 'runtime DDL accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM * FROM readiness.installation;
  RAISE EXCEPTION 'metadata read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 UPDATE readiness.customers SET version=version+1 WHERE tenant_id=current_user AND id=1 AND version=1;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'first CAS failed'; END IF;
 UPDATE readiness.customers SET version=version+1 WHERE tenant_id=current_user AND id=1 AND version=1;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'stale CAS accepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION tenant_b;
DO $$
BEGIN
 IF (SELECT count(*) FROM readiness.customers) <> 2 THEN RAISE EXCEPTION 'tenant B scope mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM readiness.customers WHERE tenant_id='tenant_a') THEN RAISE EXCEPTION 'tenant B leak'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SQL
}
fingerprint() {
  sql "$1" <<'SQL'
SELECT encode(sha256(convert_to(
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY tenant_id,id)::text FROM readiness.customers c) ||
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY tenant_id,id)::text FROM readiness.deals d) ||
 (SELECT to_jsonb(i)::text FROM readiness.installation i) ||
 (SELECT jsonb_agg(label ORDER BY label)::text FROM readiness.markers),
 'UTF8')),'hex');
SQL
}
acl_probe() {
 sql "$1" <<'SQL'
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('tenant_a','tenant_b') AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
  RAISE EXCEPTION 'unexpected runtime role attributes';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='readiness' AND relname IN ('customers','deals') AND relrowsecurity AND relforcerowsecurity)<>2 THEN
  RAISE EXCEPTION 'RLS missing';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='readiness.deals'::regclass AND contype='f' AND convalidated
    AND pg_get_constraintdef(oid)='FOREIGN KEY (tenant_id, customer_id) REFERENCES readiness.customers(tenant_id, id)') THEN
  RAISE EXCEPTION 'scoped FK drift';
 END IF;
 IF has_table_privilege('tenant_a','readiness.installation','SELECT') OR has_schema_privilege('tenant_a','readiness','CREATE') THEN
  RAISE EXCEPTION 'effective ACL drift';
 END IF;
END $$;
SQL
}
probe 55432
acl_probe 55432
echo PRIMARY_SCOPE_PROBES=PASS
# The retained commit must occur AFTER the physical base backup.
sql 55432 <<'SQL'
BEGIN;
UPDATE readiness.customers SET label='A recovered' WHERE tenant_id='tenant_a' AND id=1;
UPDATE readiness.customers SET label='B recovered' WHERE tenant_id='tenant_b' AND id=1;
INSERT INTO readiness.markers VALUES ('retained');
COMMIT;
SELECT pg_create_restore_point('vibress_readiness_target');
SQL
expected="$(fingerprint 55432)"
retained_ts="$(sql 55432 <<< "SELECT extract(epoch FROM pg_xact_commit_timestamp(xmin)) FROM readiness.markers WHERE label='retained';")"
sql 55432 <<'SQL'
BEGIN;
UPDATE readiness.customers SET label='A excluded' WHERE tenant_id='tenant_a' AND id=1;
INSERT INTO readiness.markers VALUES ('excluded');
COMMIT;
SQL
[[ "$(fingerprint 55432)" != "$expected" ]]
excluded_ts="$(sql 55432 <<< "SELECT extract(epoch FROM pg_xact_commit_timestamp(xmin)) FROM readiness.markers WHERE label='excluded';")"
segment="$(sql 55432 <<< 'SELECT pg_walfile_name(pg_current_wal_insert_lsn());')"
[[ "$segment" =~ ^[0-9A-F]{24}$ ]]
sql 55432 <<< 'SELECT pg_switch_wal();'
for ((i=0;i<120;i++)); do
  [[ -s "$archive/$segment" ]] && break
  sleep 1
done
[[ -s "$archive/$segment" ]]
# The cluster is stopped, not a simulated hardware crash. Metrics are one synthetic run.
failure_ts="$(sql 55432 <<< 'SELECT extract(epoch FROM clock_timestamp());')"
pg_ctl -D "$primary" -m fast -w stop
start="$(cut -d ' ' -f1 /proc/uptime)"
cp -a "$backup" "$restored"
cat >>"$restored/postgresql.auto.conf" <<EOF
archive_mode = off
port = 55433
restore_command = 'cp $archive/%f %p'
recovery_target_name = 'vibress_readiness_target'
recovery_target_action = promote
EOF
touch "$restored/recovery.signal"
if ! pg_ctl -D "$restored" -l "$root/restored.log" -w start; then
  tail -80 "$root/restored.log"; exit 1
fi
for ((i=0;i<120;i++)); do
  if [[ "$(sql 55433 <<< 'SELECT pg_is_in_recovery();' 2>/dev/null || true)" == f ]]; then break; fi
  sleep 1
done
[[ "$(sql 55433 <<< 'SELECT pg_is_in_recovery();')" == f ]]
[[ "$(sql 55433 <<< "SELECT string_agg(label,',' ORDER BY label) FROM readiness.markers;")" == base,retained ]]
[[ "$(fingerprint 55433)" == "$expected" ]]
[[ "$(sql 55433 <<< "SELECT extract(epoch FROM pg_xact_commit_timestamp(xmin)) FROM readiness.markers WHERE label='retained';")" == "$retained_ts" ]]
probe 55433
acl_probe 55433
end="$(cut -d ' ' -f1 /proc/uptime)"
awk -v a="$retained_ts" -v b="$excluded_ts" -v c="$failure_ts" -v s="$start" -v e="$end" 'BEGIN {
 if (a<=0 || b<a || c<b || e<s) exit 1;
 printf "FIXTURE_RECOVERED_COMMIT_AGE_SECONDS=%.6f\nFIXTURE_EXCLUDED_COMMIT_GAP_SECONDS=%.6f\nFIXTURE_RESTORE_AND_PROBE_SECONDS=%.2f\n",c-a,b-a,e-s
}'
echo 'PHYSICAL_PITR_SCOPED_FIXTURE=PASS (single local archive domain, no external-anchor or power-loss claim)'
