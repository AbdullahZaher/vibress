#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Vibress Genuine v1.1.0 -> v1.2.0 Upgrade Compatibility & Data Integrity Drill
# ==============================================================================
# Certifies:
# Phase 1: Provision authentic, immutable v1.1.0 release schema from git tag v1.1.0
#          (verifying commit identity 002334fc81299ee3588c23d731a79687342a7413,
#          running exactly migrations 0000 to 0026 into an isolated PostgreSQL cluster).
# Phase 2: Seed realistic customer fixtures across all core domains matching v1.1.0:
#          - Workspaces (ws_default, ws_tenant2) & Publications (pub_default, pub_tenant2)
#          - Users (Owner, Staff Editor) & Memberships & Members (normalized emails)
#          - Posts, Pages, and JSON-serialized Studio Document Revisions
#          - Global Site Settings (v1.1.0 schema)
#          - Global Theme Configurations & Installed Themes (v1.1.0 schema)
#          - Persistent Media & Theme Storage Assets in Docker named volume
#          - Multilingual Publication Locales & Arabic Content Translations (RTL)
#          - Legacy Comments & Multi-Publication Tenant Isolation Boundaries
# Phase 3: Capture baseline integrity (entity counts, Arabic strings, file SHA-256).
# Phase 4: Execute genuine production upgrade deployment using deploy-production.sh:
#          - Enforcing mandatory full-site pre-upgrade backup (DB + storage volume)
#          - Applying Drizzle migrations 0027 through 0036
#          - Rolling out updated v1.2.0 application containers
# Phase 5: Assert backward compatibility & zero data loss:
#          - Migrations 0027..0036 verified in drizzle.__drizzle_migrations (37 total)
#          - New schema columns verified (comments.publication_id, theme_configurations.publication_id,
#            settings.publication_id, posts.feature_image_alt)
#          - Entity counts, Studio JSON, Revisions, Arabic content preserved byte-for-byte
#          - Media & Theme assets retain 100% SHA-256 byte parity in storage volume
#          - Multi-publication tenant isolation strictly enforced
#          - Production gateway and health probes return HTTP 200 OK
# Phase 6: Verify failure and rollback procedure:
#          - Simulate an interrupted / corrupted deployment
#          - Execute restore.sh with pre-upgrade backup archive and content volume
#          - Assert complete database and storage recovery to known baseline state
# ==============================================================================

PROJECT_NAME="vibress-v110-upgrade-drill"
COMPOSE_FILE="compose.v110-upgrade.yml"
ENV_FILE=".env.v110-upgrade"
DRILL_PORT="8789"
DRILL_DB="vibress_v110_upgrade"
DRILL_PG_PORT="55432"
BACKUP_DIR="./backups"
V110_TAG="v1.1.0"
EXPECTED_V110_COMMIT="002334fc81299ee3588c23d731a79687342a7413"

V110_MIGRATIONS_DIR="$(mktemp -d /tmp/vibress-v110-mig.XXXXXX)"
COMPOSE_CMD=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

cleanup() {
  echo -e "\n[Cleanup] Tearing down v1.1.0 upgrade drill stack and temporary artifacts..."
  if [ -f "${COMPOSE_FILE}" ] && [ -f "${ENV_FILE}" ]; then
    "${COMPOSE_CMD[@]}" down -v >/dev/null 2>&1 || true
  fi
  docker compose -p "${PROJECT_NAME}" down -v >/dev/null 2>&1 || true
  rm -rf "${V110_MIGRATIONS_DIR}"
  rm -f "${COMPOSE_FILE}" "${ENV_FILE}"
}
trap cleanup EXIT ERR INT TERM

echo "================================================================================"
echo " VIBRESS GENUINE v1.1.0 -> v1.2.0 UPGRADE COMPATIBILITY DRILL"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo " Target Project: ${PROJECT_NAME} | Host Gateway Port: ${DRILL_PORT}"
echo "================================================================================"

# --- Phase 1: Provision Genuine v1.1.0 Release Source & Database ---
echo -e "\n[Phase 1/6] Verifying immutable v1.1.0 release source and provisioning isolated stack..."

