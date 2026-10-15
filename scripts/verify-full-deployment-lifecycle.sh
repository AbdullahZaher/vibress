#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress End-to-End Fresh Installation & Populated Upgrade Verification Drill
# ==============================================================================
# Certifies:
# 1. Full Fresh Installation: Complete execution of deploy-production.sh on an
#    empty, uninitialized Compose project (containers, volumes, network).
# 2. Population: Insertion of live customer data (Owner, Member, Post, Setting,
#    Theme configuration, media assets, and theme storage assets).
# 3. Populated Upgrade: Complete execution of deploy-production.sh on the existing
#    cluster, enforcing mandatory pre-upgrade backups, applying migrations, and
#    rolling out updated containers.
# 4. Data & Asset Parity: Asserting 100% preservation of database entities,
#    media storage assets, and theme assets across the entire upgrade.
# ==============================================================================

PROJECT_NAME="vibress-lifecycle-drill"
COMPOSE_FILE="compose.lifecycle-drill.yml"
ENV_FILE=".env.lifecycle-drill"
DRILL_PORT="8777"
BACKUP_DIR="./backups"

COMPOSE_CMD=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

cleanup() {
  echo -e "\n[Cleanup] Tearing down lifecycle drill stack and volumes..."
  if [ -f "${COMPOSE_FILE}" ] && [ -f "${ENV_FILE}" ]; then
    "${COMPOSE_CMD[@]}" down -v >/dev/null 2>&1 || true
  fi
  docker compose -p "${PROJECT_NAME}" down -v >/dev/null 2>&1 || true
  rm -f "${COMPOSE_FILE}" "${ENV_FILE}"
}
trap cleanup EXIT ERR INT TERM

echo "================================================================================"
echo " VIBRESS LIFECYCLE DEPLOYMENT & UPGRADE DRILL"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo " Project: ${PROJECT_NAME} | Gateway Port: ${DRILL_PORT}"
echo "================================================================================"

# --- Step 1: Scaffold Isolated Configuration ---
echo -e "\n[Step 1/6] Scaffolding isolated production configuration..."

cat << EOF > "${ENV_FILE}"
NODE_ENV=production
VIBRESS_VERSION=1.2.0
LOG_LEVEL=info
POSTGRES_USER=vibress
POSTGRES_PASSWORD=drill-secure-password-12345
POSTGRES_DB=vibress_drill
SITE_URL=http://localhost:${DRILL_PORT}
ADMIN_ORIGIN=http://localhost:${DRILL_PORT}
PORTAL_ORIGIN=http://localhost:${DRILL_PORT}
VIBRESS_PORT=${DRILL_PORT}
VIBRESS_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
BACKUP_SIGNING_KEY=drill-backup-signing-key-0123456789abcdef0123456789abcdef
VIBRESS_SETUP_TOKEN=drill-setup-token-0123456789abcdef
NEWSLETTER_UNSUBSCRIBE_SECRET=drill-unsub-secret-12345
STRIPE_SECRET_KEY=sk_test_drill_mock_key
STRIPE_WEBHOOK_SECRET=whsec_drill_mock_webhook_secret
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=Vibress <no-reply@example.com>
STORAGE_PROVIDER=local
STORAGE_LOCAL_ROOT=/repo/content/media
EOF

# Generate Compose file tailored to the drill project
sed -e "s/^name: vibress-prod/name: ${PROJECT_NAME}/" compose.prod.yml > "${COMPOSE_FILE}"

# Ensure completely clean initial state
docker compose -p "${PROJECT_NAME}" down -v >/dev/null 2>&1 || true

# --- Step 2: Execute Fresh Installation Deployment ---
echo -e "\n[Step 2/6] Executing full fresh-installation deploy-production.sh pipeline..."

DEPLOY_OUTPUT=""
if ! DEPLOY_OUTPUT=$(./scripts/deploy-production.sh --compose-file "${COMPOSE_FILE}" --env-file "${ENV_FILE}" 2>&1); then
  echo "Error: Fresh deployment failed with exit code $?!" >&2
  echo "${DEPLOY_OUTPUT}" >&2
  exit 1
fi
tail -n 25 <<< "${DEPLOY_OUTPUT}" || true

if [[ "${DEPLOY_OUTPUT}" != *"Verified fresh installation"* ]]; then
  echo "Error: Fresh installation was not detected by deploy-production.sh!" >&2
  exit 1
fi
if [[ "${DEPLOY_OUTPUT}" != *"VIBRESS PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY"* ]]; then
  echo "Error: Fresh deployment did not complete successfully!" >&2
  exit 1
fi
echo "✓ Full fresh installation pipeline succeeded and passed all health & smoke probes."

# --- Step 3: Populate Deployment with Customer Data ---
echo -e "\n[Step 3/6] Populating deployment with test customer data..."

