import { getDb, closeDbPool } from "../src";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

const TABLES = [
  "posts",
  "pages",
  "tags",
  "media_assets",
  "members",
  "products",
  "plans",
  "newsletters",
  "search_documents",
  "content_translations",
  "automations",
  "installed_themes",
  "webhook_endpoints",
  "analytics_events",
] as const;

export interface PreMigrationSnapshot {
  timestamp: string;
  counts: Record<string, number>;
  mediaStorageKeys: string[];
}

const SNAPSHOT_PATH = path.join(__dirname, "pre_migration_counts.json");

export async function capturePreMigrationCounts(): Promise<PreMigrationSnapshot> {
  const db = getDb();
  const counts: Record<string, number> = {};

  console.log("Capturing pre-migration table row counts...");
  for (const table of TABLES) {
    const res = await db.execute(sql.raw(`SELECT count(*)::int as c FROM "${table}"`));
    const count = Number(res.rows[0]?.c ?? 0);
    counts[table] = count;
    console.log(`  - ${table}: ${count}`);
  }

  // Capture existing media storage keys to verify media compatibility
  const mediaRes = await db.execute(
    sql.raw(`SELECT storage_key FROM "media_assets" ORDER BY id`),
  );
  const mediaStorageKeys = (mediaRes.rows as Array<{ storage_key: string }>).map(
    (r) => r.storage_key,
  );
  console.log(`Captured ${mediaStorageKeys.length} media storage keys for preservation check.`);

  const snapshot: PreMigrationSnapshot = {
    timestamp: new Date().toISOString(),
    counts,
    mediaStorageKeys,
  };

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`Snapshot saved to ${SNAPSHOT_PATH}`);
  return snapshot;
}