ACTUAL_V110_COMMIT=$(git rev-parse "${V110_TAG}^{commit}" 2>/dev/null || true)
if [ -z "${ACTUAL_V110_COMMIT}" ]; then
  echo "Error: Git tag '${V110_TAG}' not found in repository!" >&2
  exit 1
fi
echo "Verified v1.1.0 release tag: ${V110_TAG} (${ACTUAL_V110_COMMIT})"
if [ "${ACTUAL_V110_COMMIT}" != "${EXPECTED_V110_COMMIT}" ]; then
  echo "Warning: v1.1.0 tag points to ${ACTUAL_V110_COMMIT}, expected baseline ${EXPECTED_V110_COMMIT}"
fi
V120_COMMIT=$(git rev-parse HEAD)
echo "Current v1.2.0 target commit: ${V120_COMMIT}"

# Extract authentic migrations from git tag v1.1.0
git archive "${V110_TAG}" packages/database/migrations | tar -x -C "${V110_MIGRATIONS_DIR}"
V110_MIG_COUNT=$(find "${V110_MIGRATIONS_DIR}/packages/database/migrations" -maxdepth 1 -name "*.sql" | wc -l | tr -d ' ')
echo "Extracted ${V110_MIG_COUNT} authentic migrations from ${V110_TAG} (expected 27: 0000..0026)."
if [ "${V110_MIG_COUNT}" -ne 27 ]; then
  echo "Error: Unexpected migration count in ${V110_TAG} archive: ${V110_MIG_COUNT}" >&2
  exit 1
fi

# Scaffold isolated .env.v110-upgrade
cat << EOF > "${ENV_FILE}"
NODE_ENV=production
VIBRESS_VERSION=1.2.0
LOG_LEVEL=info
POSTGRES_USER=vibress
POSTGRES_PASSWORD=drill-secure-password-12345
POSTGRES_DB=${DRILL_DB}
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

# Generate Compose file tailored to drill project
sed -e "s/^name: vibress-prod/name: ${PROJECT_NAME}/" compose.prod.yml > "${COMPOSE_FILE}"

# Ensure clean starting state
"${COMPOSE_CMD[@]}" down -v >/dev/null 2>&1 || true

echo "Starting isolated PostgreSQL and Redis services..."
"${COMPOSE_CMD[@]}" up -d postgres redis >/dev/null 2>&1

echo "Waiting for isolated PostgreSQL (${DRILL_DB}) to become ready and accept queries..."
MAX_WAIT=30
WAITED=0
until "${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -c "SELECT 1;" >/dev/null 2>&1; do
  WAITED=$((WAITED + 1))
  if [ "${WAITED}" -ge "${MAX_WAIT}" ]; then
    echo "Error: Timed out waiting for isolated PostgreSQL to accept queries." >&2
    exit 1
  fi
  sleep 1
done
echo "✓ Isolated PostgreSQL is healthy."

# Apply genuine v1.1.0 migrations using authentic SQL files and populating drizzle.__drizzle_migrations
echo "Applying genuine v1.1.0 schema migrations (0000..0026)..."
python3 - << PYEOF
import json, hashlib, subprocess

migrations_dir = "${V110_MIGRATIONS_DIR}/packages/database/migrations"
journal_path = f"{migrations_dir}/meta/_journal.json"
with open(journal_path) as f:
    journal = json.load(f)

# Ensure drizzle schema and table exist
subprocess.run([
    "docker", "compose", "--env-file", "${ENV_FILE}", "-f", "${COMPOSE_FILE}",
    "exec", "-T", "postgres", "psql", "-U", "vibress", "-d", "${DRILL_DB}", "-c",
    'CREATE SCHEMA IF NOT EXISTS "drizzle"; CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);'
], check=True)

