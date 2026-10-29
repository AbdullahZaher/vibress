#!/usr/bin/env bash
# Real historical 0042 -> current core-schema upgrade on an isolated CI-only DB.
# Never targets a production database; never runs old or external plugin code.
set -Eeuo pipefail

fail() {
  printf '%s\n' 'PLUGIN_HISTORICAL_UPGRADE_FAILED: isolated schema/data acceptance did not pass' >&2
  exit 1
}
if [[ ${GITHUB_ACTIONS:-} != "true" ||
      ${CI:-} != "true" ||
      ${VIBRESS_M1A_DISPOSABLE_DRILL:-} != "1" ||
      ! ${GITHUB_RUN_ID:-} =~ ^[0-9]{1,20}$ ]]; then
  fail
fi

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$repo"
# Exact historical commit from 2026-10-20: core migrations end at 0042.
historical_sha="3f39f29bd34625545ab8a1699415b8c98ee557c7"
[[ "$(git rev-parse --verify "${historical_sha}^{commit}" 2>/dev/null)" == "$historical_sha" ]] || fail

project="vibress-m1a-${GITHUB_RUN_ID}"
compose=(docker compose -p "$project" -f compose.dev.yml)
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
legacy="$tmp/legacy"
mkdir -p "$legacy"
git archive "$historical_sha" packages/database/migrations | tar -x -C "$legacy" || fail
folder="$legacy/packages/database/migrations"
[[ -f "$folder/0042_plugin_migration_storage_foundation.sql" &&
   ! -e "$folder/0043_plugin_storage_physical_models.sql" &&
   ! -e "$folder/0048_plugin_upgrade_preflight_approval.sql" ]] || fail

database="vibress_m1a_historical"
"${compose[@]}" exec -T postgres createdb -U vibress "$database" || fail
# The historical SQL and Drizzle journal are from the pinned, immutable Git
# commit; the migration *runner* comes from the candidate checkout.
DATABASE_URL="postgresql://vibress:vibress@127.0.0.1:5433/$database" \
  MIGRATIONS_FOLDER="$folder" \
  pnpm --filter @vibress/database db:migrate >"$tmp/old-migrate.log" 2>&1 || fail

psql() {
  "${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -q \
    -U vibress -d "$database" "$@"
}

# Fixture is a populated, two-publication historical installation. Preserve
# both globally scoped legacy settings and publication-specific settings.
psql <<'SQL' >"$tmp/seed.log" 2>&1 || fail
INSERT INTO workspaces (id, name, slug)
VALUES ('historical-ws', 'Historical workspace', 'historical-ws');
INSERT INTO publications (id, workspace_id, name, slug, primary_locale)
VALUES
  ('historical-ar', 'historical-ws', 'موقع عربي', 'historical-ar', 'ar'),
  ('historical-en', 'historical-ws', 'English site', 'historical-en', 'en');
INSERT INTO plugins (id, manifest_id, name, version, vibress_api_version, entrypoint, status)
VALUES ('historical-plugin', 'historical-lms', 'Historical LMS', '1.0.0', '1', 'index.mjs', 'registered');
INSERT INTO plugin_settings (id, plugin_id, key, encrypted_value, is_secret)
VALUES ('historical-global-secret', 'historical-plugin', 'legacy_api_key', 'opaque-legacy-ciphertext', true);
INSERT INTO plugin_publication_states (plugin_id, publication_id, enabled)
VALUES ('historical-plugin', 'historical-ar', false), ('historical-plugin', 'historical-en', false);
INSERT INTO plugin_publication_settings (id, plugin_id, publication_id, key, value, is_secret)
VALUES
  ('historical-ar-title', 'historical-plugin', 'historical-ar', 'title', 'دورة عربية', false),
  ('historical-en-title', 'historical-plugin', 'historical-en', 'title', 'English course', false);
INSERT INTO plugin_schema_migrations
  (plugin_id, migration_id, package_version, artifact_sha256, migration_sha256)
VALUES ('historical-plugin', '0001_initial', '1.0.0', repeat('a',64), repeat('b',64));
INSERT INTO plugin_storage_models
  (plugin_id, model_key, migration_id, schema_sha256)
VALUES ('historical-plugin', 'courses', '0001_initial', repeat('c',64));
SQL

# Deterministic, complete record snapshot from pre-upgrade data, including
# stored ciphertext (never print its bytes to CI logs).
read_snapshot() {
  psql -At -c "
    SELECT jsonb_build_object(
      'plugins',(SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM plugins WHERE id='historical-plugin') t),
      'settings',(SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM plugin_settings WHERE plugin_id='historical-plugin') t),
      'states',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.publication_id) FROM (SELECT * FROM plugin_publication_states WHERE plugin_id='historical-plugin') t),
      'scoped',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.publication_id) FROM (SELECT * FROM plugin_publication_settings WHERE plugin_id='historical-plugin') t),
      'ledger',(SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM plugin_schema_migrations WHERE plugin_id='historical-plugin') t),
      'models',(SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM plugin_storage_models WHERE plugin_id='historical-plugin') t),
      'publications',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM (SELECT * FROM publications WHERE id IN ('historical-ar','historical-en')) t)
    )::text;
  "
}
read_snapshot >"$tmp/before.json" || fail
[[ -s "$tmp/before.json" ]] || fail
[[ "$(psql -At -c "SELECT count(*) FROM plugin_schema_migrations WHERE plugin_id='historical-plugin'")" == "1" ]] || fail

# Apply the REAL candidate forward migrations (0043-0048) to the same DB.
DATABASE_URL="postgresql://vibress:vibress@127.0.0.1:5433/$database" \
  pnpm --filter @vibress/database db:migrate >"$tmp/current-migrate.log" 2>&1 || fail

read_snapshot >"$tmp/after.json" || fail
cmp -s "$tmp/before.json" "$tmp/after.json" || fail

# New catalogs are additive, default empty. They cannot rewrite existing
# plugin migration metadata or mutate publication enablement behind the scenes.
[[ "$(psql -At -c "SELECT count(*) FROM plugin_storage_physical_models")" == "0" ]] || fail
[[ "$(psql -At -c "SELECT count(*) FROM plugin_upgrade_plans")" == "0" ]] || fail
[[ "$(psql -At -c "SELECT count(*) FROM plugin_event_receipts")" == "0" ]] || fail

# Replay must be idempotent and not mutate historical rows.
DATABASE_URL="postgresql://vibress:vibress@127.0.0.1:5433/$database" \
  pnpm --filter @vibress/database db:migrate >"$tmp/replayed-migrate.log" 2>&1 || fail
read_snapshot >"$tmp/replayed.json" || fail
cmp -s "$tmp/before.json" "$tmp/replayed.json" || fail

# Immutable plugin-owned schema history stays DB-enforced after an upgrade.
if psql -c "UPDATE plugin_schema_migrations SET migration_sha256=repeat('d',64) WHERE plugin_id='historical-plugin'" >"$tmp/mutation.log" 2>&1; then
  fail
fi
grep -q 'Plugin migration metadata is append-only' "$tmp/mutation.log" || fail
[[ "$(psql -At -c "SELECT count(*) FROM plugin_schema_migrations WHERE plugin_id='historical-plugin'")" == "1" ]] || fail

printf '%s\n' 'PLUGIN_HISTORICAL_UPGRADE_PASSED: pinned 0042 database, populated bilingual/scoped plugin data, 0043-0048 upgrade/replay, immutable ledger'
