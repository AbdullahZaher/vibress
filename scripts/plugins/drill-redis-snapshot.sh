#!/usr/bin/env bash
# M1A: restore a Redis RDB snapshot into a SECOND disposable container.
# This intentionally does not claim a consistent DB+queue recovery point.
set -Eeuo pipefail

fail() {
  printf '%s\n' 'PLUGIN_M1A_REDIS_RESTORE_FAILED: isolated RDB verification incomplete' >&2
  exit 1
}
if [[ ${GITHUB_ACTIONS:-} != "true" ||
      ${CI:-} != "true" ||
      ${VIBRESS_M1A_DISPOSABLE_DRILL:-} != "1" ||
      ! ${GITHUB_RUN_ID:-} =~ ^[0-9]{1,20}$ ]]; then
  fail
fi

project="vibress-m1a-${GITHUB_RUN_ID}"
compose=(docker compose -p "$project" -f compose.dev.yml)
source_id="$("${compose[@]}" ps -q redis)"
[[ -n "$source_id" ]] || fail
source_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$source_id")"
[[ "$source_project" == "$project" ]] || fail

tmp="$(mktemp -d)"
restore_id=""
cleanup() {
  if [[ -n "$restore_id" ]]; then
    docker rm -f "$restore_id" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT

# Only fixture keys inside an already isolated runner's Redis. Write after all
# API/Worker producers have stopped, and force a fully completed SAVE.
key="vibress:m1a:rdb:${GITHUB_RUN_ID}"
expected="isolated-redis-snapshot-${GITHUB_RUN_ID}"
actual="$("${compose[@]}" exec -T redis redis-cli --raw SET "$key" "$expected")"
[[ "$actual" == "OK" ]] || fail
actual="$("${compose[@]}" exec -T redis redis-cli --raw HSET "$key:queue" status pending publication historical-ar)"
[[ "$actual" == "2" ]] || fail
# Verify BOTH source services belong to this run's disposable Compose project
# before adding a shared recovery-point marker or taking a second DB snapshot.
postgres_id="$("${compose[@]}" ps -q postgres)"
[[ -n "$postgres_id" ]] || fail
postgres_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$postgres_id")"
[[ "$postgres_project" == "$project" ]] || fail

# Application producers/workers were stopped by the parent M1A drill before
# this step. Reuse the same marker in both stores; this is controlled fixture
# correlation, NOT an atomic pg_dump+Redis SAVE protocol.
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -q \
  -U vibress -d vibress \
  -c "INSERT INTO public.m1a_drill_marker(marker) VALUES ('$expected')" >/dev/null || fail
sql_snapshot="$tmp/paired-postgres.dump"
"${compose[@]}" exec -T postgres \
  pg_dump -U vibress -d vibress --format=custom > "$sql_snapshot" || fail
[[ -s "$sql_snapshot" ]] || fail
sql_sha="$(sha256sum "$sql_snapshot" | cut -d ' ' -f 1)"
[[ "$sql_sha" =~ ^[0-9a-f]{64}$ ]] || fail

actual="$("${compose[@]}" exec -T redis redis-cli --raw SAVE)"
[[ "$actual" == "OK" ]] || fail

snapshot="$tmp/dump.rdb"
docker cp "$source_id:/data/dump.rdb" "$snapshot" >/dev/null || fail
[[ -s "$snapshot" ]] || fail
archive_sha="$(sha256sum "$snapshot" | cut -d ' ' -f 1)"
[[ "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || fail

# Use the SAME image ID as the disposable source: no unrelated image pull and
# no public ports. Copy the RDB before starting Redis so it loads at boot.
image_id="$(docker inspect --format '{{.Image}}' "$source_id")"
restore_name="vibress-m1a-rdb-restore-${GITHUB_RUN_ID}"
restore_id="$(docker create --name "$restore_name" --network none "$image_id" \
  redis-server --appendonly no --save '' 2>/dev/null)" || fail
docker cp "$snapshot" "$restore_id:/data/dump.rdb" >/dev/null || fail
docker start "$restore_id" >/dev/null || fail

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(docker exec "$restore_id" redis-cli --raw PING 2>/dev/null || true)" == "PONG" ]]; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == "1" ]] || fail
[[ "$(docker exec "$restore_id" redis-cli --raw GET "$key")" == "$expected" ]] || fail
[[ "$(docker exec "$restore_id" redis-cli --raw HGET "$key:queue" status)" == "pending" ]] || fail
[[ "$(docker exec "$restore_id" redis-cli --raw HGET "$key:queue" publication)" == "historical-ar" ]] || fail

# Restore the second snapshot to a fresh database. Compare the persisted
# marker against the separately booted offline Redis RDB target; no source DB
# or original Redis keys are used to satisfy the recovered-side assertion.
"${compose[@]}" exec -T postgres createdb -U vibress vibress_m1a_paired || fail
"${compose[@]}" exec -T postgres \
  pg_restore -U vibress --no-owner --no-acl --exit-on-error \
    -d vibress_m1a_paired < "$sql_snapshot" || fail
restored_pg="$("${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 \
  -U vibress -d vibress_m1a_paired -Atqc \
  "SELECT marker FROM public.m1a_drill_marker WHERE marker='$expected'")"
restored_redis="$(docker exec "$restore_id" redis-cli --raw GET "$key")"
[[ "$restored_pg" == "$expected" && "$restored_redis" == "$restored_pg" ]] || fail
original_sentinel="$("${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 \
  -U vibress -d vibress_m1a_paired -Atqc \
  "SELECT count(*) FROM public.m1a_drill_marker WHERE marker='isolated-recovery-sentinel'")"
[[ "$original_sentinel" == "1" ]] || fail

# The two independently captured archives must remain unchanged throughout
# recovery; this is only a quiesced fixture checkpoint, not production RPO/RTO,
# an atomic multi-service snapshot, or live BullMQ lease/receipt reconciliation.
[[ "$(sha256sum "$snapshot" | cut -d ' ' -f 1)" == "$archive_sha" ]] || fail
[[ "$(sha256sum "$sql_snapshot" | cut -d ' ' -f 1)" == "$sql_sha" ]] || fail
printf '%s\n' 'PLUGIN_M1A_PAIRED_CHECKPOINT_PASSED: quiesced PostgreSQL/Redis snapshots restored separately with equal durable fixture marker'
printf '%s\n' 'PLUGIN_M1A_REDIS_SNAPSHOT_PASSED: isolated RDB snapshot restored to a different no-network container with intact sentinel and queue-shaped metadata'
