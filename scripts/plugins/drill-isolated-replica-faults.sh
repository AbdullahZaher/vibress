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

printf '%s\n' 'PLUGIN_M1A_LIVE_DRILL_PASSED: real four-process readiness, Redis/PG outage/recovery and isolated PostgreSQL restore (not signed-release or full DR acceptance)'
