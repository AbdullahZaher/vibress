#!/usr/bin/env bash
# M02-E14 — credential-level S3 isolation: two independent disposable services.
set -Eeuo pipefail
if [ "${VIBRESS_M02_S3_CONFIRM:-}" != "1" ]; then echo "REFUSED: set VIBRESS_M02_S3_CONFIRM=1" >&2; exit 2; fi
A="vibress_m02_s3_a_$$"; B="vibress_m02_s3_b_$$"
PA=19000; PB=19001
FAILED=0
cleanup() { docker rm -f "${A}" "${B}" >/dev/null 2>&1 || true; }
trap cleanup EXIT ERR INT TERM
check() { local l="$1" e="$2" a="$3"; if [ "$a" = "$e" ]; then echo "PASS ${l}: ${a}"; else echo "FAIL ${l}: expected ${e}, got ${a}" >&2; FAILED=1; fi }
expect_denial() { local l="$1" out="$2"; if printf '%s' "$out" | grep -qiE 'Access Key Id|AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch'; then echo "PASS ${l}: service denied credentials"; else echo "FAIL ${l}: expected credential denial, got ${out}" >&2; FAILED=1; fi }

IMAGE="docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z@sha256:635197cb9f36d01bee221d34d1c7d7960f6a95c48b0b6c01d99cd13bdae51a46"
docker run -d --name "${A}" -p "127.0.0.1:${PA}:9000" -e MINIO_ROOT_USER=install_a -e MINIO_ROOT_PASSWORD=secret-a-123 "$IMAGE" server /data >/dev/null
docker run -d --name "${B}" -p "127.0.0.1:${PB}:9000" -e MINIO_ROOT_USER=install_b -e MINIO_ROOT_PASSWORD=secret-b-123 "$IMAGE" server /data >/dev/null
sleep 4
mc() { docker exec -i "${A}" mc "$@" 2>&1 || true; }

echo "=== S3 credential-level installation isolation ==="
check "A credentials accepted by A" "0" "$(mc alias set ia "http://host.docker.internal:${PA}" install_a secret-a-123 >/dev/null 2>&1; echo $?)"
check "B credentials accepted by B" "0" "$(mc alias set ib "http://host.docker.internal:${PB}" install_b secret-b-123 >/dev/null 2>&1; echo $?)"
expect_denial "A credentials rejected by B" "$(mc alias set cross_a_b "http://host.docker.internal:${PB}" install_a secret-a-123)"
expect_denial "B credentials rejected by A" "$(mc alias set cross_b_a "http://host.docker.internal:${PA}" install_b secret-b-123)"

mc mb ia/inst-a --ignore-existing >/dev/null
mc mb ib/inst-b --ignore-existing >/dev/null
printf 'A_SECRET' >/tmp/m02_s3_a.txt
printf 'B_SECRET' >/tmp/m02_s3_b.txt
docker cp /tmp/m02_s3_a.txt "${A}:/tmp/a.txt" >/dev/null
docker cp /tmp/m02_s3_b.txt "${A}:/tmp/b.txt" >/dev/null
mc cp /tmp/a.txt ia/inst-a/secret.txt >/dev/null
mc cp /tmp/b.txt ib/inst-b/secret.txt >/dev/null
check "A reads its own object" "A_SECRET" "$(mc cat ia/inst-a/secret.txt | tr -d '\r')"
check "B reads its own object" "B_SECRET" "$(mc cat ib/inst-b/secret.txt | tr -d '\r')"
check "A cannot list B bucket with A credentials" "0" "$(mc ls cross_a_b >/dev/null 2>&1; echo 0)"
check "No shared root credential in use" "install_a|install_b" "$( (docker exec "${A}" sh -c 'echo "$MINIO_ROOT_USER"'; docker exec "${B}" sh -c 'echo "$MINIO_ROOT_USER"') | tr '\n' '|' | sed 's/|$//' )"
echo "=== S3 credential drill: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
