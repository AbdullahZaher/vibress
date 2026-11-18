#!/usr/bin/env bash
# Disposable physical-schema and WAL rehearsal. No URL, external data, or runtime entry point.
set -euo pipefail
umask 077
[[ $# == 0 && "$(id -un)" == postgres && -f /.dockerenv && -r /fixture-manifest.json ]]
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
sql() { local port="$1"; shift; psql -X --no-password -h "$root" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }
version="$(sql 55432 <<< 'SHOW server_version_num;')"
[[ "$version" -ge 160016 && "$version" -lt 170000 ]]
echo "PG16_VERSION=$version"
# Fixed test schema only; deliberately not a migration, generator or normative RLS policy.
sql 55432 -v fixtures="$(cat /fixture-manifest.json)" <<'SQL'
CREATE ROLE tenant_a NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE tenant_b NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE SCHEMA readiness;
REVOKE ALL ON SCHEMA readiness FROM PUBLIC;
CREATE TABLE readiness.installation (
 singleton boolean PRIMARY KEY CHECK (singleton),
 installation_id text NOT NULL UNIQUE CHECK (installation_id = 'disposable-crm')
);
INSERT INTO readiness.installation VALUES (true,'disposable-crm');
-- Evidence-only persisted manifest; NOT the normative schema registry.
CREATE TABLE readiness.registry (
 installation_id text PRIMARY KEY REFERENCES readiness.installation(installation_id),
 application_id text NOT NULL CHECK (application_id='customer-crm'),
 manifest text NOT NULL,
 manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}
CREATE TABLE readiness.vr_customers_055ab105b715 (
 tenant_id name NOT NULL,
 id bigint NOT NULL,
 label text NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY (tenant_id,id)
);
CREATE TABLE readiness.vr_deals_614091324508 (
 tenant_id name NOT NULL, id bigint NOT NULL, customer_id bigint NOT NULL,
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY (tenant_id,customer_id) REFERENCES readiness.vr_customers_055ab105b715(tenant_id,id)
);
ALTER TABLE readiness.vr_customers_055ab105b715 ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness.vr_customers_055ab105b715 FORCE ROW LEVEL SECURITY;
ALTER TABLE readiness.vr_deals_614091324508 ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness.vr_deals_614091324508 FORCE ROW LEVEL SECURITY;
CREATE POLICY fixture_scope ON readiness.vr_customers_055ab105b715 TO tenant_a,tenant_b
 USING (tenant_id=current_user) WITH CHECK (tenant_id=current_user);
CREATE POLICY fixture_scope ON readiness.vr_deals_614091324508 TO tenant_a,tenant_b
 USING (tenant_id=current_user) WITH CHECK (tenant_id=current_user);
GRANT USAGE ON SCHEMA readiness TO tenant_a,tenant_b;
GRANT SELECT,INSERT,UPDATE ON readiness.vr_customers_055ab105b715,readiness.vr_deals_614091324508 TO tenant_a,tenant_b;
INSERT INTO readiness.vr_customers_055ab105b715 VALUES
 ('tenant_a',1,'A base',1),('tenant_b',1,'B base',1),('tenant_b',2,'B only',1);
INSERT INTO readiness.vr_deals_614091324508 VALUES ('tenant_a',1,1),('tenant_b',1,1);
CREATE FUNCTION readiness.fixture_customer_catalog_matches() RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $
 SELECT count(*)=1 AND coalesce(bool_and(
  c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND
  (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)=4 AND
  EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='label'
           AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND
           format_type(a.atttypid,a.atttypmod)='text') AND
  EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p'
           AND pg_get_constraintdef(k.oid)='PRIMARY KEY (tenant_id, id)')),false)
 FROM readiness.registry r
 JOIN pg_namespace n ON n.nspname='readiness'
 JOIN pg_class c ON c.relnamespace=n.oid AND c.relname::text=r.manifest::jsonb#>>'{resources,0,tableName}'
 WHERE r.installation_id='disposable-crm'
 AND r.manifest::jsonb#>>'{resources,0,ownership}'='tenant'
 AND r.manifest::jsonb#>>'{resources,0,fields,0,id}'='label'
 AND r.manifest::jsonb#>>'{resources,0,fields,0,postgresType}'='text'
 AND r.manifest::jsonb#>>'{resources,0,fields,0,required}'='true'
 $;
