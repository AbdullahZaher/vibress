import { getDb, getDbPool, closeDbPool, searchDocuments, publications } from "../src";
import { prepareOnlineSearchLocaleMigration } from "../src/online-locale-migration";
import { sql, eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

async function verifyMigration0038() {
  console.log("=== VERIFYING MIGRATION 0038 (SEARCH DOCUMENTS LOCALE) ===");
  const db = getDb();

  // ----------------------------------------------------
  // 1. Run migration SQL idempotently
  // ----------------------------------------------------
  console.log("\n1. Executing migration 0038 SQL...");
  const migrationPath = path.resolve(__dirname, "../migrations/0038_search_documents_locale.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  await db.execute(sql.raw(migrationSql));
  console.log("Migration SQL executed successfully.");

  // ----------------------------------------------------
  // 2. Schema Verification: column exists
  // ----------------------------------------------------
  console.log("\n2. Schema Verification: 'locale' column on 'search_documents'...");
  const columnsRes = await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'search_documents' AND column_name = 'locale';
  `);
  console.log("Columns result:", columnsRes.rows);
  if (columnsRes.rows.length !== 1) {
    throw new Error(`Expected 'locale' column on 'search_documents', found ${columnsRes.rows.length}`);
  }

  // ----------------------------------------------------
  // 3. Index Verification: new composite unique index and searchable index
  // ----------------------------------------------------
  console.log("\n3. Index Verification...");
  const indexRes = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'search_documents' AND indexname IN (
      'search_documents_pub_entity_locale_idx',
      'search_documents_pub_locale_searchable_idx',
      'search_documents_pub_entity_idx'
    );
  `);
  console.log("Indexes found:", indexRes.rows.map((r) => String(r.indexname)));
  const indexNames = indexRes.rows.map((r) => String(r.indexname));
  if (!indexNames.includes("search_documents_pub_entity_locale_idx")) {
    throw new Error("Missing unique index: search_documents_pub_entity_locale_idx");
  }
  if (!indexNames.includes("search_documents_pub_locale_searchable_idx")) {
    throw new Error("Missing index: search_documents_pub_locale_searchable_idx");
  }
  if (indexNames.includes("search_documents_pub_entity_idx")) {
    throw new Error("Old index 'search_documents_pub_entity_idx' should have been dropped!");
  }

  // ----------------------------------------------------
  // 4. Data Compatibility & Multi-Locale Uniqueness Test
  // ----------------------------------------------------
  console.log("\n4. Multi-Locale Uniqueness Test...");
  const testPubId = "pub_mig0038_" + Date.now();
  const testEntityId = "post_mig0038_" + Date.now();

  // Create temporary publication row
  await db.insert(publications).values({
    id: testPubId,
    workspaceId: "ws_default",
    name: "Migration 0038 Test Publication",
    slug: "mig0038-" + Date.now(),
    primaryLocale: "ar",
  });

  // Insert English search document
  await db.insert(searchDocuments).values({
    id: crypto.randomUUID(),
    publicationId: testPubId,
    entityType: "post",
    entityId: testEntityId,
    locale: "en",
    title: "English Title",
    bodyText: "English body content",
    slug: "test-entity-en",
    url: "/posts/test-entity-en",
    searchable: true,
  });

  // Insert Arabic search document for the SAME entity (composite uniqueness must allow this!)
  await db.insert(searchDocuments).values({
    id: crypto.randomUUID(),
    publicationId: testPubId,
    entityType: "post",
    entityId: testEntityId,
    locale: "ar",
    title: "عنوان عربي",
    bodyText: "محتوى عربي للاختبار",
    slug: "test-entity-ar",
    url: "/ar/posts/test-entity-ar",
    searchable: true,
  });

  // Verify both exist independently
  const docRows = await db
    .select()
    .from(searchDocuments)
    .where(eq(searchDocuments.entityId, testEntityId));
  if (docRows.length !== 2) {
    throw new Error(`Expected 2 localized search documents for entity, found ${docRows.length}`);
  }
  console.log(`Successfully verified 2 localized search documents for entity ${testEntityId}`);

  // Re-execution must preserve a genuine English translation on an Arabic
  // publication and never collapse multiple locale variants into one.
  await db.execute(sql.raw(migrationSql));
  const replayRows = await db.select().from(searchDocuments)
    .where(eq(searchDocuments.entityId, testEntityId));
  if (
    replayRows.length !== 2 ||
    !replayRows.some((row) => row.locale === "en" && row.title === "English Title") ||
    !replayRows.some((row) => row.locale === "ar" && row.title === "عنوان عربي")
  ) {
    throw new Error("Migration 0038 replay modified existing localized documents");
  }

  // Cleanup test documents
  await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, testPubId));
  await db.delete(publications).where(eq(publications.id, testPubId));

  // ----------------------------------------------------
  // 5. Live writes during idempotent re-execution (not initial index build)
  // ----------------------------------------------------
  console.log("\n5. Verifying writes during replay of an installed migration...");
  const concurrentPubId = "pub_mig_concurrent_" + Date.now();
  await db.insert(publications).values({
    id: concurrentPubId,
    workspaceId: "ws_default",
    name: "Concurrent Test Publication",
    slug: "concurrent-" + Date.now(),
    primaryLocale: "ar",
  });

  // This exercises replay safety, not first-time index creation. The first
  // index build runs online in prepareOnlineSearchLocaleMigration().
  let concurrentWritesCompleted = 0;
  const writePromise = (async () => {
    for (let i = 0; i < 20; i++) {
      await db.insert(searchDocuments).values({
        id: crypto.randomUUID(),
        publicationId: concurrentPubId,
        entityType: "post",
        entityId: `post_concurrent_${i}`,
        locale: "ar",
        title: `Concurrent Title ${i}`,
        bodyText: `Concurrent Body Text ${i}`,
        slug: `concurrent-${i}`,
        url: `/posts/concurrent-${i}`,
        searchable: true,
      });
      concurrentWritesCompleted++;
      await new Promise((r) => setTimeout(r, 10));
    }
  })();

  const migrationPromise = db.execute(sql.raw(migrationSql));

  await Promise.all([writePromise, migrationPromise]);
  console.log(`Writes during migration replay verified: ${concurrentWritesCompleted} writes succeeded during migration execution.`);

  // Cleanup concurrent test documents
  await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, concurrentPubId));
  await db.delete(publications).where(eq(publications.id, concurrentPubId));

  // ----------------------------------------------------
  // 6. Idempotency Test: re-running SQL does not fail
  // ----------------------------------------------------
  console.log("\n6. Verifying idempotency of migration SQL...");
  await db.execute(sql.raw(migrationSql));
  console.log("Idempotency verified: re-running SQL succeeded without error.");

  await verifyOnlineFirstUpgrade(migrationSql);

  console.log("\n=== MIGRATION 0038 VERIFICATION PASSED SUCCESSFULLY ===");
}


