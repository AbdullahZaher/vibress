import { getDb, closeDbPool, searchDocuments, publications, settings } from "../src";
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
  console.log("Indexes found:", indexRes.rows.map((r: any) => r.indexname));
  const indexNames = indexRes.rows.map((r: any) => r.indexname);
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

  // Cleanup test documents
  await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, testPubId));
  await db.delete(publications).where(eq(publications.id, testPubId));

  // ----------------------------------------------------
  // 5. Concurrent Writes Verification Test
  // ----------------------------------------------------
  console.log("\n5. Verifying concurrent writes and reads during migration execution...");
  const concurrentPubId = "pub_mig_concurrent_" + Date.now();
  await db.insert(publications).values({
    id: concurrentPubId,
    workspaceId: "ws_default",
    name: "Concurrent Test Publication",
    slug: "concurrent-" + Date.now(),
    primaryLocale: "ar",
  });

  // Execute migration in parallel with concurrent inserts/selects
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
  console.log(`Concurrent writes verified: ${concurrentWritesCompleted} writes succeeded during migration execution.`);

  // Cleanup concurrent test documents
  await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, concurrentPubId));
  await db.delete(publications).where(eq(publications.id, concurrentPubId));

  // ----------------------------------------------------
  // 6. Idempotency Test: re-running SQL does not fail
  // ----------------------------------------------------
  console.log("\n6. Verifying idempotency of migration SQL...");
  await db.execute(sql.raw(migrationSql));
  console.log("Idempotency verified: re-running SQL succeeded without error.");

  console.log("\n=== MIGRATION 0038 VERIFICATION PASSED SUCCESSFULLY ===");
}

verifyMigration0038()
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDbPool();
  });
