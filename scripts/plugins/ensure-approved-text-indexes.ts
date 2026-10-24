/**
 * Operator-only, forward-compatible physical index maintenance.
 * Use on populated upgrades AFTER reviewing the signed migration plan.
 * Never run from a public API route, worker or plugin module.
 *
 * Usage: pnpm exec tsx scripts/plugins/ensure-approved-text-indexes.ts /absolute/plan.json [--apply]
 * Default: dry run; --apply runs CREATE INDEX CONCURRENTLY outside a transaction.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { getDbPool, closeDbPool } from "@vibress/database";
import { readVerifiedOperatorMigrationPlan } from "./read-verified-migration-plan";

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Unsafe PostgreSQL identifier");
  }
  return '"' + value + '"';
}
function physicalTable(manifest: string, model: string): string {
  return "ext_" + createHash("sha256").update(manifest + ":" + model).digest("hex").slice(0, 40);
}
function indexName(table: string, field: string): string {
  return table + "_i_" + createHash("sha256").update(field).digest("hex").slice(0, 12);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 ||
      (args.length === 2 && args[1] !== "--apply") ||
      !path.isAbsolute(args[0] ?? "")) {
    throw new Error("Usage: ensure-approved-text-indexes /absolute/signed-plan.json [--apply]");
  }
  const plan = await readVerifiedOperatorMigrationPlan(args[0]);
  const apply = args[1] === "--apply";
  // One checked-out connection is reused so CREATE INDEX CONCURRENTLY is
  // never executed inside the migration writer's transaction.
  const client = await getDbPool().connect();
  try {
    await client.query("SET lock_timeout = '5s'");
    for (const model of plan.models) {
      for (const field of model.indexedTextFields ?? []) {
        const expectedName = physicalTable(plan.manifestId, model.key);
        const found = await client.query<{
          schema_name: string;
          table_name: string;
          schema_sha256: string;
        }>(`
          SELECT ns.nspname AS schema_name,
                 owned.table_name, owned.schema_sha256
          FROM plugin_storage_physical_models owned
          JOIN plugins installed ON installed.id = owned.plugin_id
          JOIN pg_class owner_catalog
            ON owner_catalog.oid = to_regclass('plugin_storage_physical_models')
            AND owner_catalog.relkind = 'r'
          JOIN pg_namespace ns ON ns.oid = owner_catalog.relnamespace
          JOIN pg_class physical ON physical.relnamespace = ns.oid
            AND physical.relname = owned.table_name AND physical.relkind = 'r'
          WHERE installed.manifest_id = $1 AND owned.model_key = $2
        `, [plan.manifestId, model.key]);
        const record = found.rows[0];
        if (found.rowCount !== 1 || !record ||
            record.table_name !== expectedName ||
            record.schema_sha256 !== model.schemaSha256) {
          throw new Error("Installed physical model differs from signed operator approval");
        }
        const targetTable = identifier(record.schema_name) + "." + identifier(record.table_name);
        const index = indexName(record.table_name, field);
        const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${identifier(index)} ON ${targetTable}
          ("publication_id", ${identifier(field)}, "id")`;
        if (apply) {
          await client.query(sql);
          const checked = await client.query<{
            indisvalid: boolean;
            indisready: boolean;
            indisunique: boolean;
            indexed_columns: string[];
          }>(`
            SELECT ix.indisvalid, ix.indisready, ix.indisunique,
              (SELECT array_agg(attr.attname ORDER BY col.ordinality)
               FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS col(attnum, ordinality)
               JOIN pg_attribute attr ON attr.attrelid = ix.indrelid
                 AND attr.attnum = col.attnum) AS indexed_columns
            FROM pg_class index_rel
            JOIN pg_index ix ON ix.indexrelid = index_rel.oid
            JOIN pg_class table_rel ON table_rel.oid = ix.indrelid
            JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
            WHERE ns.nspname = $1 AND table_rel.relname = $2 AND index_rel.relname = $3
          `, [record.schema_name, record.table_name, index]);
          const row = checked.rows[0];
          if (checked.rowCount !== 1 || !row ||
              !row.indisvalid || !row.indisready || row.indisunique ||
              JSON.stringify(row.indexed_columns) !==
                JSON.stringify(["publication_id", field, "id"])) {
            throw new Error("Index missing, invalid or incompatible; operator repair required");
          }
        }
        process.stdout.write(`${apply ? "VERIFIED" : "DRY-RUN"} ${sql}\n`);
      }
    }
  } finally {
    client.release();
    await closeDbPool();
  }
}
main().catch((error: unknown) => {
  process.stderr.write(`Operator index maintenance failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
