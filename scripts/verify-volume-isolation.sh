#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Docker Volume Isolation Regression Test (Blocker P0-2)
# ==============================================================================
# Verifies that:
#   1. Backup of Project A contains ONLY Project A's assets.
#   2. Backup of Project B contains ONLY Project B's assets.
#   3. A missing Project A volume NEVER selects Project B's volume (no global search).
#   4. Stopped services still resolve the correct existing volume.
#   5. Explicit volume overrides (--content-volume) are strictly validated.
#   6. SHA-256 checks establish byte-for-byte content parity.
#   7. Disposable test resources are completely cleaned up.
# ==============================================================================

PROJECT_A="vibress-vol-iso-a-$$"
PROJECT_B="vibress-vol-iso-b-$$"
TEST_DIR="/tmp/vibress-vol-iso-$$"
COMPOSE_A="${TEST_DIR}/compose.a.yml"
COMPOSE_B="${TEST_DIR}/compose.b.yml"
ENV_A="${TEST_DIR}/env.a"
ENV_B="${TEST_DIR}/env.b"
BACKUP_DIR_A="${TEST_DIR}/backups_a"
BACKUP_DIR_B="${TEST_DIR}/backups_b"

VOL_A="${PROJECT_A}_vibress_content"
VOL_B="${PROJECT_B}_vibress_content"
PG_VOL_A="${PROJECT_A}_postgres_data"
PG_VOL_B="${PROJECT_B}_postgres_data"

cleanup() {
  echo -e "\n[Teardown] Cleaning up volume isolation test resources..."
  docker compose -p "${PROJECT_A}" -f "${COMPOSE_A}" down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose -p "${PROJECT_B}" -f "${COMPOSE_B}" down -v --remove-orphans >/dev/null 2>&1 || true
  docker volume rm -f "${VOL_A}" "${VOL_B}" "${PG_VOL_A}" "${PG_VOL_B}" >/dev/null 2>&1 || true
  rm -rf "${TEST_DIR}"
}
trap cleanup EXIT ERR INT TERM

echo "================================================================================"
echo " Vibress Docker Volume Isolation Verification (Blocker P0-2)"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo " Project A: ${PROJECT_A}"
echo " Project B: ${PROJECT_B}"
echo "================================================================================"

mkdir -p "${TEST_DIR}" "${BACKUP_DIR_A}" "${BACKUP_DIR_B}"

# Create Compose and Env definitions for Project A
cat << EOF > "${COMPOSE_A}"
name: ${PROJECT_A}
services:
  postgres:
    image: postgres:16-alpine
    restart: "no"
    environment:
      POSTGRES_USER: vibress
      POSTGRES_DB: vibress_a
      POSTGRES_PASSWORD: secret_password_a
    volumes:
      - postgres_data:/var/lib/postgresql/data
  api:
    image: alpine:latest
    restart: "no"
    command: sleep 3600
    volumes:
      - vibress_content:/repo/content
volumes:
  postgres_data:
  vibress_content:
EOF

cat << EOF > "${ENV_A}"
POSTGRES_USER=vibress
POSTGRES_DB=vibress_a
POSTGRES_PASSWORD=secret_password_a
COMPOSE_PROJECT_NAME=${PROJECT_A}
STORAGE_PROVIDER=local
EOF

# Create Compose and Env definitions for Project B
cat << EOF > "${COMPOSE_B}"
name: ${PROJECT_B}
services:
  postgres:
    image: postgres:16-alpine
    restart: "no"
    environment:
      POSTGRES_USER: vibress
      POSTGRES_DB: vibress_b
      POSTGRES_PASSWORD: secret_password_b
    volumes:
      - postgres_data:/var/lib/postgresql/data
  api:
    image: alpine:latest
    restart: "no"
    command: sleep 3600
    volumes:
      - vibress_content:/repo/content
volumes:
  postgres_data:
  vibress_content:
EOF

cat << EOF > "${ENV_B}"
POSTGRES_USER=vibress
POSTGRES_DB=vibress_b
POSTGRES_PASSWORD=secret_password_b
COMPOSE_PROJECT_NAME=${PROJECT_B}
STORAGE_PROVIDER=local
EOF

echo -e "\n[Step 1] Starting isolated Compose clusters..."
docker compose -p "${PROJECT_A}" -f "${COMPOSE_A}" up -d postgres api
docker compose -p "${PROJECT_B}" -f "${COMPOSE_B}" up -d postgres api

# Wait for postgres readiness
until docker compose -p "${PROJECT_A}" -f "${COMPOSE_A}" exec -T postgres pg_isready -U vibress -d vibress_a >/dev/null 2>&1; do
  sleep 1