REVOKE ALL ON FUNCTION readiness.fixture_customer_catalog_matches() FROM PUBLIC;
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
DECLARE n bigint; observed bigint;
BEGIN
 IF (SELECT count(*) FROM readiness.vr_customers_055ab105b715) <> 1 THEN RAISE EXCEPTION 'tenant A leak'; END IF;
 IF EXISTS (SELECT 1 FROM readiness.vr_customers_055ab105b715 WHERE tenant_id='tenant_b') THEN RAISE EXCEPTION 'cross tenant read'; END IF;
 BEGIN
  INSERT INTO readiness.vr_deals_614091324508 VALUES ('tenant_a',9,2);
  RAISE EXCEPTION 'cross-tenant FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO readiness.vr_customers_055ab105b715 VALUES ('tenant_b',9,'denied',1);
  RAISE EXCEPTION 'cross-tenant write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  ALTER TABLE readiness.vr_customers_055ab105b715 ADD COLUMN forbidden text;
  RAISE EXCEPTION 'runtime DDL accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM * FROM readiness.registry;
  RAISE EXCEPTION 'metadata read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 SELECT version INTO STRICT observed FROM readiness.vr_customers_055ab105b715 WHERE id=1;
 UPDATE readiness.vr_customers_055ab105b715 SET version=version+1 WHERE tenant_id=current_user AND id=1 AND version=observed;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'first CAS failed'; END IF;
 UPDATE readiness.vr_customers_055ab105b715 SET version=version+1 WHERE tenant_id=current_user AND id=1 AND version=observed;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'stale CAS accepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION tenant_b;
DO $$
BEGIN
 IF (SELECT count(*) FROM readiness.vr_customers_055ab105b715) <> 2 THEN RAISE EXCEPTION 'tenant B scope mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM readiness.vr_customers_055ab105b715 WHERE tenant_id='tenant_a') THEN RAISE EXCEPTION 'tenant B leak'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SQL
}
fingerprint() {
  sql "$1" <<'SQL'
SELECT encode(sha256(convert_to(
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY tenant_id,id)::text FROM readiness.vr_customers_055ab105b715 c) ||
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY tenant_id,id)::text FROM readiness.vr_deals_614091324508 d) ||
 (SELECT to_jsonb(i)::text FROM readiness.installation i) ||
 (SELECT to_jsonb(r)::text FROM readiness.registry r) ||
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
     WHERE n.nspname='readiness' AND relname IN ('vr_customers_055ab105b715','vr_deals_614091324508') AND relrowsecurity AND relforcerowsecurity)<>2 THEN
  RAISE EXCEPTION 'RLS missing';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='readiness.vr_deals_614091324508'::regclass AND contype='f' AND convalidated
    AND pg_get_constraintdef(oid)='FOREIGN KEY (tenant_id, customer_id) REFERENCES readiness.vr_customers_055ab105b715(tenant_id, id)') THEN
  RAISE EXCEPTION 'scoped FK drift';
 END IF;
 IF has_table_privilege('tenant_a','readiness.registry','SELECT') OR has_table_privilege('tenant_b','readiness.registry','SELECT') OR has_schema_privilege('tenant_a','readiness','CREATE') THEN
  RAISE EXCEPTION 'effective ACL drift';
 END IF;
END $$;
SQL
}
registry_probe() {
 [[ "$(sql "$1" -v fixtures="$(cat /fixture-manifest.json)" <<'SQL'
SELECT manifest = (:'fixtures'::jsonb->>'expected') AND readiness.fixture_customer_catalog_matches()
FROM readiness.registry WHERE installation_id='disposable-crm';
SQL
)" == t ]]
 sql "$1" <<'SQL'
BEGIN;
ALTER TABLE readiness.vr_customers_055ab105b715 ADD COLUMN unexpected integer;
DO $ BEGIN
 IF readiness.fixture_customer_catalog_matches() THEN RAISE EXCEPTION 'catalog drift accepted'; END IF;
END $;
ROLLBACK;
SQL
 [[ "$(sql "$1" <<< 'SELECT readiness.fixture_customer_catalog_matches();')" == t ]]
}
probe 55432
acl_probe 55432
registry_probe 55432
echo PRIMARY_SCOPE_PROBES=PASS
# Two physical sessions, with observed actual lock contention (not just serial updates).
PGAPPNAME=readiness_writer_a sql 55432 >"$root/writer-a" <<'SQL' &
BEGIN;
SET SESSION AUTHORIZATION tenant_a;
WITH changed AS (UPDATE readiness.vr_customers_055ab105b715 SET version=version+1
 WHERE tenant_id=current_user AND id=1 AND version=1 RETURNING 1)
SELECT count(*) FROM changed;
SELECT pg_sleep(5);
COMMIT;
SQL
writer_a=$!
for ((i=0;i<100;i++)); do
 [[ "$(sql 55432 <<< "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='readiness_writer_a' AND wait_event='PgSleep');")" == t ]] && break
 sleep 0.05
