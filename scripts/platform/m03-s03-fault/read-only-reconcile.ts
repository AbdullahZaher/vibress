/**
 * M03-S03 Agent04 read-only recovery *test* observer.
 *
 * Separately authenticates to a disposable PG16 session. It never executes
 * DDL, never trusts a text hash without the full pinned manifest, and never
 * grants/revokes approval. NOT a production operator entrypoint.
 */
import type { Client } from "pg";

export interface RecoveryExpected {
  database: string;
  installationId: string;
  operationId: string;
  planDigest: string;
  operatorRole: string;
  tableName: string;
  columnName: string;
  beforeDigest: string;
  afterDigest: string;
  beforeManifestText: string;
  afterManifestText: string;
  expectedSeedChecksum: string;
  beforeColumns: readonly { name: string; type: string; required: boolean }[];
  afterColumns: readonly { name: string; type: string; required: boolean }[];
}
export type Reconciled =
  | { state: "ROLLED_BACK"; retry: "REQUIRES_NEW_AUTHORIZATION_CHECK" }
  | { state: "COMMITTED"; retry: "ALREADY_APPLIED_ONLY" }
  | { state: "HALT_UNRECONCILABLE"; retry: "DENIED" };

const IDENTIFIER = /^[a-z][a-z0-9_]{1,62}$/;
const SHA = /^[a-f0-9]{64}$/;

export async function reconcileReadOnly(
  db: Client, expected: RecoveryExpected,
): Promise<Reconciled> {
  const halt: Reconciled = { state: "HALT_UNRECONCILABLE", retry: "DENIED" };
  if (![expected.database, expected.tableName,
        expected.columnName, expected.operatorRole].every(x => IDENTIFIER.test(x)) ||
      !/^[a-z][a-z0-9_-]{1,62}$/.test(expected.installationId) ||
      ![expected.planDigest, expected.beforeDigest, expected.afterDigest]
        .every(x => SHA.test(x)) ||
      !expected.operationId || !expected.expectedSeedChecksum) {
    return halt;
  }
  // Snapshot all evidence atomically from a FRESH connection.
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const identity = await db.query<{ database_name: string; pg_version: number }>(
      "SELECT current_database() AS database_name, " +
      "current_setting('server_version_num')::int AS pg_version");
    if (identity.rows[0]?.database_name !== expected.database ||
        (identity.rows[0]?.pg_version ?? 0) < 160000 ||
        (identity.rows[0]?.pg_version ?? 0) >= 170000) {
      await db.query("COMMIT"); return halt;
    }
    const registry = await db.query<{ manifest_digest: string; manifest: string }>(
      "SELECT manifest_digest,manifest FROM public.platform_schema_registry " +
      "WHERE installation_id=$1", [expected.installationId]);
    const journal = await db.query<{
      plan_digest: string; previous_digest: string; new_digest: string;
      operator_role: string; status: string;
    }>(
      "SELECT plan_digest,previous_digest,new_digest,operator_role,status " +
      "FROM public.platform_schema_migration_journal " +
      "WHERE installation_id=$1 AND operation_id=$2",
      [expected.installationId, expected.operationId]);
    const columns = await db.query<{
      name: string; type: string; required: boolean;
      default_expr: string | null; generated: string; identity: string;
    }>(
      "SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type, " +
      "a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_expr, " +
      "a.attgenerated::text AS generated,a.attidentity::text AS identity " +
      "FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid " +
      "JOIN pg_namespace n ON n.oid=c.relnamespace " +
      "LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum " +
      "WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 " +
      "AND NOT a.attisdropped ORDER BY a.attname", [expected.tableName]);
    // Identifier validated above, escaped using node-postgres's PG quoting.
    const checksum = await db.query<{ digest: string }>(
      "SELECT md5(string_agg(name, ',' ORDER BY name)) AS digest " +
      'FROM "public".' + db.escapeIdentifier(expected.tableName));
    await db.query("COMMIT");
    const actualCols = columns.rows.map(({ name, type, required,
      default_expr, generated, identity }) => ({
      name, type, required, default_expr, generated, identity,
    }));
    const equalColumns = (want: RecoveryExpected["beforeColumns"]) =>
      JSON.stringify(actualCols) === JSON.stringify(
        [...want].sort((a,b)=>a.name.localeCompare(b.name)).map(x=>({
          name:x.name,type:x.type,required:x.required,
          default_expr:null,generated:"",identity:"",
        })));
    if (registry.rows.length !== 1 || journal.rows.length > 1 ||
        checksum.rows[0]?.digest !== expected.expectedSeedChecksum) return halt;
    const r = registry.rows[0]!;
    if (journal.rows.length === 0 && r.manifest_digest === expected.beforeDigest &&
        r.manifest === expected.beforeManifestText && equalColumns(expected.beforeColumns)) {
      return { state: "ROLLED_BACK", retry: "REQUIRES_NEW_AUTHORIZATION_CHECK" };
    }
    const j = journal.rows[0];
    if (j && j.status === "COMPLETED" && j.plan_digest === expected.planDigest &&
        j.previous_digest === expected.beforeDigest && j.new_digest === expected.afterDigest &&
        j.operator_role === expected.operatorRole && r.manifest_digest === expected.afterDigest &&
        r.manifest === expected.afterManifestText && equalColumns(expected.afterColumns)) {
      return { state: "COMMITTED", retry: "ALREADY_APPLIED_ONLY" };
    }
    return halt;
  } catch {
    await db.query("ROLLBACK").catch(() => undefined);
    return halt;
  }
}