done
until docker compose -p "${PROJECT_B}" -f "${COMPOSE_B}" exec -T postgres pg_isready -U vibress -d vibress_b >/dev/null 2>&1; do
  sleep 1
done

echo -e "\n[Step 2] Seeding distinct, verifiable assets into Project A and Project B volumes..."
PAYLOAD_A="PROJECT_A_EXCLUSIVE_PAYLOAD_UUID_$(openssl rand -hex 16)"
PAYLOAD_B="PROJECT_B_EXCLUSIVE_PAYLOAD_UUID_$(openssl rand -hex 16)"

docker run --rm -v "${VOL_A}:/vol" alpine sh -c "mkdir -p /vol/media /vol/themes/theme-a; echo '${PAYLOAD_A}' > /vol/media/project-a-banner.png; echo '{\"theme\":\"a\"}' > /vol/themes/theme-a/manifest.json"
docker run --rm -v "${VOL_B}:/vol" alpine sh -c "mkdir -p /vol/media /vol/themes/theme-b; echo '${PAYLOAD_B}' > /vol/media/project-b-banner.png; echo '{\"theme\":\"b\"}' > /vol/themes/theme-b/manifest.json"

SHA_A=$(docker run --rm -v "${VOL_A}:/vol" alpine sha256sum /vol/media/project-a-banner.png | awk '{print $1}')
SHA_B=$(docker run --rm -v "${VOL_B}:/vol" alpine sha256sum /vol/media/project-b-banner.png | awk '{print $1}')

echo "Project A asset SHA-256: ${SHA_A}"
echo "Project B asset SHA-256: ${SHA_B}"

echo -e "\n[Step 3] Executing Backup for Project A..."
COMPOSE_FILE="${COMPOSE_A}" ENV_FILE="${ENV_A}" ./scripts/backup.sh --with-content "${BACKUP_DIR_A}"

BACKUP_TAR_A=$(ls -t "${BACKUP_DIR_A}"/vibress_content_*.tar.gz | head -n 1)
echo "Backup A archive created: ${BACKUP_TAR_A}"

echo -e "\n[Step 4] Executing Backup for Project B..."
COMPOSE_FILE="${COMPOSE_B}" ENV_FILE="${ENV_B}" ./scripts/backup.sh --with-content "${BACKUP_DIR_B}"

BACKUP_TAR_B=$(ls -t "${BACKUP_DIR_B}"/vibress_content_*.tar.gz | head -n 1)
echo "Backup B archive created: ${BACKUP_TAR_B}"

echo -e "\n[Step 5] Asserting Volume Isolation & Asset Separation..."
UNPACK_A="${TEST_DIR}/unpack_a"
UNPACK_B="${TEST_DIR}/unpack_b"
mkdir -p "${UNPACK_A}" "${UNPACK_B}"

tar -xzf "${BACKUP_TAR_A}" -C "${UNPACK_A}"
tar -xzf "${BACKUP_TAR_B}" -C "${UNPACK_B}"

# Assert Project A archive contains A's asset with exact SHA and does NOT contain B
if [ ! -f "${UNPACK_A}/media/project-a-banner.png" ]; then
  echo "Error: Project A backup missing expected asset 'project-a-banner.png'!" >&2
  exit 1
fi
RESTORED_SHA_A=$(sha256sum "${UNPACK_A}/media/project-a-banner.png" | awk '{print $1}')
if [ "${RESTORED_SHA_A}" != "${SHA_A}" ]; then
  echo "Error: SHA-256 mismatch in Project A restored asset! Expected: ${SHA_A}, Got: ${RESTORED_SHA_A}" >&2
  exit 1
fi
if [ -f "${UNPACK_A}/media/project-b-banner.png" ] || [ -d "${UNPACK_A}/themes/theme-b" ]; then
  echo "CRITICAL ISOLATION FAILURE: Project A backup contains Project B content!" >&2
  exit 1
fi
echo "✓ PASS: Project A backup contains exclusively Project A assets with 100% SHA parity."

# Assert Project B archive contains B's asset with exact SHA and does NOT contain A
if [ ! -f "${UNPACK_B}/media/project-b-banner.png" ]; then
  echo "Error: Project B backup missing expected asset 'project-b-banner.png'!" >&2
  exit 1
fi
RESTORED_SHA_B=$(sha256sum "${UNPACK_B}/media/project-b-banner.png" | awk '{print $1}')
if [ "${RESTORED_SHA_B}" != "${SHA_B}" ]; then
  echo "Error: SHA-256 mismatch in Project B restored asset! Expected: ${SHA_B}, Got: ${RESTORED_SHA_B}" >&2
  exit 1