done
[[ "$(sql 55432 <<< "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='readiness_writer_a' AND wait_event='PgSleep');")" == t ]]
PGAPPNAME=readiness_writer_b sql 55432 >"$root/writer-b" <<'SQL' &
BEGIN;
SET SESSION AUTHORIZATION tenant_a;
WITH changed AS (UPDATE readiness.vr_customers_055ab105b715 SET version=version+1
 WHERE tenant_id=current_user AND id=1 AND version=1 RETURNING 1)
SELECT count(*) FROM changed;
COMMIT;
SQL
writer_b=$!
observed_blocker=f
for ((i=0;i<80;i++)); do
 observed_blocker="$(sql 55432 <<< "SELECT EXISTS (SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='readiness_writer_b' AND a.application_name='readiness_writer_a');")"
 [[ "$observed_blocker" == t ]] && break
 sleep 0.05
done
wait "$writer_a"
wait "$writer_b"
[[ "$observed_blocker" == t ]]
[[ "$(sed -n '1p' "$root/writer-a")" == 1 && "$(cat "$root/writer-b")" == 0 ]]
[[ "$(sql 55432 <<< "SELECT version FROM readiness.vr_customers_055ab105b715 WHERE tenant_id='tenant_a' AND id=1;")" == 2 ]]
echo CONCURRENT_CAS_OBSERVED_BLOCKER=PASS
# The retained commit must occur AFTER the physical base backup.
sql 55432 <<'SQL'
BEGIN;
UPDATE readiness.vr_customers_055ab105b715 SET label='A recovered' WHERE tenant_id='tenant_a' AND id=1;
UPDATE readiness.vr_customers_055ab105b715 SET label='B recovered' WHERE tenant_id='tenant_b' AND id=1;
INSERT INTO readiness.markers VALUES ('retained');
COMMIT;
SELECT pg_create_restore_point('vibress_readiness_target');
SQL
expected="$(fingerprint 55432)"
retained_ts="$(sql 55432 <<< "SELECT extract(epoch FROM pg_xact_commit_timestamp(xmin)) FROM readiness.markers WHERE label='retained';")"
sql 55432 <<'SQL'
BEGIN;
UPDATE readiness.vr_customers_055ab105b715 SET label='A excluded' WHERE tenant_id='tenant_a' AND id=1;
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
registry_probe 55433
[[ "$(sql 55433 <<< "SELECT version FROM readiness.vr_customers_055ab105b715 WHERE tenant_id='tenant_a' AND id=1;")" == 2 ]]
echo PERSISTED_MANIFEST_CATALOG_DRIFT_AND_SCOPE=PASS
end="$(cut -d ' ' -f1 /proc/uptime)"
awk -v a="$retained_ts" -v b="$excluded_ts" -v c="$failure_ts" -v s="$start" -v e="$end" 'BEGIN {
 if (a<=0 || b<a || c<b || e<s) exit 1;
 printf "FIXTURE_RECOVERED_COMMIT_AGE_SECONDS=%.6f\nFIXTURE_EXCLUDED_COMMIT_GAP_SECONDS=%.6f\nFIXTURE_RESTORE_AND_PROBE_SECONDS=%.2f\n",c-a,b-a,e-s
}'
echo 'PHYSICAL_PITR_SCOPED_FIXTURE=PASS (single local archive domain, no external-anchor or power-loss claim)'
),
 CHECK ((manifest::jsonb->>'installationId') IS NOT DISTINCT FROM installation_id),
 CHECK ((manifest::jsonb->>'applicationId') IS NOT DISTINCT FROM application_id),
 CHECK ((manifest::jsonb->>'manifestVersion') IS NOT DISTINCT FROM '1'),
 CHECK ((manifest::jsonb->>'digest') IS NOT DISTINCT FROM manifest_digest)
);
CREATE TEMP TABLE manifest_input(value jsonb);
INSERT INTO manifest_input VALUES (:'fixtures'::jsonb);
INSERT INTO readiness.registry
 SELECT 'disposable-crm','customer-crm',value->>'expected',(value->>'expected')::jsonb->>'digest'
 FROM manifest_input;
DO $ BEGIN
 BEGIN
  UPDATE readiness.registry SET manifest=(SELECT value->>'foreign' FROM manifest_input),
    manifest_digest=(SELECT (value->>'foreign')::jsonb->>'digest' FROM manifest_input);
  RAISE EXCEPTION 'valid foreign installation manifest accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $;
