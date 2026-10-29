#!/usr/bin/env bash
# M1A real-process CI drill. DESTRUCTIVE TO THE EXPLICITLY CREATED CI PROJECT
# ONLY. Never invoke on production infrastructure or an operator snapshot.
set -Eeuo pipefail

die() {
  printf '%s\n' "PLUGIN_M1A_LIVE_DRILL_FAILED: $1" >&2
  exit 1
}
if [[ ${GITHUB_ACTIONS:-} != "true" ||
      ${CI:-} != "true" ||
      ${VIBRESS_M1A_DISPOSABLE_DRILL:-} != "1" ||
      ! ${GITHUB_RUN_ID:-} =~ ^[0-9]{1,20}$ ]]; then
  die "requires the disposable GitHub Actions drill runner"
fi

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$root"
project="vibress-m1a-${GITHUB_RUN_ID}"
compose=(docker compose -p "$project" -f compose.dev.yml)
log_dir="$(mktemp -d)"
pids=()

cleanup() {
  local status="$?"
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  # Namespaced disposable volumes; NEVER target an existing project.
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$log_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Force TEST-ONLY connection settings regardless of inherited runner values.
export NODE_ENV=development
export DATABASE_URL='postgresql://vibress:vibress@127.0.0.1:5433/vibress'
export REDIS_URL='redis://127.0.0.1:6380'
export VIBRESS_ENCRYPTION_KEY='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export METRICS_ENABLED=true
export TRACING_ENABLED=false
export EVENT_DELIVERY_MODE=outbox
export SITE_URL='http://127.0.0.1:27880'
export ADMIN_ORIGIN='http://127.0.0.1:27880'
export PORTAL_ORIGIN='http://127.0.0.1:27880'
export CORS_ORIGINS='http://127.0.0.1:27880'
# Do not let operator release paths, pins, live remote providers, or active
# production keyrings be inherited into this disposable CI drill.
unset VIBRESS_TRUSTED_PLUGIN_LOCKFILE VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY
unset VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE
unset VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256
unset VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256
unset VIBRESS_PLUGIN_SECRET_KEYS_JSON VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID

"${compose[@]}" up -d --wait postgres redis >/dev/null
pnpm --filter @vibress/database db:migrate >/dev/null
pnpm --filter @vibress/database db:seed >/dev/null

# This sentinel is written ONLY inside the named disposable PostgreSQL
# volume; it is never part of existing tenant or plugin data.
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -q -U vibress -d vibress \
  -c "CREATE TABLE public.m1a_drill_marker (marker text PRIMARY KEY);
      INSERT INTO public.m1a_drill_marker (marker) VALUES ('isolated-recovery-sentinel');" >/dev/null

start_replica() {
  local role="$1" port="$2" name="$3"
  if [[ "$role" == "api" ]]; then
    API_PORT="$port" pnpm exec tsx apps/api/src/main.ts >"$log_dir/$name.log" 2>&1 &
  else
    WORKER_HEALTH_PORT="$port" pnpm exec tsx apps/worker/src/main.ts >"$log_dir/$name.log" 2>&1 &
  fi
  pids+=("$!")
}

start_replica api 27880 api-a
start_replica api 27881 api-b
start_replica worker 27882 worker-a
start_replica worker 27883 worker-b

status() {
  curl --silent --output /dev/null --max-time 2 --write-out '%{http_code}' \
    "http://127.0.0.1:$1/health/ready" 2>/dev/null || true
}
check() {
  local expected="$1" deadline="$2" port
  local started=$SECONDS
  while (( SECONDS - started < deadline )); do
    local matched=1
    for port in 27880 27881 27882 27883; do
      local code
      code="$(status "$port")"
      if [[ "$expected" == "ready" ]]; then
        [[ "$code" == "200" ]] || matched=0
      else
        [[ "$code" != "200" ]] || matched=0
      fi
    done
    if (( matched == 1 )); then return 0; fi
    sleep 2
  done
  die "four-replica $expected health condition was not observed"
}

check ready 150
printf '%s\n' 'PLUGIN_M1A_LIVE_DRILL: four API/Worker processes ready with real PostgreSQL and Redis'

# The outage is injected by stopping ONLY services of our CI-specific
# Docker Compose project. Both APIs and both Workers must become unready.
"${compose[@]}" stop redis >/dev/null
check unready 90
"${compose[@]}" up -d --wait redis >/dev/null
check ready 150
printf '%s\n' 'PLUGIN_M1A_LIVE_DRILL: Redis outage and four-replica recovery observed'

"${compose[@]}" stop postgres >/dev/null
check unready 90
"${compose[@]}" up -d --wait postgres >/dev/null
check ready 150
printf '%s\n' 'PLUGIN_M1A_LIVE_DRILL: PostgreSQL outage and four-replica recovery observed'

# Stop all writers before snapshot/restore. This is a real pg_dump +
# pg_restore into a DIFFERENT empty database within disposable CI storage.
for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
pids=()

# Integration with REAL PostgreSQL/BullMQ admission+consumer semantics.
# The bundled-only API/Worker processes are stopped to avoid touching
# unrelated queues or handing execution to an unsigned external extension.
# Never permit an idle BullMQ/Redis connection to consume the CI runner
# indefinitely; fail closed and preserve the preceding checkpoint evidence.
timeout --signal=TERM --kill-after=10s 360s pnpm exec tsx scripts/plugins/drill-event-delivery.ts

"${compose[@]}" exec -T postgres sh -eu -c '
  pg_dump -U vibress -d vibress --format=custom --file=/tmp/m1a-drill.dump
  createdb -U vibress vibress_m1a_restored
  pg_restore -U vibress --no-owner --no-acl --exit-on-error \
    -d vibress_m1a_restored /tmp/m1a-drill.dump
  original=$(psql -X -U vibress -d vibress -Atqc \
    "SELECT count(*) FROM public.m1a_drill_marker WHERE marker = '\''isolated-recovery-sentinel'\''")
  restored=$(psql -X -U vibress -d vibress_m1a_restored -Atqc \
    "SELECT count(*) FROM public.m1a_drill_marker WHERE marker = '\''isolated-recovery-sentinel'\''")
  [ "$original" = 1 ] && [ "$restored" = 1 ]
' >/dev/null || die "populated PostgreSQL clone restoration failed"

# All writers are stopped. Exercise the production restore.sh signature gate
# against a SECOND disposable database in the uniquely named CI Compose project.
signed_archive="$log_dir/vibress_backup_20000101_000000.sql.gz"
signed_manifest="$log_dir/vibress_backup_manifest_20000101_000000.json"
signed_key="isolated-test-signing-key-$GITHUB_RUN_ID"
"${compose[@]}" exec -T postgres sh -eu -c \
  'pg_dump -U vibress -d vibress --clean --if-exists --no-owner --no-acl' \
  | gzip -c > "$signed_archive"
gzip -t "$signed_archive" || die "signed drill archive is corrupt"
archive_sha="$(sha256sum "$signed_archive" | cut -d ' ' -f 1)"
archive_size="$(wc -c < "$signed_archive" | tr -d ' ')"
cat > "$signed_manifest" <<EOF
{
  "backupSetId": "vibress_backup_20000101_000000",
  "timestamp": "2000-01-01 00:00:00 UTC",
  "project": "vibress-isolated-drill",
  "storageProvider": "local",
  "database": {
    "file": "vibress_backup_20000101_000000.sql.gz",
    "sha256": "$archive_sha",
    "size": "$archive_size"
  },
  "content": { "backedUp": false, "volume": "none", "file": "none", "sha256": "none" },
  "s3": { "backedUp": false, "bucket": "none", "prefix": "none", "file": "none", "sha256": "none" },
  "signatureAlgorithm": "hmac-sha256"
}
EOF
BACKUP_SIGNING_KEY="$signed_key" node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const bytes = fs.readFileSync(process.argv[1]);
  process.stdout.write(crypto.createHmac("sha256", process.env.BACKUP_SIGNING_KEY)
    .update(bytes).digest("hex") + "\n");
' "$signed_manifest" > "$signed_manifest.sig"
"${compose[@]}" exec -T postgres createdb -U vibress vibress_m1a_signed

# Deny the missing signature and a syntactically valid modified manifest
# BEFORE any change to the target database.
missing_sig_manifest="$log_dir/missing-signature.json"
cp "$signed_manifest" "$missing_sig_manifest"
if COMPOSE_PROJECT_NAME="$project" COMPOSE_FILE=compose.dev.yml ENV_FILE=/dev/null \
    BACKUP_SIGNING_KEY="$signed_key" ./scripts/restore.sh \
    --archive "$signed_archive" --manifest "$missing_sig_manifest" \
    --db vibress_m1a_signed --confirm > "$log_dir/missing-signature.log" 2>&1; then
  die "restore accepted signed manifest without detached signature"
fi
grep -q 'detached signature.*missing' "$log_dir/missing-signature.log" \
  || die "missing signature refusal did not reach cryptographic gate"
tampered_manifest="$log_dir/tampered-manifest.json"
cp "$signed_manifest" "$tampered_manifest"
cp "$signed_manifest.sig" "$tampered_manifest.sig"
node -e '
  const fs = require("node:fs");
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.project = "modified-without-resigning";
  fs.writeFileSync(p, JSON.stringify(m));
' "$tampered_manifest"
if COMPOSE_PROJECT_NAME="$project" COMPOSE_FILE=compose.dev.yml ENV_FILE=/dev/null \
    BACKUP_SIGNING_KEY="$signed_key" ./scripts/restore.sh \
    --archive "$signed_archive" --manifest "$tampered_manifest" \
    --db vibress_m1a_signed --confirm > "$log_dir/tampered-manifest.log" 2>&1; then
  die "restore accepted a tampered signed manifest"
fi
grep -q 'HMAC-SHA256 signature verification FAILED' "$log_dir/tampered-manifest.log" \
  || die "tampered manifest refusal did not reach cryptographic gate"
pre_restore="$("${compose[@]}" exec -T postgres psql -X -U vibress -d vibress_m1a_signed \
  -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='m1a_drill_marker'")"
