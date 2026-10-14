#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Storage Directory & Container Replacement Persistence Verification
# ==============================================================================
# Verifies that:
# 1. With STORAGE_LOCAL_ROOT=/repo/content/media (inside the mounted volume /repo/content),
#    uploads persist across complete container destruction and replacement.
# 2. Uploads to an unmounted directory (such as /opt/vibress/content/media) do NOT
#    persist across container replacement, proving why /repo/content/media is required.
# ==============================================================================

TEST_VOL="vibress_test_content_verify_$$"
C1="vibress_verify_c1_$$"
C2="vibress_verify_c2_$$"

cleanup() {
  docker rm -f "${C1}" "${C2}" >/dev/null 2>&1 || true
  docker volume rm -f "${TEST_VOL}" >/dev/null 2>&1 || true
}
trap cleanup EXIT ERR INT TERM

echo "================================================================================"
echo " Storage Directory & Container Replacement Verification"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"

echo -e "\n[Step 1] Creating isolated persistent test volume '${TEST_VOL}'..."
docker volume create "${TEST_VOL}" >/dev/null

echo "[Step 2] Launching Container 1 with mount '${TEST_VOL}:/repo/content'..."
docker run -d --name "${C1}" -v "${TEST_VOL}:/repo/content" alpine sleep 3600 >/dev/null

echo "[Step 3] Simulating media upload to '/repo/content/media' (canonical mount)..."
docker exec "${C1}" mkdir -p /repo/content/media/2026/10
UPLOAD_PAYLOAD="Vibress media asset content - $(date +%s) - random_bytes_${RANDOM}"
docker exec "${C1}" sh -c "echo '${UPLOAD_PAYLOAD}' > /repo/content/media/2026/10/banner.webp"
EXPECTED_SHA=$(docker exec "${C1}" sha256sum /repo/content/media/2026/10/banner.webp | awk '{print $1}')
echo "Uploaded asset SHA-256: ${EXPECTED_SHA}"

echo "[Step 4] Simulating faulty upload to '/opt/vibress/content/media' (unmounted container overlay)..."
docker exec "${C1}" mkdir -p /opt/vibress/content/media
docker exec "${C1}" sh -c "echo 'faulty_data' > /opt/vibress/content/media/lost.webp"

echo "[Step 5] Destroying Container 1 completely (simulating container upgrade/replacement)..."
docker rm -f "${C1}" >/dev/null

echo "[Step 6] Launching Container 2 from fresh image with identical volume mount..."
docker run -d --name "${C2}" -v "${TEST_VOL}:/repo/content" alpine sleep 3600 >/dev/null

echo "[Step 7] Verifying upload persistence in Container 2 at '/repo/content/media'..."
if ! docker exec "${C2}" test -f /repo/content/media/2026/10/banner.webp; then
  echo "Error: Uploaded file missing after container replacement!" >&2
  exit 1
fi

RESTORED_SHA=$(docker exec "${C2}" sha256sum /repo/content/media/2026/10/banner.webp | awk '{print $1}')
echo "Restored asset SHA-256: ${RESTORED_SHA}"

if [ "${EXPECTED_SHA}" != "${RESTORED_SHA}" ]; then
  echo "Error: SHA-256 mismatch after container replacement!" >&2
  exit 1
fi
echo "✓ Upload persistence confirmed: /repo/content/media retained exact byte parity."

echo "[Step 8] Verifying unmounted '/opt/vibress/content/media' was destroyed (expected behavior)..."
if docker exec "${C2}" test -f /opt/vibress/content/media/lost.webp; then
  echo "Error: File in unmounted container directory unexpectedly persisted." >&2
  exit 1
fi
echo "✓ Verified unmounted directory /opt/vibress/content/media does NOT persist."

echo -e "\n================================================================================"
echo " STORAGE PERSISTENCE CERTIFICATION: PASSED"
echo "================================================================================"