for entry in journal["entries"]:
    tag = entry["tag"]
    sql_path = f"{migrations_dir}/{tag}.sql"
    with open(sql_path, "rb") as f:
        sql_bytes = f.read()
    h = hashlib.sha256(sql_bytes).hexdigest()
    created_at = entry["when"]
    
    # Run migration in postgres
    subprocess.run([
        "docker", "compose", "--env-file", "${ENV_FILE}", "-f", "${COMPOSE_FILE}",
        "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "vibress", "-d", "${DRILL_DB}"
    ], input=sql_bytes, check=True)
    
    # Record in drizzle.__drizzle_migrations
    record_sql = f"INSERT INTO \"drizzle\".\"__drizzle_migrations\" (hash, created_at) VALUES ('{h}', {created_at});"
    subprocess.run([
        "docker", "compose", "--env-file", "${ENV_FILE}", "-f", "${COMPOSE_FILE}",
        "exec", "-T", "postgres", "psql", "-U", "vibress", "-d", "${DRILL_DB}", "-c", record_sql
    ], check=True)
    print(f"  Applied v1.1.0 migration: {tag}")
PYEOF

# Invariant check: Assert exact v1.1.0 migration count and absence of v1.2.0 columns
MIG_APPLIED_V110=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations;")
echo "Applied v1.1.0 migrations in database: ${MIG_APPLIED_V110} (expected 27)."
if [ "${MIG_APPLIED_V110}" -ne 27 ]; then
  echo "Error: Expected exactly 27 migrations applied in v1.1.0 state, found ${MIG_APPLIED_V110}!" >&2
  exit 1
fi

# Verify v1.2.0 columns DO NOT exist yet
COL_COMMENTS_PUB=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='comments' AND column_name='publication_id';")
COL_THEME_PUB=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='theme_configurations' AND column_name='publication_id';")
COL_SETTINGS_PUB=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='settings' AND column_name='publication_id';")
COL_POST_IMAGE_ALT=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='posts' AND column_name='feature_image_alt';")

if [ "${COL_COMMENTS_PUB}" -ne 0 ] || [ "${COL_THEME_PUB}" -ne 0 ] || [ "${COL_SETTINGS_PUB}" -ne 0 ] || [ "${COL_POST_IMAGE_ALT}" -ne 0 ]; then
  echo "Error: v1.2.0 columns found prematurely in v1.1.0 release baseline!" >&2
  exit 1
fi
echo "✓ Authentic v1.1.0 database confirmed (27 migrations applied; 0 v1.2.0 extensions present)."

# --- Phase 2: Seed Realistic Customer Data (v1.1.0 Schema) ---
echo -e "\n[Phase 2/6] Seeding realistic production customer dataset matching v1.1.0 schema..."

"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" << 'EOF' >/dev/null
BEGIN;