/**
 * Model the FIRST upgrade in an isolated schema, not a replay against an
 * already migrated public database. This validates old NULL-row backfill,
 * legacy Arabic settings, index creation, concurrent writes, and replay.
 */
async function verifyOnlineFirstUpgrade(migrationSql: string): Promise<void> {
  const schemaName = "vibress_m0038_" + Date.now();
  const client = await getDbPool().connect();
  const writer = await getDbPool().connect();
  try {
    await client.query('CREATE SCHEMA "' + schemaName + '"');
    await client.query('SET search_path TO "' + schemaName + '", public');
    await writer.query('SET search_path TO "' + schemaName + '", public');
    await client.query(
      "CREATE TABLE publications (id text PRIMARY KEY, primary_locale text NOT NULL)",
    );
    await client.query(
      "CREATE TABLE settings (publication_id text, namespace text, key text, value jsonb)",
    );
    await client.query(
      "CREATE TABLE search_documents (" +
      " id text PRIMARY KEY, publication_id text NOT NULL," +
      " entity_type text NOT NULL, entity_id text NOT NULL," +
      " searchable boolean NOT NULL DEFAULT true)",
    );
    await client.query(
      'CREATE UNIQUE INDEX "search_documents_pub_entity_idx" ON "search_documents" (publication_id, entity_type, entity_id)',
    );
    await client.query(
      "INSERT INTO publications (id, primary_locale) VALUES" +
      " ('arabic', 'ar'), ('legacy', 'en'), ('english', 'en')",
    );
    await client.query(
      "INSERT INTO settings (publication_id, namespace, key, value)" +
      " VALUES ('legacy', 'site', 'locale', '\"ar\"'::jsonb)",
    );
    await client.query(
      "INSERT INTO search_documents(id, publication_id, entity_type, entity_id)" +
      " VALUES ('old_ar','arabic','post','ar')," +
      " ('old_legacy','legacy','post','legacy')," +
      " ('old_en','english','post','en')",
    );

    // A separate connection writes during the FIRST concurrent index build.
    // Its inserts work whether they precede or follow the default being set.
    const writes = (async () => {
      for (let i = 0; i < 20; i++) {
        await writer.query(
          "INSERT INTO search_documents(id, publication_id, entity_type, entity_id)" +
          " VALUES ($1, 'english', 'post', $2)",
          ["live_" + i, "live_" + i],
        );
      }
    })();
    await Promise.all([prepareOnlineSearchLocaleMigration(client), writes]);

    const checked = await client.query<{ id: string; locale: string }>(
      "SELECT id, locale FROM search_documents" +
      " WHERE id IN ('old_ar','old_legacy','old_en') ORDER BY id",
    );
    const locales = new Map(checked.rows.map((row) => [row.id, row.locale]));
    if (locales.get("old_ar") !== "ar" ||
        locales.get("old_legacy") !== "ar" ||
        locales.get("old_en") !== "en") {
      throw new Error("First-run locale backfill failed: " + JSON.stringify(checked.rows));
    }
    const noNulls = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM search_documents WHERE locale IS NULL",
    );
    if (noNulls.rows[0]?.count !== 0) {
      throw new Error("First-run migration left NULL locales");
    }

    // Complete the journaled SQL step, then prove that a true English
    // translation survives re-running it on an Arabic publication.
    await client.query(migrationSql);
    await client.query(
      "INSERT INTO search_documents(id, publication_id, entity_type, entity_id, locale)" +
      " VALUES ('bi_ar','arabic','post','bilingual','ar')," +
      " ('bi_en','arabic','post','bilingual','en')",
    );
    await client.query(migrationSql);
    const bilingual = await client.query<{ locale: string }>(
      "SELECT locale FROM search_documents WHERE entity_id = 'bilingual'",
    );
    if (bilingual.rows.length !== 2 ||
        new Set(bilingual.rows.map((row) => row.locale)).size !== 2) {
      throw new Error("Replay changed English/Arabic locale identities");
    }
    console.log("First-run upgrade, 20 concurrent writes, and bilingual replay verified.");
  } finally {
    await writer.query("RESET search_path").catch(() => undefined);
    await client.query("RESET search_path").catch(() => undefined);
    await client.query('DROP SCHEMA IF EXISTS "' + schemaName + '" CASCADE')
      .catch(() => undefined);
    writer.release();
    client.release();
  }
}

verifyMigration0038()
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDbPool();
  });
