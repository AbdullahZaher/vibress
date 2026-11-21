#!/usr/bin/env bash
# M02-E14 — fail-closed credential-level S3 isolation drill.
set -Eeuo pipefail
if [ "${VIBRESS_M02_S3_CONFIRM:-}" != "1" ]; then echo "REFUSED: set VIBRESS_M02_S3_CONFIRM=1" >&2; exit 2; fi
A="vibress_m02_s3_a_$$"; B="vibress_m02_s3_b_$$"; PA=19000; PB=19001
FAILED=0
cleanup() { docker rm -f "${A}" "${B}" >/dev/null 2>&1 || true; rm -f /tmp/m02_s3_{out,err}; }
trap cleanup EXIT INT TERM
check() { local l="$1" e="$2" a="$3"; if [ "$a" = "$e" ]; then echo "PASS ${l}: ${a}"; else echo "FAIL ${l}: expected ${e}, got ${a}" >&2; FAILED=1; fi; }

# Runs a command and captures stdout/stderr/exit code separately. Never masks
# failures: the caller must assert the expected outcome explicitly.
run() {
  local out=/tmp/m02_s3_out err=/tmp/m02_s3_err
  : >"$out"; : >"$err"
  if "$@" >"$out" 2>"$err"; then LAST_RC=0; else LAST_RC=$?; fi
  LAST_OUT=$(cat "$out" 2>/dev/null || true)
  LAST_ERR=$(cat "$err" 2>/dev/null || true)
}
expect_ok() { local l="$1"; shift; run "$@"; if [ "$LAST_RC" -eq 0 ]; then echo "PASS ${l}: exit 0"; else echo "FAIL ${l}: exit ${LAST_RC} err=${LAST_ERR}" >&2; FAILED=1; fi; }
expect_credential_denied() {
  local l="$1"; shift; run "$@"
  if [ "$LAST_RC" -ne 0 ] && printf '%s%s' "$LAST_OUT" "$LAST_ERR" | grep -qiE 'Access Key Id|InvalidAccessKeyId|AccessDenied|SignatureDoesNotMatch'; then
    echo "PASS ${l}: service-side credential denial"
  elif [ "$LAST_RC" -eq 0 ]; then
    echo "FAIL ${l}: unauthorized request unexpectedly succeeded" >&2; FAILED=1
  else
    echo "FAIL ${l}: ambiguous failure (not authorization denial) rc=${LAST_RC} err=${LAST_ERR}" >&2; FAILED=1
  fi
}

IMAGE="docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z@sha256:635197cb9f36d01bee221d34d1c7d7960f6a95c48b0b6c01d99cd13bdae51a46"
expect_ok "start installation A service" docker run -d --name "${A}" -p "127.0.0.1:${PA}:9000" -e MINIO_ROOT_USER=install_a -e MINIO_ROOT_PASSWORD=secret-a-123 "$IMAGE" server /data
expect_ok "start installation B service" docker run -d --name "${B}" -p "127.0.0.1:${PB}:9000" -e MINIO_ROOT_USER=install_b -e MINIO_ROOT_PASSWORD=secret-b-123 "$IMAGE" server /data
sleep 4
mc() { docker exec -i "${A}" mc "$@"; }

echo "=== S3 credential isolation (fail-closed) ==="
expect_ok "A credentials accepted by A" mc alias set ia "http://host.docker.internal:${PA}" install_a secret-a-123
expect_ok "B credentials accepted by B" mc alias set ib "http://host.docker.internal:${PB}" install_b secret-b-123
expect_credential_denied "A credentials rejected by B" docker exec -i "${A}" mc alias set cross_a_b "http://host.docker.internal:${PB}" install_a secret-a-123
expect_credential_denied "B credentials rejected by A" docker exec -i "${A}" mc alias set cross_b_a "http://host.docker.internal:${PA}" install_b secret-b-123

# Negative control 1: identical credentials on both services must be ACCEPTED,
# proving the harness distinguishes authorized from unauthorized configurations.
expect_ok "negative control: shared credentials accepted" docker exec -i "${A}" mc alias set shared "http://host.docker.internal:${PB}" install_b secret-b-123
# Negative control 2: wrong credential must be denied with a service error.
expect_credential_denied "negative control: wrong key denied" docker exec -i "${A}" mc alias set wrong "http://host.docker.internal:${PA}" install_b secret-b-123

expect_ok "create A bucket" mc mb ia/inst-a --ignore-existing
expect_ok "create B bucket" mc mb ib/inst-b --ignore-existing
printf 'A_SECRET' >/tmp/m02_s3_a.txt; printf 'B_SECRET' >/tmp/m02_s3_b.txt
expect_ok "copy A fixture" docker cp /tmp/m02_s3_a.txt "${A}:/tmp/a.txt"
expect_ok "copy B fixture" docker cp /tmp/m02_s3_b.txt "${A}:/tmp/b.txt"
expect_ok "upload A object" mc cp /tmp/a.txt ia/inst-a/secret.txt
expect_ok "upload B object" mc cp /tmp/b.txt ib/inst-b/secret.txt
run mc cat ia/inst-a/secret.txt; check "A reads own object" "A_SECRET" "${LAST_OUT}"
run mc cat ib/inst-b/secret.txt; check "B reads own object" "B_SECRET" "${LAST_OUT}"
run mc alias list; check "cross-credential alias absent" "0" "$(printf '%s' "$LAST_OUT" | grep -c 'cross_a_b' || true)"
check "no shared root credential" "install_a|install_b" "$( (docker exec "${A}" sh -c 'echo "$MINIO_ROOT_USER"'; docker exec "${B}" sh -c 'echo "$MINIO_ROOT_USER"') | tr '\n' '|' | sed 's/|$//' )"
echo "=== S3 drill: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