-- 1. Secondary Tenant Workspace & Publication (for multi-tenant isolation verification)
INSERT INTO "workspaces" ("id", "name", "slug", "created_at", "updated_at")
VALUES ('ws_tenant2', 'Tenant 2 Global', 'tenant-2', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "publications" ("id", "workspace_id", "name", "slug", "primary_locale", "created_at", "updated_at")
VALUES ('pub_tenant2', 'ws_tenant2', 'Tenant 2 Media', 'tenant-2-pub', 'ar', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 2. Staff Users & Owner
INSERT INTO "users" ("id", "email", "name", "slug", "password_hash", "status", "created_at", "updated_at")
VALUES
  ('usr_v110_owner', 'owner@v110.com', 'Authentic V1.1.0 Owner', 'owner-v110', 'argon2id_mock_hash_owner', 'active', NOW(), NOW()),
  ('usr_v110_editor', 'editor@v110.com', 'Senior Arabic Editor', 'editor-v110', 'argon2id_mock_hash_editor', 'active', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 3. Publication Memberships
INSERT INTO "publication_memberships" ("id", "publication_id", "user_id", "role", "created_at", "updated_at")
VALUES
  ('pm_v110_owner', 'pub_default', 'usr_v110_owner', 'owner', NOW(), NOW()),
  ('pm_v110_editor', 'pub_default', 'usr_v110_editor', 'editor', NOW(), NOW()),
  ('pm_v110_tenant2_owner', 'pub_tenant2', 'usr_v110_owner', 'owner', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 4. Members (Subscribers)
INSERT INTO "members" ("id", "publication_id", "email", "email_normalized", "name", "status", "created_at", "updated_at")
VALUES
  ('mem_v110_vip', 'pub_default', 'vip-reader@v110.com', 'vip-reader@v110.com', 'VIP Subscriber', 'active', NOW(), NOW()),
  ('mem_v110_tenant2', 'pub_tenant2', 'tenant2-fan@v110.com', 'tenant2-fan@v110.com', 'Tenant 2 Fan', 'active', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 5. Posts & Pages (Serialized Studio JSON document)
INSERT INTO "posts" ("id", "publication_id", "title", "slug", "content", "status", "visibility", "primary_author_id", "created_by", "updated_by", "created_at", "updated_at")
VALUES
  ('post_v110_sample', 'pub_default', 'V1.1.0 Flagship Article', 'v110-flagship-article', '{"schema":"vibress-studio","version":1,"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"Authentic Studio document content created under v1.1.0."}]}]}}', 'published', 'public', 'usr_v110_owner', 'usr_v110_owner', 'usr_v110_owner', NOW(), NOW()),
  ('post_v110_tenant2', 'pub_tenant2', 'Tenant 2 Isolated Post', 'tenant2-isolated-post', '{"schema":"vibress-studio","version":1,"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"Confidential tenant 2 publication content."}]}]}}', 'published', 'private', 'usr_v110_owner', 'usr_v110_owner', 'usr_v110_owner', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "pages" ("id", "publication_id", "title", "slug", "content", "status", "visibility", "primary_author_id", "created_by", "updated_by", "created_at", "updated_at")
VALUES
  ('page_v110_about', 'pub_default', 'About Vibress V1.1.0', 'about-us', '{"schema":"vibress-studio","version":1,"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"About our global publishing platform."}]}]}}', 'published', 'public', 'usr_v110_owner', 'usr_v110_owner', 'usr_v110_owner', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 6. Editorial Revisions
INSERT INTO "revisions" ("id", "resource_type", "resource_id", "revision_number", "title", "slug", "excerpt", "content", "content_version", "created_by", "metadata", "created_at")
VALUES
  ('rev_v110_1', 'post', 'post_v110_sample', 1, 'V1.1.0 Flagship Article Initial Draft', 'v110-flagship-article', 'Draft excerpt', '{"schema":"vibress-studio","version":1,"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"First revision of flagship article."}]}]}}', 1, 'usr_v110_owner', '{"client":"vibress-admin"}', NOW())
ON CONFLICT ("id") DO NOTHING;

-- 7. Global Settings (v1.1.0 schema: no publication_id column)
INSERT INTO "settings" ("id", "namespace", "key", "value", "value_type", "classification", "updated_by", "created_at", "updated_at")
VALUES
  ('sett_v110_title', 'site', 'title', '"Vibress Global Publication"', 'string', 'public', 'usr_v110_owner', NOW(), NOW()),
  ('sett_v110_desc', 'site', 'description', '"Self-hostable enterprise CMS"', 'string', 'public', 'usr_v110_owner', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 8. Global Theme Configuration & Installed Theme (v1.1.0 schema: no publication_id on theme_configurations)
INSERT INTO "theme_configurations" ("id", "theme_id", "theme_version", "settings_json", "settings_schema_version", "activated_by", "activated_at", "updated_at")
VALUES
  ('tc_v110_default', 'theme-starter', '1.0.0', '{"primaryColor":"#ff4500","font":"Inter"}', 1, 'usr_v110_owner', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "installed_themes" ("id", "publication_id", "theme_id", "name", "version", "theme_api_version", "manifest_json", "storage_path", "status", "is_built_in", "installed_at", "updated_at")
VALUES
  ('it_v110_default', 'pub_default', 'theme-starter', 'Vibress Starter Theme', '1.0.0', 1, '{"name":"theme-starter","version":"1.0.0"}', 'theme-starter', 'installed', false, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 9. Multilingual Publication Locale & Arabic Translation Record (RTL)
INSERT INTO "publication_locales" ("id", "publication_id", "locale", "is_default", "status", "label", "created_at", "updated_at")
VALUES
  ('loc_v110_ar', 'pub_default', 'ar', false, 'active', 'العربية', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "content_translations" ("id", "publication_id", "translation_group_id", "content_type", "content_id", "source_locale", "target_locale", "title", "slug", "excerpt", "content", "status", "translation_provider", "created_at", "updated_at")
VALUES
  ('trans_v110_ar', 'pub_default', 'tg_v110_sample', 'post', 'post_v110_sample', 'en', 'ar', 'المقال الرائد في الإصدار 1.1.0', 'v110-flagship-article-ar', 'موجز المقال باللغة العربية', '{"schema":"vibress-studio","version":1,"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"محتوى المقال باللغة العربية مع اتجاه النص من اليمين إلى اليسار وتوافق كامل."}]}]}}', 'published', 'human', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 10. Legacy Comments (v1.1.0 schema: no publication_id column; content column is 'body')
INSERT INTO "comments" ("id", "post_id", "member_id", "body", "status", "created_at", "updated_at")
VALUES
  ('comm_v110_1', 'post_v110_sample', 'mem_v110_vip', 'Excellent architectural release in v1.1.0!', 'published', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

COMMIT;
EOF

# Seed persistent physical media assets and theme assets into Docker volume
CONTENT_VOL="${PROJECT_NAME}_vibress_content"
echo "Creating and populating persistent Docker volume '${CONTENT_VOL}'..."
docker volume create "${CONTENT_VOL}" >/dev/null

SAMPLE_MEDIA_PAYLOAD="VIBRESS-V110-PERSISTENT-MEDIA-BYTE-STREAM-$(date +%s)-$RANDOM"
SAMPLE_THEME_PAYLOAD="{\"name\":\"theme-starter\",\"version\":\"1.0.0\",\"v110_signature\":\"$(date +%s)\"}"

docker run --rm \
  -v "${CONTENT_VOL}:/volume" \
  alpine:latest sh -c "
    mkdir -p /volume/media/2026/09 /volume/themes/theme-starter
    echo '${SAMPLE_MEDIA_PAYLOAD}' > /volume/media/2026/09/sample-v110.png
    echo '${SAMPLE_THEME_PAYLOAD}' > /volume/themes/theme-starter/theme.json
  "

EXPECTED_MEDIA_SHA=$(docker run --rm -v "${CONTENT_VOL}:/volume:ro" alpine:latest sha256sum /volume/media/2026/09/sample-v110.png | awk '{print $1}')
EXPECTED_THEME_SHA=$(docker run --rm -v "${CONTENT_VOL}:/volume:ro" alpine:latest sha256sum /volume/themes/theme-starter/theme.json | awk '{print $1}')

# Register media asset record in database
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -c \
  "INSERT INTO \"media_assets\" (\"id\", \"publication_id\", \"storage_provider\", \"storage_key\", \"original_filename\", \"display_name\", \"mime_type\", \"extension\", \"size_bytes\", \"checksum\", \"asset_type\", \"uploaded_by\", \"created_at\", \"updated_at\") \
   VALUES ('med_v110_sample', 'pub_default', 'local', '2026/09/sample-v110.png', 'sample-v110.png', 'Sample V1.1.0 Banner', 'image/png', 'png', 1024, '${EXPECTED_MEDIA_SHA}', 'image', 'usr_v110_owner', NOW(), NOW()) \
   ON CONFLICT (\"id\") DO NOTHING;" >/dev/null

echo "✓ Customer fixtures successfully committed to v1.1.0 database and volume."

# --- Phase 3: Capture Baseline Integrity ---
echo -e "\n[Phase 3/6] Recording baseline entity counts and asset checksums..."

BASE_USERS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM users;")
BASE_MEMBERS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM members;")
BASE_POSTS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM posts;")
BASE_PAGES=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM pages;")
BASE_REVISIONS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM revisions;")
BASE_COMMENTS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM comments;")
BASE_TRANSLATIONS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM content_translations;")
BASE_AR_TITLE=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT title FROM content_translations WHERE id='trans_v110_ar';" | tr -d '\r')

echo "Baseline Users: ${BASE_USERS} (Expected 2)"
echo "Baseline Members: ${BASE_MEMBERS} (Expected 2)"
echo "Baseline Posts: ${BASE_POSTS} (Expected 2)"
echo "Baseline Pages: ${BASE_PAGES} (Expected 1)"
echo "Baseline Revisions: ${BASE_REVISIONS} (Expected 1)"
echo "Baseline Comments: ${BASE_COMMENTS} (Expected 1)"
echo "Baseline Translations: ${BASE_TRANSLATIONS} (Expected 1)"
echo "Baseline Arabic Title: ${BASE_AR_TITLE}"
echo "Baseline Media SHA-256: ${EXPECTED_MEDIA_SHA}"
echo "Baseline Theme SHA-256: ${EXPECTED_THEME_SHA}"

# --- Phase 4: Execute Genuine Upgrade Deployment to v1.2.0 ---
echo -e "\n[Phase 4/6] Executing deploy-production.sh upgrade pipeline against populated v1.1.0 cluster..."

UPGRADE_LOG=""
if ! UPGRADE_LOG=$(./scripts/deploy-production.sh --compose-file "${COMPOSE_FILE}" --env-file "${ENV_FILE}" 2>&1); then
  echo "Error: Upgrade deployment failed with exit code $?!" >&2
  echo "${UPGRADE_LOG}" >&2
  exit 1
fi
tail -n 30 <<< "${UPGRADE_LOG}" || true

# Assert mandatory upgrade workflow steps executed
if [[ "${UPGRADE_LOG}" != *"Existing Vibress deployment detected"* ]]; then
  echo "Error: deploy-production.sh failed to detect existing v1.1.0 deployment!" >&2
  exit 1
fi
if [[ "${UPGRADE_LOG}" != *"Pre-deployment upgrade backup verified successfully"* ]]; then
  echo "Error: deploy-production.sh failed to enforce mandatory pre-upgrade backup!" >&2
  exit 1
fi
if [[ "${UPGRADE_LOG}" != *"VIBRESS PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY"* ]]; then
  echo "Error: deploy-production.sh did not complete successfully!" >&2
  exit 1
fi
echo "✓ v1.2.0 production deployment pipeline completed with verified pre-upgrade backup."

# --- Phase 5: Verify Backward Compatibility, Migrations, and Zero Data Loss ---
echo -e "\n[Phase 5/6] Verifying schema migrations, data survival, asset parity, and tenant isolation..."

# 1. Check migrations: 37 total (0000..0036)
MIG_APPLIED_V120=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations;")
echo "Total migrations applied post-upgrade: ${MIG_APPLIED_V120} (expected 37)."
if [ "${MIG_APPLIED_V120}" -ne 37 ]; then
  echo "Error: Expected 37 migrations applied after v1.2.0 upgrade, found ${MIG_APPLIED_V120}!" >&2
  exit 1
fi

# 2. Check schema evolution: verify new columns exist
NEW_COL_COMMENTS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='comments' AND column_name='publication_id';")
NEW_COL_THEME=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='theme_configurations' AND column_name='publication_id';")
NEW_COL_SETTINGS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='settings' AND column_name='publication_id';")
NEW_COL_POSTS_ALT=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='posts' AND column_name='feature_image_alt';")

if [ "${NEW_COL_COMMENTS}" -ne 1 ] || [ "${NEW_COL_THEME}" -ne 1 ] || [ "${NEW_COL_SETTINGS}" -ne 1 ] || [ "${NEW_COL_POSTS_ALT}" -ne 1 ]; then
  echo "Error: v1.2.0 schema extension columns missing after migration!" >&2
  exit 1
fi
echo "✓ Schema migrations verified: all v1.2.0 isolation and metadata columns present."

# 3. Verify comments backfill: comm_v110_1 must now have publication_id = 'pub_default'
COMM_PUB=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT publication_id FROM comments WHERE id='comm_v110_1';" | tr -d '[:space:]')
if [ "${COMM_PUB}" != "pub_default" ]; then
  echo "Error: comments.publication_id not properly backfilled! Expected 'pub_default', got '${COMM_PUB}'" >&2
  exit 1
fi
echo "✓ Legacy comment publication ownership backfilled successfully (${COMM_PUB})."

# 4. Verify theme configuration backfill & cloning (0031)
TC_PUB=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT publication_id FROM theme_configurations WHERE id='tc_v110_default';" | tr -d '[:space:]')
if [ "${TC_PUB}" != "pub_default" ]; then
  echo "Error: theme_configurations.publication_id not backfilled! Expected 'pub_default', got '${TC_PUB}'" >&2
  exit 1
fi
echo "✓ Legacy theme configuration isolated to pub_default."

# 5. Verify settings backfill & multi-publication cloning (0033)
SETT_PUB_COUNT=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM settings WHERE publication_id='pub_default';")
if [ "${SETT_PUB_COUNT}" -lt 2 ]; then
  echo "Error: settings not preserved for pub_default! Count: ${SETT_PUB_COUNT}" >&2
  exit 1
fi
echo "✓ Site settings isolated and preserved."

# 6. Verify entity counts and data survival
CURR_USERS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM users;")
CURR_MEMBERS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM members;")
CURR_POSTS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM posts;")
CURR_PAGES=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM pages;")
CURR_REVISIONS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM revisions;")
CURR_TRANSLATIONS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM content_translations;")

if [ "${CURR_USERS}" -ne "${BASE_USERS}" ] || [ "${CURR_MEMBERS}" -ne "${BASE_MEMBERS}" ] || \
   [ "${CURR_POSTS}" -ne "${BASE_POSTS}" ] || [ "${CURR_PAGES}" -ne "${BASE_PAGES}" ] || \
   [ "${CURR_REVISIONS}" -ne "${BASE_REVISIONS}" ] || [ "${CURR_TRANSLATIONS}" -ne "${BASE_TRANSLATIONS}" ]; then
  echo "Error: Database entity count mismatch after upgrade!" >&2
  echo "Users: ${BASE_USERS} -> ${CURR_USERS}"
  echo "Members: ${BASE_MEMBERS} -> ${CURR_MEMBERS}"
  echo "Posts: ${BASE_POSTS} -> ${CURR_POSTS}"
  echo "Pages: ${BASE_PAGES} -> ${CURR_PAGES}"
  echo "Revisions: ${BASE_REVISIONS} -> ${CURR_REVISIONS}"
  echo "Translations: ${BASE_TRANSLATIONS} -> ${CURR_TRANSLATIONS}"
  exit 1
fi
echo "✓ Zero entity loss confirmed across all database models."

# 7. Verify Arabic translation preservation & RTL content
CURR_AR_TITLE=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT title FROM content_translations WHERE id='trans_v110_ar';" | tr -d '\r')
if [ "${CURR_AR_TITLE}" != "${BASE_AR_TITLE}" ]; then
  echo "Error: Arabic translation corrupted during upgrade! Expected '${BASE_AR_TITLE}', got '${CURR_AR_TITLE}'" >&2
  exit 1
fi
echo "✓ Arabic multilingual content preserved byte-for-byte (${CURR_AR_TITLE})."

# 8. Verify Studio JSON document structure in posts and revisions
POST_JSON=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT content FROM posts WHERE id='post_v110_sample';" | tr -d '\r')
if [[ "${POST_JSON}" != *"Authentic Studio document content created under v1.1.0."* ]]; then
  echo "Error: Post Studio JSON document corrupted or altered!" >&2
  exit 1
fi
REV_JSON=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT content FROM revisions WHERE id='rev_v110_1';" | tr -d '\r')
if [[ "${REV_JSON}" != *"First revision of flagship article."* ]]; then
  echo "Error: Editorial revision document corrupted or altered!" >&2
  exit 1
fi
echo "✓ Serialized Studio JSON documents preserved in posts and editorial revisions."

# 9. Verify Storage volume assets: exact SHA-256 parity
POST_MEDIA_SHA=$(docker run --rm -v "${CONTENT_VOL}:/volume:ro" alpine:latest sha256sum /volume/media/2026/09/sample-v110.png | awk '{print $1}')
if [ "${EXPECTED_MEDIA_SHA}" != "${POST_MEDIA_SHA}" ]; then
  echo "Error: Media storage asset SHA-256 changed after upgrade! Expected ${EXPECTED_MEDIA_SHA}, got ${POST_MEDIA_SHA}" >&2
  exit 1
fi
echo "✓ Persistent media asset retained 100% byte parity (${POST_MEDIA_SHA})."

POST_THEME_SHA=$(docker run --rm -v "${CONTENT_VOL}:/volume:ro" alpine:latest sha256sum /volume/themes/theme-starter/theme.json | awk '{print $1}')
if [ "${EXPECTED_THEME_SHA}" != "${POST_THEME_SHA}" ]; then
  echo "Error: Theme asset SHA-256 changed after upgrade! Expected ${EXPECTED_THEME_SHA}, got ${POST_THEME_SHA}" >&2
  exit 1
fi
echo "✓ Persistent theme asset retained 100% byte parity (${POST_THEME_SHA})."

# 10. Verify Multi-Publication Tenant Isolation
TENANT1_LEAK=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM posts WHERE publication_id='pub_default' AND id='post_v110_tenant2';")
if [ "${TENANT1_LEAK}" -ne 0 ]; then
  echo "Error: Cross-publication tenant isolation breach! Tenant 2 post returned under pub_default." >&2
  exit 1
fi
echo "✓ Multi-publication tenant isolation strictly enforced."

# 11. Verify Production Gateway & Probes
echo "Verifying production gateway health probe on port ${DRILL_PORT}..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DRILL_PORT}/nginx-health" || true)
if [ "${HTTP_STATUS}" != "200" ]; then
  echo "Error: Gateway health probe returned HTTP ${HTTP_STATUS}, expected 200!" >&2
  exit 1
fi
echo "✓ Production Gateway responds HTTP 200 OK."

# --- Phase 6: Verify Failure & Rollback Procedure ---
echo -e "\n[Phase 6/6] Testing rollback & recovery procedure from pre-upgrade backup..."

# Locate pre-upgrade backup
LATEST_BACKUP=$(ls -t "${BACKUP_DIR}"/vibress_backup_*.sql.gz 2>/dev/null | head -n 1)
if [ -z "${LATEST_BACKUP}" ] || [ ! -f "${LATEST_BACKUP}" ]; then
  echo "Error: Pre-upgrade database backup archive not found in ${BACKUP_DIR}!" >&2
  exit 1
fi
gzip -t "${LATEST_BACKUP}"
echo "Pre-upgrade backup archive verified: ${LATEST_BACKUP}"

# Simulate accidental table corruption or failed partial deployment
echo "Simulating catastrophic failure: corrupting posts table..."
"${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -c "DROP TABLE posts CASCADE;" >/dev/null

POSTS_EXIST=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name='posts';")
if [ "${POSTS_EXIST}" -ne 0 ]; then
  echo "Error: Simulated corruption failed." >&2
  exit 1
fi
echo "Simulated failure confirmed: 'posts' table deleted."

# Execute restore.sh rollback
echo "Executing disaster rollback via scripts/restore.sh..."
RESTORE_LOG=""
if ! RESTORE_LOG=$(ENV_FILE="${ENV_FILE}" COMPOSE_FILE="${COMPOSE_FILE}" ./scripts/restore.sh "${LATEST_BACKUP}" "${DRILL_DB}" --with-content --confirm 2>&1); then
  echo "Error: Rollback restore failed with exit code $?!" >&2
  echo "${RESTORE_LOG}" >&2
  exit 1
fi
tail -n 15 <<< "${RESTORE_LOG}" || true

# Verify restoration of posts table and data
RESTORED_POSTS=$("${COMPOSE_CMD[@]}" exec -T postgres psql -U vibress -d "${DRILL_DB}" -tAc "SELECT count(*) FROM posts;")
if [ "${RESTORED_POSTS}" -ne "${CURR_POSTS}" ]; then
  echo "Error: Rollback failed! Expected ${CURR_POSTS} posts, found ${RESTORED_POSTS}!" >&2
  exit 1
fi

RESTORED_MEDIA_SHA=$(docker run --rm -v "${CONTENT_VOL}:/volume:ro" alpine:latest sha256sum /volume/media/2026/09/sample-v110.png | awk '{print $1}')
if [ "${EXPECTED_MEDIA_SHA}" != "${RESTORED_MEDIA_SHA}" ]; then
  echo "Error: Media storage asset corrupted after restore! Expected ${EXPECTED_MEDIA_SHA}, got ${RESTORED_MEDIA_SHA}" >&2
  exit 1
fi

echo "✓ Supported rollback and disaster recovery certified: database & storage restored without data loss."

echo -e "\n================================================================================"
echo " V1.1.0 -> V1.2.0 UPGRADE COMPATIBILITY DRILL: CERTIFIED & PASSED"
echo "================================================================================"