# 1. Insert Owner user
OWNER_ID="11111111-2222-3333-4444-555555555555"
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -c \
  "INSERT INTO users (id, email, name, slug, password_hash, status) \
   VALUES ('${OWNER_ID}', 'owner@drill.com', 'Drill Owner', 'drill-owner', 'hash123', 'active') \
   ON CONFLICT (id) DO NOTHING;" >/dev/null

# 2. Insert Publication Membership
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -c \
  "INSERT INTO publication_memberships (id, publication_id, user_id, role) \
   VALUES ('pm-111', 'pub_default', '${OWNER_ID}', 'owner') \
   ON CONFLICT DO NOTHING;" >/dev/null

# 3. Insert Member
MEMBER_ID="22222222-3333-4444-5555-666666666666"
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -c \
  "INSERT INTO members (id, publication_id, email, email_normalized, name, status) \
   VALUES ('${MEMBER_ID}', 'pub_default', 'vip-member@drill.com', 'vip-member@drill.com', 'VIP Member', 'active') \
   ON CONFLICT DO NOTHING;" >/dev/null

# 4. Insert Post
POST_ID="33333333-4444-5555-6666-777777777777"
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -c \
  "INSERT INTO posts (id, publication_id, title, slug, content, status, visibility, primary_author_id, created_by, updated_by) \
   VALUES ('${POST_ID}', 'pub_default', 'Drill Post Title', 'drill-post', '{\"schema\":\"vibress-studio\",\"version\":1,\"root\":{\"type\":\"root\",\"children\":[]}}', 'published', 'public', '${OWNER_ID}', '${OWNER_ID}', '${OWNER_ID}') \
   ON CONFLICT DO NOTHING;" >/dev/null

# 5. Insert Setting
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -c \
  "INSERT INTO settings (id, publication_id, namespace, key, value) \
   VALUES ('sett-111', 'pub_default', 'site', 'title', '\"Preserved Drill Site Title\"') \
   ON CONFLICT DO NOTHING;" >/dev/null

# 6. Insert Theme Configuration
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -c \
  "INSERT INTO theme_configurations (id, publication_id, theme_id, theme_version, settings_json) \
   VALUES ('tc-111', 'pub_default', 'theme-drill-custom', '1.0.0', '{\"customColor\":\"#123456\"}') \
   ON CONFLICT (publication_id) DO UPDATE SET settings_json = EXCLUDED.settings_json;" >/dev/null

# 7. Upload media asset into /repo/content/media inside API container
SAMPLE_MEDIA_PAYLOAD="LIFECYCLE-MEDIA-ASSET-BYTE-STREAM-$(date +%s)-$RANDOM"
"${COMPOSE_CMD[@]}" exec -T api sh -c "mkdir -p /repo/content/media/drill && echo '${SAMPLE_MEDIA_PAYLOAD}' > /repo/content/media/drill/asset.png"
EXPECTED_MEDIA_SHA=$("${COMPOSE_CMD[@]}" exec -T api sha256sum /repo/content/media/drill/asset.png | awk '{print $1}' | tr -d '\r')

# 8. Upload theme file into /repo/content/themes/theme-drill-custom inside API container
SAMPLE_THEME_PAYLOAD="{\"name\":\"drill-theme\",\"version\":\"1.0.0\",\"timestamp\":$(date +%s)}"
"${COMPOSE_CMD[@]}" exec -T api sh -c "mkdir -p /repo/content/themes/theme-drill-custom && echo '${SAMPLE_THEME_PAYLOAD}' > /repo/content/themes/theme-drill-custom/theme.json"
EXPECTED_THEME_SHA=$("${COMPOSE_CMD[@]}" exec -T api sha256sum /repo/content/themes/theme-drill-custom/theme.json | awk '{print $1}' | tr -d '\r')

echo "Populated Owner: ${OWNER_ID}"
echo "Populated Member: ${MEMBER_ID}"
echo "Populated Post: ${POST_ID}"
echo "Populated Theme Config ID: tc-111"
echo "Populated Media Asset SHA-256: ${EXPECTED_MEDIA_SHA}"
echo "Populated Theme Asset SHA-256: ${EXPECTED_THEME_SHA}"
echo "✓ Customer dataset and storage assets successfully committed."

# --- Step 4: Execute Populated Upgrade Deployment ---
echo -e "\n[Step 4/6] Executing full populated-upgrade deploy-production.sh pipeline..."

UPGRADE_OUTPUT=""
if ! UPGRADE_OUTPUT=$(./scripts/deploy-production.sh --compose-file "${COMPOSE_FILE}" --env-file "${ENV_FILE}" 2>&1); then
  echo "Error: Upgrade deployment failed with exit code $?!" >&2
  echo "${UPGRADE_OUTPUT}" >&2
  exit 1
fi
tail -n 25 <<< "${UPGRADE_OUTPUT}" || true

