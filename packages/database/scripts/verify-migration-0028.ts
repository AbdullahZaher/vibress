import { getDb, closeDbPool, posts, mediaAssets, publications, users } from "../src";
import { sql, eq } from "drizzle-orm";
import crypto from "node:crypto";

async function verifyMigration0028() {
  console.log("=== VERIFYING MIGRATION 0028 (POST FEATURE IMAGE) ===");
  const db = getDb();

  // ----------------------------------------------------
  // 1. Schema Verification
  // ----------------------------------------------------
  console.log("\n1. Schema Verification...");
  const columnsRes = await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name IN ('feature_image_id', 'feature_image_alt', 'feature_image_caption');
  `);
  console.log("Columns in 'posts':", columnsRes.rows);
  if (columnsRes.rows.length !== 3) {
    throw new Error(`Expected 3 columns, found ${columnsRes.rows.length}`);
  }

  const fkRes = await db.execute(sql`
    SELECT conname, contype, confupdtype, confdeltype
    FROM pg_constraint
    WHERE conname = 'posts_feature_image_publication_fk';
  `);
  console.log("Foreign Key constraint:", fkRes.rows);
  if (fkRes.rows.length === 0) {
    throw new Error("Constraint posts_feature_image_publication_fk not found!");
  }

  // ----------------------------------------------------
  // 2. Feature Image CRUD
  // ----------------------------------------------------
  console.log("\n2. Feature Image CRUD Verification...");
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const authorId = user?.id || crypto.randomUUID();
  const testAssetId = crypto.randomUUID();
  const testPostId = crypto.randomUUID();
  const pubId = "pub_default";

  await db.insert(mediaAssets).values({
    id: testAssetId,
    publicationId: pubId,
    storageKey: `media/crud-test-${Date.now()}.jpg`,
    originalFilename: "crud-test.jpg",
    displayName: "CRUD Test Asset",
    mimeType: "image/jpeg",
    extension: "jpg",
    sizeBytes: 500,
    checksum: "crudchecksum",
    assetType: "image",
  });

  // Create Post with feature image
  await db.insert(posts).values({
    id: testPostId,
    publicationId: pubId,
    title: "CRUD Test Post",
    slug: `crud-test-${Date.now()}`,
    content: { root: { children: [] } },
    primaryAuthorId: authorId,
    createdBy: authorId,
    updatedBy: authorId,
    featureImageId: testAssetId,
    featureImageAlt: "Initial Alt",
    featureImageCaption: "Initial Caption",
  });

  const [created] = await db.select().from(posts).where(eq(posts.id, testPostId));
  if (created?.featureImageId !== testAssetId || created?.featureImageAlt !== "Initial Alt") {
    throw new Error("CRUD Create verification failed!");
  }
  console.log("CRUD Create: PASS");

  // Update alt and caption
  await db
    .update(posts)
    .set({ featureImageAlt: "Updated Alt", featureImageCaption: "Updated Caption" })
    .where(eq(posts.id, testPostId));

  const [updated] = await db.select().from(posts).where(eq(posts.id, testPostId));
  if (updated?.featureImageAlt !== "Updated Alt") {
    throw new Error("CRUD Update verification failed!");
  }
  console.log("CRUD Update: PASS");

  // ----------------------------------------------------
  // 3. Media Deletion Behavior (ON DELETE SET NULL)
  // ----------------------------------------------------
  console.log("\n3. Media Deletion Behavior Verification...");
  await db.delete(mediaAssets).where(eq(mediaAssets.id, testAssetId));
  const [postAfterMediaDelete] = await db.select().from(posts).where(eq(posts.id, testPostId));
  console.log("Post state after media deletion:", {
    featureImageId: postAfterMediaDelete?.featureImageId,
    publicationId: postAfterMediaDelete?.publicationId,
  });

  if (postAfterMediaDelete?.featureImageId !== null) {
    throw new Error("Media deletion failed: featureImageId was not NULLed!");
  }
  if (postAfterMediaDelete?.publicationId !== pubId) {
    throw new Error("Media deletion failed: publicationId was corrupted!");
  }
  console.log("Media Deletion Behavior: PASS (featureImageId set to NULL, publicationId intact)");

  // ----------------------------------------------------
  // 4. Publication Isolation (Cross-Tenant Rejection)
  // ----------------------------------------------------
  console.log("\n4. Publication Isolation (Database Level)...");
  // Ensure tenant B publication exists
  await db
    .insert(publications)
    .values({
      id: "pub_tenant_b",
      workspaceId: "ws_default",
      name: "Tenant B",
      slug: `tenant-b-${Date.now()}`,
      primaryLocale: "en",
    })
    .onConflictDoNothing();

  const assetTenantB = crypto.randomUUID();
  await db.insert(mediaAssets).values({
    id: assetTenantB,
    publicationId: "pub_tenant_b",
    storageKey: `media/tenant-b-${Date.now()}.jpg`,
    originalFilename: "tenant-b.jpg",
    displayName: "Tenant B Asset",
    mimeType: "image/jpeg",
    extension: "jpg",
    sizeBytes: 500,
    checksum: "checksumb",
    assetType: "image",
  });

  // Attempt to link Pub Default post with Tenant B media asset
  let rejected = false;
  try {
    await db
      .update(posts)
      .set({ featureImageId: assetTenantB })
      .where(eq(posts.id, testPostId));
  } catch (err: any) {
    rejected = true;
    console.log("Cross-publication assignment successfully REJECTED by PostgreSQL FK:", err.message);
  }

  if (!rejected) {
    throw new Error("CRITICAL SECURITY FAILURE: Database permitted cross-publication media assignment!");
  }
  console.log("Publication Isolation at Database Level: PASS");

  // ----------------------------------------------------
  // 5. Rollback and Re-Apply Verification
  // ----------------------------------------------------
  console.log("\n5. Rollback & Re-apply Verification...");
  // Cleanup test rows
  await db.delete(posts).where(eq(posts.id, testPostId));
  await db.delete(mediaAssets).where(eq(mediaAssets.id, assetTenantB));

  // Test Rollback DDL
  await db.execute(sql`
    ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_feature_image_publication_fk";
    DROP INDEX IF EXISTS "posts_feature_image_id_idx";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "feature_image_id";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "feature_image_alt";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "feature_image_caption";
    ALTER TABLE "media_assets" DROP CONSTRAINT IF EXISTS "media_assets_id_publication_unique";
  `);
  console.log("Rollback DDL executed successfully.");

  // Verify columns are gone
  const colsAfterRollback = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name IN ('feature_image_id', 'feature_image_alt', 'feature_image_caption');
  `);
  if (colsAfterRollback.rows.length !== 0) {
    throw new Error("Rollback failed: columns still exist!");
  }
  console.log("Rollback Verification: PASS (schema cleanly reverted)");

  // Re-apply 0028 Migration cleanly
  console.log("Re-applying Migration 0028...");
  await db.execute(sql`
    ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_id_publication_unique" UNIQUE ("id", "publication_id");
    ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feature_image_id" text;
    ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feature_image_alt" text;
    ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feature_image_caption" text;
    CREATE INDEX IF NOT EXISTS "posts_feature_image_id_idx" ON "posts" ("feature_image_id");
    ALTER TABLE "posts"
      ADD CONSTRAINT "posts_feature_image_publication_fk"
      FOREIGN KEY ("feature_image_id", "publication_id")
      REFERENCES "media_assets"("id", "publication_id")
      ON DELETE SET NULL ("feature_image_id");
  `);
  console.log("Re-apply Migration 0028: PASS");

  await closeDbPool();
  console.log("\nALL 5 MIGRATION VERIFICATION CHECKS PASSED WITH ZERO ERRORS!");
}

verifyMigration0028()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("MIGRATION VERIFICATION FAILED:", err);
    process.exit(1);
  });
