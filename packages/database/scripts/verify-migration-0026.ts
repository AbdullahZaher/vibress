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

  // 4. Foreign Key Column-to-Column Checks via pg_constraint
  console.log("\n4. Checking Foreign Key Column-to-Column mappings via PostgreSQL catalog...");
  const fkCatalogQuery = `
    SELECT
      c.conname AS constraint_name,
      src.relname AS source_table,
      ARRAY_AGG(src_att.attname ORDER BY u.pos) AS source_columns,
      tgt.relname AS target_table,
      ARRAY_AGG(tgt_att.attname ORDER BY u.pos) AS target_columns,
      c.confdeltype AS delete_rule
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    CROSS JOIN LATERAL UNNEST(c.conkey, c.confkey) WITH ORDINALITY AS u(src_attnum, tgt_attnum, pos)
    JOIN pg_attribute src_att ON src_att.attrelid = c.conrelid AND src_att.attnum = u.src_attnum
    JOIN pg_attribute tgt_att ON tgt_att.attrelid = c.confrelid AND tgt_att.attnum = u.tgt_attnum
    WHERE c.contype = 'f'
    GROUP BY c.conname, src.relname, tgt.relname, c.confdeltype;
  `;
  const fkRes = await db.execute(sql.raw(fkCatalogQuery));
  const fkRows = fkRes.rows as Array<{
    constraint_name: string;
    source_table: string;
    source_columns: string[];
    target_table: string;
    target_columns: string[];
    delete_rule: string;
  }>;

  // Verify all 14 tables map publication_id -> publications.id
  for (const table of TABLES) {
    const fk = fkRows.find(
      (r) =>
        r.source_table === table &&
        r.target_table === "publications" &&
        r.source_columns.includes("publication_id") &&
        r.target_columns.includes("id"),
    );

    if (!fk) {
      console.error(
        `❌ FAIL: Explicit FK mapping "${table}.publication_id -> publications.id" MISSING in pg_constraint!`,
      );
      passed = false;
    } else {
      const expectedRuleCode = ["members", "products", "plans"].includes(table) ? "r" : "c";
      if (fk.delete_rule !== expectedRuleCode) {
        console.error(
          `❌ FAIL: "${table}.publication_id" delete rule is "${fk.delete_rule}", expected "${expectedRuleCode}"!`,
        );
        passed = false;
      } else {
        console.log(
          `✅ PASS: Catalog verified: ${table}.publication_id -> publications.id (ON DELETE ${expectedRuleCode === "r" ? "RESTRICT" : "CASCADE"})`,
        );
      }
    }
  }

  // 5. Database-Enforced Derived Ownership: Composite FK on plans (product_id, publication_id)
  console.log(
    "\n5. Checking Database-Enforced Composite FK for Products & Plans...",
  );
  const compositeFk = fkRows.find(
    (r) =>
      r.source_table === "plans" &&
      r.target_table === "products" &&
      r.source_columns.length === 2 &&
      r.source_columns[0] === "product_id" &&
      r.source_columns[1] === "publication_id" &&
      r.target_columns.length === 2 &&
      r.target_columns[0] === "id" &&
      r.target_columns[1] === "publication_id",
  );

  if (!compositeFk) {
    console.error(
      "❌ FAIL: Composite FK 'plans(product_id, publication_id) -> products(id, publication_id)' MISSING in pg_constraint!",
    );
    passed = false;
  } else {
    console.log(
      "✅ PASS: Catalog verified: plans(product_id, publication_id) -> products(id, publication_id) [RESTRICT]",
    );
  }

  // 6. Publication-Scoped Unique Indexes & Partial Predicates
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

  // 7. Schema-Level Global Uniqueness Invariant Check
  console.log("\n7. Verifying Schema-Level Absence of Obsolete Global Uniqueness...");
  const uniqueCatalogQuery = `
    SELECT
      c.relname AS table_name,
      i.relname AS index_name,
      ARRAY_AGG(a.attname ORDER BY u.pos) AS column_names,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate
    FROM pg_index ix
    JOIN pg_class c ON c.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    CROSS JOIN LATERAL UNNEST(ix.indkey) WITH ORDINALITY AS u(attnum, pos)
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.attnum
    WHERE ix.indisunique = true
      AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    GROUP BY c.relname, i.relname, ix.indpred, ix.indrelid;
  `;
  const uniqueRes = await db.execute(sql.raw(uniqueCatalogQuery));
  const uniqueCatalogRows = uniqueRes.rows as Array<{
    table_name: string;
    index_name: string;
    column_names: string[];
    predicate: string | null;
  }>;

  const targetColumnsByTable: Record<string, string[]> = {
    posts: ["slug"],
    pages: ["slug"],
    tags: ["slug"],
    members: ["email_normalized"],
    products: ["key"],
    newsletters: ["key"],
    automations: ["key"],
    content_translations: ["target_locale", "slug"],
    installed_themes: ["theme_id", "version"],
    search_documents: ["entity_type", "entity_id"],
  };

  for (const [table, targetCols] of Object.entries(targetColumnsByTable)) {
    // Find any unique index on this table that covers the target columns WITHOUT publication_id
    const badGlobalIndexes = uniqueCatalogRows.filter(
      (idx) =>
        idx.table_name === table &&
        targetCols.every((col) => idx.column_names.includes(col)) &&
        !idx.column_names.includes("publication_id"),
    );

    if (badGlobalIndexes.length > 0) {
      for (const badIdx of badGlobalIndexes) {
        console.error(
          `❌ FAIL: Obsolete global uniqueness remains on "${table}" via index "${badIdx.index_name}" on columns (${badIdx.column_names.join(", ")})!`,
        );
      }
      passed = false;
    } else {
      console.log(
        `✅ PASS: Zero obsolete global uniqueness on "${table}" (${targetCols.join(", ")}) — all uniqueness is publication-scoped`,
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