export async function verifyPostMigrationInvariants(
  expectedCounts?: Record<string, number>,
): Promise<boolean> {
  const db = getDb();
  let preCounts = expectedCounts;
  let preMediaKeys: string[] = [];

  if (!preCounts) {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const data = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as PreMigrationSnapshot;
      preCounts = data.counts;
      preMediaKeys = data.mediaStorageKeys || [];
      console.log(`Loaded pre-migration snapshot from ${SNAPSHOT_PATH} (${data.timestamp})`);
    } else {
      console.warn(
        "WARNING: No pre-migration snapshot found. Dynamic pre/post delta check skipped, falling back to schema validation.",
      );
    }
  }

  console.log("\n========================================================");
  console.log("VERIFYING POST-MIGRATION INVARIANTS (MIGRATION 0026)");
  console.log("========================================================");

  let passed = true;

  // 1. Dynamic Row Count Invariant Check (Zero deletions, including search_documents)
  console.log("\n1. Checking row counts per table (Pre vs Post)...");
  for (const table of TABLES) {
    const res = await db.execute(sql.raw(`SELECT count(*)::int as c FROM "${table}"`));
    const postCount = Number(res.rows[0]?.c ?? 0);
    if (preCounts) {
      const preCount = preCounts[table] ?? 0;
      if (postCount !== preCount) {
        console.error(
          `❌ FAIL: Row count mismatch in "${table}": pre=${preCount}, post=${postCount}`,
        );
        passed = false;
      } else {
        console.log(`✅ PASS: "${table}" row count preserved: ${postCount}`);
      }
    } else {
      console.log(`ℹ️  "${table}": ${postCount} rows`);
    }
  }

  // 2. Media Storage Key Compatibility Invariant
  console.log("\n2. Checking media storage_key preservation...");
  if (preMediaKeys.length > 0) {
    const currentMediaRes = await db.execute(
      sql.raw(`SELECT storage_key FROM "media_assets" ORDER BY id`),
    );
    const currentMediaKeys = (
      currentMediaRes.rows as Array<{ storage_key: string }>
    ).map((r) => r.storage_key);

    const missingKeys = preMediaKeys.filter((k) => !currentMediaKeys.includes(k));
    if (missingKeys.length > 0) {
      console.error(
        `❌ FAIL: ${missingKeys.length} media storage_key values were modified or deleted! Example: ${missingKeys[0]}`,
      );
      passed = false;
    } else {
      console.log(
        `✅ PASS: All ${currentMediaKeys.length} media storage_key values preserved without mutation`,
      );
    }
  } else {
    console.log("ℹ️  No pre-migration media keys to compare against.");
  }

  // 3. publication_id NOT NULL check
  console.log("\n3. Checking publication_id NOT NULL integrity across all 14 tables...");
  for (const table of TABLES) {
    const res = await db.execute(
      sql.raw(
        `SELECT count(*)::int as null_count FROM "${table}" WHERE publication_id IS NULL`,
      ),
    );
    const nullCount = Number(res.rows[0]?.null_count ?? 0);
    if (nullCount > 0) {
      console.error(
        `❌ FAIL: "${table}" contains ${nullCount} rows with NULL publication_id!`,
      );
      passed = false;
    } else {
      console.log(`✅ PASS: "${table}" has zero NULL publication_id records`);
    }
  }

  // 4. Foreign Key Checks to publications(id)
  console.log("\n4. Checking Foreign Key constraints to publications(id)...");
  const fkQuery = `
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM
      information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'publications'
      AND ccu.column_name = 'id';
  `;
  const fkRes = await db.execute(sql.raw(fkQuery));
  const fkRows = fkRes.rows as Array<{
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    delete_rule: string;
  }>;

  const foundFkTables = new Set(fkRows.map((r) => r.table_name));
  for (const table of TABLES) {
    if (!foundFkTables.has(table)) {
      console.error(`❌ FAIL: Foreign key to publications(id) MISSING on "${table}"!`);
      passed = false;
    } else {
      const fk = fkRows.find((r) => r.table_name === table);
      const expectedRule = ["members", "products", "plans"].includes(table)
        ? "RESTRICT"
        : "CASCADE";
      if (fk?.delete_rule !== expectedRule) {
        console.error(
          `❌ FAIL: "${table}" delete rule is "${fk?.delete_rule}", expected "${expectedRule}"!`,
        );
        passed = false;
      } else {
        console.log(`✅ PASS: "${table}" FK valid with ON DELETE ${expectedRule}`);
      }
    }
  }

  // 5. Database-Enforced Derived Ownership: Composite FK on plans (product_id, publication_id)
  console.log(
    "\n5. Checking Database-Enforced Composite FK for Products & Plans...",
  );
  const compFkQuery = `
    SELECT
      tc.constraint_name,
      tc.table_name,
      rc.delete_rule
    FROM
      information_schema.table_constraints AS tc
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_name = 'plans_product_publication_fk';
  `;
  const compFkRes = await db.execute(sql.raw(compFkQuery));
  if (compFkRes.rows.length === 0) {
    console.error(
      "❌ FAIL: Composite FK 'plans_product_publication_fk' MISSING on plans!",
    );
    passed = false;
  } else {
    console.log(
      "✅ PASS: Composite FK 'plans_product_publication_fk' is active on plans (product_id, publication_id) -> products(id, publication_id)",
    );
  }

  // 6. Publication-Scoped Unique Indexes
  console.log("\n6. Checking Publication-Scoped Unique Indexes & Partial Predicates...");
  const expectedIndexes = [
    {
      table: "posts",
      name: "posts_publication_slug_active_idx",
      predicateRequired: "deleted_at IS NULL",
    },
    {
      table: "pages",
      name: "pages_publication_slug_active_idx",
      predicateRequired: "deleted_at IS NULL",
    },
    { table: "tags", name: "tags_publication_slug_unique" },
    { table: "members", name: "members_publication_email_idx" },
    { table: "products", name: "products_publication_key_unique" },
    { table: "newsletters", name: "newsletters_publication_key_unique" },
    { table: "automations", name: "automations_publication_key_unique" },
    {
      table: "content_translations",
      name: "content_translations_pub_locale_slug_idx",
    },
    {
      table: "installed_themes",
      name: "installed_themes_pub_version_unique_idx",
    },
    { table: "search_documents", name: "search_documents_pub_entity_idx" },
  ];

  const indexQuery = `
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public';
  `;
  const idxRes = await db.execute(sql.raw(indexQuery));
  const idxRows = idxRes.rows as Array<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>;

  for (const exp of expectedIndexes) {
    const found = idxRows.find(
      (r) => r.tablename === exp.table && r.indexname === exp.name,
    );
    if (!found) {
      console.error(
        `❌ FAIL: Unique index "${exp.name}" MISSING on "${exp.table}"!`,
      );
      passed = false;
    } else {
      if (exp.predicateRequired) {
        if (!found.indexdef.toLowerCase().includes("deleted_at is null")) {
          console.error(
            `❌ FAIL: Unique index "${exp.name}" does NOT contain required partial predicate: ${exp.predicateRequired}`,
          );
          passed = false;
        } else {
          console.log(
            `✅ PASS: Unique index "${exp.name}" is active with partial predicate (WHERE deleted_at IS NULL)`,
          );
        }
      } else {
        console.log(
          `✅ PASS: Unique index "${exp.name}" is active on "${exp.table}"`,
        );
      }
    }
  }

  // 7. Verify obsolete global unique indexes were dropped
  console.log("\n7. Checking that obsolete global unique indexes were dropped...");
  const obsoleteIndexes = [
    { table: "posts", name: "posts_slug_unique" },
    { table: "pages", name: "pages_slug_unique" },
    { table: "tags", name: "tags_slug_unique" },
    { table: "members", name: "members_email_normalized_unique" },
    { table: "products", name: "products_key_unique" },
    { table: "newsletters", name: "newsletters_key_unique" },
    { table: "automations", name: "automations_key_unique" },
    {
      table: "content_translations",
      name: "content_translations_locale_slug_idx",
    },
    {
      table: "installed_themes",
      name: "installed_themes_theme_id_version_unique_idx",
    },
    { table: "search_documents", name: "search_documents_entity_idx" },
  ];

  for (const obs of obsoleteIndexes) {
    const found = idxRows.find(
      (r) => r.tablename === obs.table && r.indexname === obs.name,
    );
    if (found) {
      console.error(
        `❌ FAIL: Obsolete global unique index "${obs.name}" was NOT dropped on "${obs.table}"!`,
      );
      passed = false;
    } else {
      console.log(
        `✅ PASS: Obsolete global unique index "${obs.name}" has been removed from "${obs.table}"`,
      );
    }
  }

  console.log("\n========================================================");
  if (passed) {
    console.log("🎉 ALL POST-MIGRATION INVARIANTS VERIFIED SUCCESSFULLY!");
  } else {
    console.error("🚨 POST-MIGRATION INVARIANT VERIFICATION FAILED!");
  }
  console.log("========================================================\n");

  return passed;
}

// CLI entry point
if (require.main === module) {
  const mode = process.argv[2];
  if (mode === "--capture-pre") {
    capturePreMigrationCounts()
      .then(() => closeDbPool())
      .catch(async (err) => {
        console.error("Failed to capture pre-migration counts:", err);
        await closeDbPool();
        process.exit(1);
      });
  } else {
    verifyPostMigrationInvariants()
      .then((passed) => {
        closeDbPool().then(() => {
          process.exit(passed ? 0 : 1);
        });
      })
      .catch(async (err) => {
        console.error("Verification script error:", err);
        await closeDbPool();
        process.exit(1);
      });
  }
}
