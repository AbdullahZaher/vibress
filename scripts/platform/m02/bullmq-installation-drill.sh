#!/usr/bin/env bash
# M02-E14 — two disposable Redis installations running a real BullMQ drill.
set -Eeuo pipefail
if [ "${VIBRESS_M02_BULLMQ_CONFIRM:-}" != "1" ]; then echo "REFUSED: set VIBRESS_M02_BULLMQ_CONFIRM=1" >&2; exit 2; fi
A="vibress_m02_bull_a_$$"; B="vibress_m02_bull_b_$$"
cleanup() { docker rm -f "${A}" "${B}" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run -d --name "${A}" -p 127.0.0.1:16390:6379 redis:7-alpine redis-server --requirepass secret-a >/dev/null
docker run -d --name "${B}" -p 127.0.0.1:16391:6379 redis:7-alpine redis-server --requirepass secret-b >/dev/null
sleep 3
cd packages/queue
M02_REDIS_A_PORT=16390 M02_REDIS_B_PORT=16391 npx tsx ../../scripts/platform/m02/bullmq-installation-drill.mts
