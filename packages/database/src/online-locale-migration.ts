import type { PoolClient } from "pg";
import { getDbPool } from "./connection";

/**
 * Online preparation for migration 0038 on populated installations.
 * Runs OUTSIDE Drizzle's migration transaction so CREATE INDEX CONCURRENTLY
 * is possible. Only NULL (pre-upgrade) locale values may be backfilled.
 * Fresh installations are handled by the ordinary migration.
 */
export async function prepareOnlineSearchLocaleMigration(): Promise<void> {
  const client = await getDbPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(380038)");
    const initial = await client.query<{ legacy_index: string | null }>(
      "SELECT to_regclass('search_documents_pub_entity_idx')::text AS legacy_index",
    );
    if (!initial.rows[0]?.legacy_index) return;

    const columns = await client.query<{ present: number }>(
      "SELECT count(*)::integer AS present FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND " +
      "((table_name = 'settings' AND column_name = 'publication_id') OR " +
      "(table_name = 'publications' AND column_name = 'primary_locale'))",
    );
    // Older schemas must first apply their historical migrations. Do not
    // access publication settings before the required columns exist.
    if (columns.rows[0]?.present !== 2) return;

    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '60s'");
    await client.query("BEGIN");
    try {
      // Old rows get NULL, new inserts get the default after this commits.
      // A retry can distinguish old rows from legitimate English rows.
      await client.query('ALTER TABLE "search_documents" ADD COLUMN IF NOT EXISTS "locale" text');
      await client.query("ALTER TABLE \"search_documents\" ALTER COLUMN \"locale\" SET DEFAULT 'en'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    // Short independent row-lock batches avoid a long rewrite transaction.
    let changed: number;
    do {
      const batch = await client.query<{ id: string }>(
        "WITH batch AS (" +
        " SELECT id FROM search_documents WHERE locale IS NULL" +
        " ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED" +
        ") UPDATE search_documents AS sd SET locale = COALESCE((" +
        " SELECT CASE WHEN trim(p.primary_locale) = 'en' THEN COALESCE((" +
        "  SELECT CASE WHEN (s.value #>> '{}') ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$'" +
        "   THEN (s.value #>> '{}') ELSE NULL END FROM settings AS s" +
        "  WHERE s.publication_id = p.id AND s.namespace = 'site' AND s.key = 'locale'" +
        "  LIMIT 1), 'en') ELSE NULLIF(trim(p.primary_locale), '') END" +
        " FROM publications AS p WHERE p.id = sd.publication_id), 'en')" +
        " FROM batch WHERE sd.id = batch.id RETURNING sd.id",
      );
      changed = batch.rowCount ?? 0;
    } while (changed > 0);

    // PostgreSQL 12+ proves SET NOT NULL from a validated CHECK, avoiding a
    // long exclusive-lock table scan.
    const check = await client.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE " +
      "conrelid = 'search_documents'::regclass AND " +
      "conname = 'search_documents_locale_nn_check') AS present",
    );
    if (!check.rows[0]?.present) {
      await client.query(
        'ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_locale_nn_check" CHECK ("locale" IS NOT NULL) NOT VALID',
      );
    }
    await client.query(
      'ALTER TABLE "search_documents" VALIDATE CONSTRAINT "search_documents_locale_nn_check"',
    );
    await client.query('ALTER TABLE "search_documents" ALTER COLUMN "locale" SET NOT NULL');
    await client.query(
      'ALTER TABLE "search_documents" DROP CONSTRAINT IF EXISTS "search_documents_locale_nn_check"',
    );

    await ensureValidIndex(client, "search_documents_pub_entity_locale_idx",
      'CREATE UNIQUE INDEX CONCURRENTLY "search_documents_pub_entity_locale_idx" ON "search_documents" ("publication_id", "entity_type", "entity_id", "locale")');
    await ensureValidIndex(client, "search_documents_pub_locale_searchable_idx",
      'CREATE INDEX CONCURRENTLY "search_documents_pub_locale_searchable_idx" ON "search_documents" ("publication_id", "locale", "searchable")');

    // The legacy index is intentionally kept until 0038 commits successfully.
  } finally {
    await client.query("SELECT pg_advisory_unlock(380038)").catch(() => undefined);
    client.release();
  }
}

async function ensureValidIndex(
  client: PoolClient,
  name: string,
  creation: string,
): Promise<void> {
  const result = await client.query<{ valid: boolean }>(
    "SELECT i.indisvalid AS valid FROM pg_class c " +
    "JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = $1 " +
    "AND c.relnamespace = (SELECT relnamespace FROM pg_class " +
    "WHERE oid = 'search_documents'::regclass)",
    [name],
  );
  if (result.rows[0]?.valid) return;
  if (result.rows.length > 0) {
    // Concurrent index builds can leave an invalid index after interruption.
    await client.query('DROP INDEX CONCURRENTLY IF EXISTS "' + name + '"');
  }
  await client.query("SET statement_timeout = '0'");
  try {
    await client.query(creation);
  } finally {
    await client.query("SET statement_timeout = '60s'");
  }
}