[[ "$pre_restore" == "0" ]] || die "rejected restore mutated the target database"

COMPOSE_PROJECT_NAME="$project" COMPOSE_FILE=compose.dev.yml ENV_FILE=/dev/null \
  BACKUP_SIGNING_KEY="$signed_key" ./scripts/restore.sh \
  --archive "$signed_archive" --manifest "$signed_manifest" \
  --db vibress_m1a_signed --confirm > "$log_dir/signed-restore.log" 2>&1 \
  || die "authenticated restore of populated disposable database failed"
restored="$("${compose[@]}" exec -T postgres psql -X -U vibress -d vibress_m1a_signed \
  -Atqc "SELECT count(*) FROM public.m1a_drill_marker WHERE marker='isolated-recovery-sentinel'")"
[[ "$restored" == "1" ]] || die "authenticated restore lost the original sentinel"
printf '%s\n' 'PLUGIN_M1A_SIGNED_RESTORE_PASSED: HMAC manifest, tamper/missing-signature rejection and populated SQL recovery'

# Separately prove a real, pinned historical 0042 schema with populated
# publication-scoped plugin data upgrades through current 0048. No old
# extension ESM or old API runtime is started by this schema drill.
bash scripts/plugins/drill-historical-upgrade.sh \
  || die "historical core-schema upgrade acceptance failed"

printf '%s\n' 'PLUGIN_M1A_LIVE_DRILL_PASSED: four-process fault recovery, isolated PostgreSQL signed restore and historical 0042->current core migration (not full DR acceptance)'