if [[ "${UPGRADE_OUTPUT}" != *"Existing Vibress deployment detected"* ]]; then
  echo "Error: Existing deployment was not detected during upgrade!" >&2
  exit 1
fi
if [[ "${UPGRADE_OUTPUT}" != *"Pre-deployment upgrade backup verified successfully"* ]]; then
  echo "Error: Mandatory pre-upgrade backup was not verified!" >&2
  exit 1
fi
if [[ "${UPGRADE_OUTPUT}" != *"VIBRESS PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY"* ]]; then
  echo "Error: Upgrade deployment did not complete successfully!" >&2
  exit 1
fi
echo "✓ Populated upgrade completed with verified pre-deployment backup and passing smoke checks."

# --- Step 5: Assert Post-Upgrade Entity & Media Preservation ---
echo -e "\n[Step 5/6] Verifying post-upgrade data & media persistence..."

# 1. Assert Owner exists
OWNER_COUNT=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -tAc "SELECT count(*) FROM users WHERE id='${OWNER_ID}';" | tr -d '[:space:]')
if [ "${OWNER_COUNT}" != "1" ]; then
  echo "Error: Owner user lost after upgrade!" >&2
  exit 1
fi
echo "✓ Owner user preserved."

# 2. Assert Member exists
MEMBER_COUNT=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -tAc "SELECT count(*) FROM members WHERE id='${MEMBER_ID}';" | tr -d '[:space:]')
if [ "${MEMBER_COUNT}" != "1" ]; then
  echo "Error: Member lost after upgrade!" >&2
  exit 1
fi
echo "✓ Member preserved."

# 3. Assert Post exists
POST_COUNT=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -tAc "SELECT count(*) FROM posts WHERE id='${POST_ID}';" | tr -d '[:space:]')
if [ "${POST_COUNT}" != "1" ]; then
  echo "Error: Post lost after upgrade!" >&2
  exit 1
fi
echo "✓ Post preserved."

# 4. Assert Setting exists
SETTING_VAL=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -tAc "SELECT value FROM settings WHERE id='sett-111';" | tr -d '\r')
if [[ "${SETTING_VAL}" != *"Preserved Drill Site Title"* ]]; then
  echo "Error: Site setting altered or lost after upgrade!" >&2
  exit 1
fi
echo "✓ Site setting preserved."

# 5. Assert Theme Configuration exists
THEME_VAL=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d vibress_drill -tAc "SELECT settings_json FROM theme_configurations WHERE publication_id='pub_default';" | tr -d '\r')
if [[ "${THEME_VAL}" != *"customColor"* ]]; then
  echo "Error: Theme configuration lost or altered after upgrade!" >&2
  exit 1
fi
echo "✓ Theme configuration preserved."

# 6. Assert Media Asset in /repo/content/media has exact SHA-256 match
POST_UPGRADE_MEDIA_SHA=$("${COMPOSE_CMD[@]}" exec -T api sha256sum /repo/content/media/drill/asset.png | awk '{print $1}' | tr -d '\r')
if [ "${EXPECTED_MEDIA_SHA}" != "${POST_UPGRADE_MEDIA_SHA}" ]; then
  echo "Error: Media asset SHA-256 mismatch after upgrade! Expected ${EXPECTED_MEDIA_SHA}, got ${POST_UPGRADE_MEDIA_SHA}" >&2
  exit 1
fi
echo "✓ Uploaded media file retained exact byte parity (${POST_UPGRADE_MEDIA_SHA})."

# 7. Assert Theme Asset in /repo/content/themes has exact SHA-256 match
POST_UPGRADE_THEME_SHA=$("${COMPOSE_CMD[@]}" exec -T api sha256sum /repo/content/themes/theme-drill-custom/theme.json | awk '{print $1}' | tr -d '\r')
if [ "${EXPECTED_THEME_SHA}" != "${POST_UPGRADE_THEME_SHA}" ]; then
  echo "Error: Theme asset SHA-256 mismatch after upgrade! Expected ${EXPECTED_THEME_SHA}, got ${POST_UPGRADE_THEME_SHA}" >&2
  exit 1
fi
echo "✓ Uploaded theme asset retained exact byte parity (${POST_UPGRADE_THEME_SHA})."

# 8. Assert Pre-upgrade backup archive exists and passes gzip test
LATEST_BACKUP=$(ls -t "${BACKUP_DIR}"/vibress_backup_*.sql.gz | head -n 1)
if [ ! -f "${LATEST_BACKUP}" ]; then
  echo "Error: Pre-upgrade backup archive not found in ${BACKUP_DIR}!" >&2
  exit 1
fi
gzip -t "${LATEST_BACKUP}"
echo "✓ Pre-upgrade backup archive verified (${LATEST_BACKUP})."

echo -e "\n================================================================================"
echo " LIFECYCLE DEPLOYMENT & UPGRADE DRILL CERTIFICATION: PASSED"
echo "================================================================================"