CREATE TABLE readiness.vr_customers_055ab105b715 (
 tenant_id name NOT NULL,
 id bigint NOT NULL,
 label text NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 PRIMARY KEY (tenant_id,id)
);
CREATE TABLE readiness.vr_deals_614091324508 (
 tenant_id name NOT NULL, id bigint NOT NULL, customer_id bigint NOT NULL,
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY (tenant_id,customer_id) REFERENCES readiness.vr_customers_055ab105b715(tenant_id,id)
);
ALTER TABLE readiness.vr_customers_055ab105b715 ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness.vr_customers_055ab105b715 FORCE ROW LEVEL SECURITY;
ALTER TABLE readiness.vr_deals_614091324508 ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness.vr_deals_614091324508 FORCE ROW LEVEL SECURITY;
CREATE POLICY fixture_scope ON readiness.vr_customers_055ab105b715 TO tenant_a,tenant_b
 USING (tenant_id=current_user) WITH CHECK (tenant_id=current_user);
CREATE POLICY fixture_scope ON readiness.vr_deals_614091324508 TO tenant_a,tenant_b
 USING (tenant_id=current_user) WITH CHECK (tenant_id=current_user);
GRANT USAGE ON SCHEMA readiness TO tenant_a,tenant_b;
GRANT SELECT,INSERT,UPDATE ON readiness.vr_customers_055ab105b715,readiness.vr_deals_614091324508 TO tenant_a,tenant_b;
INSERT INTO readiness.vr_customers_055ab105b715 VALUES
 ('tenant_a',1,'A base',1),('tenant_b',1,'B base',1),('tenant_b',2,'B only',1);
INSERT INTO readiness.vr_deals_614091324508 VALUES ('tenant_a',1,1),('tenant_b',1,1);
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
 IF (SELECT count(*) FROM readiness.vr_customers_055ab105b715) <> 1 THEN RAISE EXCEPTION 'tenant A leak'; END IF;
 IF EXISTS (SELECT 1 FROM readiness.vr_customers_055ab105b715 WHERE tenant_id='tenant_b') THEN RAISE EXCEPTION 'cross tenant read'; END IF;
 BEGIN
  INSERT INTO readiness.vr_deals_614091324508 VALUES ('tenant_a',9,2);
  RAISE EXCEPTION 'cross-tenant FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO readiness.vr_customers_055ab105b715 VALUES ('tenant_b',9,'denied',1);
  RAISE EXCEPTION 'cross-tenant write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  ALTER TABLE readiness.vr_customers_055ab105b715 ADD COLUMN forbidden text;
  RAISE EXCEPTION 'runtime DDL accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM * FROM readiness.installation;
  RAISE EXCEPTION 'metadata read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 UPDATE readiness.vr_customers_055ab105b715 SET version=version+1 WHERE tenant_id=current_user AND id=1 AND version=1;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'first CAS failed'; END IF;
 UPDATE readiness.vr_customers_055ab105b715 SET version=version+1 WHERE tenant_id=current_user AND id=1 AND version=1;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'stale CAS accepted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION tenant_b;
DO $$
BEGIN
 IF (SELECT count(*) FROM readiness.vr_customers_055ab105b715) <> 2 THEN RAISE EXCEPTION 'tenant B scope mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM readiness.vr_customers_055ab105b715 WHERE tenant_id='tenant_a') THEN RAISE EXCEPTION 'tenant B leak'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SQL
}
fingerprint() {
  sql "$1" <<'SQL'
SELECT encode(sha256(convert_to(
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY tenant_id,id)::text FROM readiness.vr_customers_055ab105b715 c) ||
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY tenant_id,id)::text FROM readiness.vr_deals_614091324508 d) ||
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
     WHERE n.nspname='readiness' AND relname IN ('vr_customers_055ab105b715','vr_deals_614091324508') AND relrowsecurity AND relforcerowsecurity)<>2 THEN
  RAISE EXCEPTION 'RLS missing';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='readiness.vr_deals_614091324508'::regclass AND contype='f' AND convalidated
    AND pg_get_constraintdef(oid)='FOREIGN KEY (tenant_id, customer_id) REFERENCES readiness.vr_customers_055ab105b715(tenant_id, id)') THEN
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
UPDATE readiness.vr_customers_055ab105b715 SET label='A recovered' WHERE tenant_id='tenant_a' AND id=1;
UPDATE readiness.vr_customers_055ab105b715 SET label='B recovered' WHERE tenant_id='tenant_b' AND id=1;
INSERT INTO readiness.markers VALUES ('retained');
COMMIT;
SELECT pg_create_restore_point('vibress_readiness_target');
SQL
expected="$(fingerprint 55432)"
retained_ts="$(sql 55432 <<< "SELECT extract(epoch FROM pg_xact_commit_timestamp(xmin)) FROM readiness.markers WHERE label='retained';")"
sql 55432 <<'SQL'
BEGIN;
UPDATE readiness.vr_customers_055ab105b715 SET label='A excluded' WHERE tenant_id='tenant_a' AND id=1;
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