fi
if [ -f "${UNPACK_B}/media/project-a-banner.png" ] || [ -d "${UNPACK_B}/themes/theme-a" ]; then
  echo "CRITICAL ISOLATION FAILURE: Project B backup contains Project A content!" >&2
  exit 1
fi
echo "✓ PASS: Project B backup contains exclusively Project B assets with 100% SHA parity."

echo -e "\n[Step 6] Testing Stopped Services Volume Resolution..."
docker compose -p "${PROJECT_A}" -f "${COMPOSE_A}" stop api
BACKUP_DIR_A_STOPPED="${TEST_DIR}/backups_a_stopped"
mkdir -p "${BACKUP_DIR_A_STOPPED}"
COMPOSE_FILE="${COMPOSE_A}" ENV_FILE="${ENV_A}" ./scripts/backup.sh --with-content "${BACKUP_DIR_A_STOPPED}"
STOPPED_TAR=$(ls -t "${BACKUP_DIR_A_STOPPED}"/vibress_content_*.tar.gz | head -n 1)
if ! tar -tzf "${STOPPED_TAR}" | grep -q "media/project-a-banner.png"; then
  echo "Error: Stopped service backup failed to resolve the correct existing volume!" >&2
  exit 1
fi
echo "✓ PASS: Stopped containers correctly resolved the project-scoped volume."

echo -e "\n[Step 7] Testing Missing Volume: Must Fail Closed and NEVER select Project B..."
docker compose -p "${PROJECT_A}" -f "${COMPOSE_A}" rm -f -s -v api >/dev/null 2>&1 || true
docker volume rm -f "${VOL_A}" >/dev/null 2>&1 || true
BACKUP_DIR_A_MISSING="${TEST_DIR}/backups_a_missing"
mkdir -p "${BACKUP_DIR_A_MISSING}"

MISSING_OUTPUT=$(COMPOSE_FILE="${COMPOSE_A}" ENV_FILE="${ENV_A}" ./scripts/backup.sh --with-content "${BACKUP_DIR_A_MISSING}" 2>&1 || true)
if echo "${MISSING_OUTPUT}" | grep -q "Refusing to proceed without backing up required application content or guessing other projects' volumes"; then
  echo "✓ PASS: Missing volume triggered fail-closed rejection. Global fallback was strictly prevented."
else
  echo "✗ FAIL: Missing volume did not fail closed cleanly! Output was: ${MISSING_OUTPUT}" >&2
  exit 1
fi

echo -e "\n[Step 8] Testing Explicit Volume Overrides..."
BACKUP_DIR_OVERRIDE="${TEST_DIR}/backups_override"
mkdir -p "${BACKUP_DIR_OVERRIDE}"

# 1. Invalid volume override must fail
INVALID_VOL_OUTPUT=$(COMPOSE_FILE="${COMPOSE_B}" ENV_FILE="${ENV_B}" ./scripts/backup.sh --with-content --content-volume "non_existent_volume_$$" "${BACKUP_DIR_OVERRIDE}" 2>&1 || true)
if echo "${INVALID_VOL_OUTPUT}" | grep -q "Explicit content volume 'non_existent_volume_.*' does not exist"; then
  echo "✓ PASS: Non-existent explicit volume override failed closed."
else
  echo "✗ FAIL: Expected failure for non-existent volume override! Output was: ${INVALID_VOL_OUTPUT}" >&2
  exit 1
fi

# 2. Valid volume override must succeed
VALID_OVERRIDE_DIR="${TEST_DIR}/backups_override_valid"
mkdir -p "${VALID_OVERRIDE_DIR}"
COMPOSE_FILE="${COMPOSE_B}" ENV_FILE="${ENV_B}" ./scripts/backup.sh --with-content --content-volume "${VOL_B}" "${VALID_OVERRIDE_DIR}" >/dev/null
OVERRIDE_TAR=$(ls -t "${VALID_OVERRIDE_DIR}"/vibress_content_*.tar.gz | head -n 1)
if tar -tzf "${OVERRIDE_TAR}" | grep -q "media/project-b-banner.png"; then
  echo "✓ PASS: Valid explicit volume override backed up the specified target volume."
else
  echo "✗ FAIL: Valid explicit volume override failed to back up expected assets!" >&2
  exit 1
fi

echo -e "\n================================================================================"
echo " DOCKER VOLUME ISOLATION CERTIFICATION: ALL CHECKS PASSED (Blocker P0-2 Resolved)"
echo "================================================================================"
