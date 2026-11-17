import type { ClientBase } from "pg";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  renderTrustedAdditiveColumn,
  type ManifestResource,
} from "@vibress/schema-engine";

/**
 * M03-S03 operator-only connector. This module is deliberately NOT exported by
 * @vibress/database's runtime index. No Fastify route, worker or plugin hook
 * imports it. The caller owns the dedicated PostgreSQL connection lifecycle.
 */
export class SchemaMigrationOperatorError extends Error {
  constructor(readonly code:
    | "UNAUTHORIZED" | "STALE_PLAN" | "CATALOG_DRIFT" | "UNSUPPORTED"
    | "JOURNAL_CONFLICT" | "INDETERMINATE", reason: string) {
    super(reason);
    this.name = "SchemaMigrationOperatorError";
  }
}

function deny(code: SchemaMigrationOperatorError["code"], reason: string): never {
  throw new SchemaMigrationOperatorError(code, reason);
}

interface IdentityRow {
  current_user: string;
  session_user: string;
  database_name: string;
  postgres_version: number;
}
interface InstallationRow {
  id: string;
  application_id: string;
  environment: string;
  total: number;
}
interface RegistryRow {
  installation_id: string;
  application_id: string;
  environment: string;
  database_name: string;
  operator_role: string;
  runtime_role: string;
  manifest: string;
  manifest_digest: string;
}
interface PlanRow {
  plan_digest: string;
  expected_manifest: string;
  plan: string;
  author: string;
}
interface ApprovalRow {
  operation_id: string;
  approver: string;
  operator_role: string;
  environment: string;
  approved_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  server_now: Date;
}
interface JournalRow {
  plan_digest: string;
  previous_digest: string;
  new_digest: string;
  operator_role: string;
  status: string;
}
interface RoleRow {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolcanlogin: boolean;
  operator_member: boolean;
  runtime_member: boolean;
  runtime_schema_create: boolean;
  runtime_database_create: boolean;
}
interface RelationRow {
  oid: number;
  owner_name: string;
  relkind: string;
  relpersistence: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  relispartition: boolean;
  schema_owner: string;
}
interface ColumnRow {
  name: string;
  data_type: string;
  not_null: boolean;
  default_expr: string | null;
  generated: string;
  identity: string;
}

export interface SchemaOperatorRequest {
  readonly installationId: string;
  readonly planDigest: string;
}
export interface SchemaOperatorResult {
  readonly status: "APPLIED" | "ALREADY_APPLIED";
  readonly installationId: string;
  readonly operationId: string;
  readonly planDigest: string;
  readonly previousDigest: string;
  readonly newDigest: string;
  readonly beforeRows: string;
  readonly afterRows: string;
}

const SHA = /^[0-9a-f]{64}$/;
const INSTALLATION = /^[a-z][a-z0-9_-]{1,62}$/;

async function assertAuthority(
  db: ClientBase, identity: IdentityRow, registry: RegistryRow,
  resource: ManifestResource,
): Promise<number> {
  const roleResult = await db.query<RoleRow>(
    "SELECT op.rolsuper, op.rolbypassrls, op.rolcreatedb, op.rolcreaterole, " +
    "op.rolreplication, op.rolcanlogin, " +
    "pg_has_role($1, $2, 'MEMBER') AS operator_member, " +
    "pg_has_role($2, $1, 'MEMBER') AS runtime_member, " +
    "has_schema_privilege($1, 'public', 'CREATE') AS runtime_schema_create, " +
    "has_database_privilege($1, current_database(), 'CREATE') AS runtime_database_create " +
    "FROM pg_roles op WHERE op.rolname = $2",
    [registry.runtime_role, identity.current_user],
  );
  const role = roleResult.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb ||
    role.rolcreaterole || role.rolreplication || !role.rolcanlogin ||
    role.operator_member || role.runtime_member ||
    role.runtime_schema_create || role.runtime_database_create) {
    deny("UNAUTHORIZED", "effective operator/runtime role authority is unsafe");
  }
  const runtime = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
    [registry.runtime_role],
  );
  if (!runtime.rows[0] || runtime.rows[0].rolsuper || runtime.rows[0].rolbypassrls) {
    deny("UNAUTHORIZED", "runtime role can bypass database policy");
  }
  const unsafeFunctions = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM pg_proc p " +
    "JOIN pg_namespace n ON n.oid = p.pronamespace " +
    "WHERE n.nspname = 'public' AND p.prosecdef " +
    "AND has_function_privilege($1, p.oid, 'EXECUTE')",
    [registry.runtime_role],
  );
  if ((unsafeFunctions.rows[0]?.count ?? 0) !== 0) {
    deny("UNAUTHORIZED", "runtime can execute a SECURITY DEFINER function");
  }
  const relation = await db.query<RelationRow>(
    "SELECT c.oid, pg_get_userbyid(c.relowner) AS owner_name, " +
    "c.relkind::text, c.relpersistence::text, c.relrowsecurity, " +
    "c.relforcerowsecurity, c.relispartition, " +
    "pg_get_userbyid(n.nspowner) AS schema_owner " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = 'public' AND c.relname = $1",
    [resource.tableName],
  );
  const found = relation.rows[0];
  if (relation.rows.length !== 1 || !found ||
    found.owner_name !== identity.current_user ||
    found.schema_owner === identity.current_user ||
    found.relkind !== "r" || found.relpersistence !== "p" ||
    found.relrowsecurity || found.relforcerowsecurity || found.relispartition) {
    deny("CATALOG_DRIFT", "table ownership, namespace, kind or RLS state differs");
  }
  const tablePrivileges = await db.query<{ truncate: boolean; references: boolean; trigger: boolean }>(
    "SELECT has_table_privilege($1, $2::oid, 'TRUNCATE') AS truncate, " +
    "has_table_privilege($1, $2::oid, 'REFERENCES') AS references, " +
    "has_table_privilege($1, $2::oid, 'TRIGGER') AS trigger",
    [registry.runtime_role, found.oid],
  );
  const privileges = tablePrivileges.rows[0];
  if (!privileges || privileges.truncate || privileges.references || privileges.trigger) {
    deny("UNAUTHORIZED", "runtime has privileged table operations");
  }
  const unexpected = await db.query<{ count: number }>(
    "SELECT (SELECT count(*) FROM pg_constraint WHERE conrelid = $1::oid) + " +
    "(SELECT count(*) FROM pg_trigger WHERE tgrelid = $1::oid AND NOT tgisinternal) + " +
    "(SELECT count(*) FROM pg_inherits WHERE inhrelid = $1::oid) AS count",
    [found.oid],
  );
  if (Number(unexpected.rows[0]?.count ?? -1) !== 0) {
    deny("CATALOG_DRIFT", "table has unreviewed constraints, triggers or inheritance");
  }
  return found.oid;
}

async function verifyCatalog(
  db: ClientBase, oid: number, expected: ManifestResource,
): Promise<void> {
  const rows = await db.query<ColumnRow>(
    "SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type, " +
    "a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS default_expr, " +
    "a.attgenerated::text AS generated, a.attidentity::text AS identity " +
    "FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum " +
    "WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attname",
    [oid],
  );
  const expectedFields = [...expected.fields].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (rows.rows.length !== expectedFields.length) {
    deny("CATALOG_DRIFT", "unexpected number of physical columns");
  }
  for (let i = 0; i < expectedFields.length; i += 1) {
    const field = expectedFields[i];
    const observed = rows.rows[i];
    if (!field || !observed || observed.name !== field.id ||
      observed.data_type !== field.postgresType ||
      observed.not_null !== field.required || observed.default_expr !== null ||
      observed.generated !== "" || observed.identity !== "" ||
      field.mappingStatus !== "MAPPED" ||
      Object.prototype.hasOwnProperty.call(field, "default")) {
      deny("CATALOG_DRIFT", "physical column type, nullability, identity or default differs");
    }
  }
}

async function rowCount(db: ClientBase, tableName: string): Promise<string> {
  // tableName originates from the canonical validated schema engine only.
  const result = await db.query<{ rows: string }>(
    'SELECT count(*)::text AS rows FROM "public"."' + tableName + '"',
  );
  const count = result.rows[0]?.rows;
  if (!count || !/^[0-9]+$/.test(count)) {
    deny("CATALOG_DRIFT", "row count is unavailable");
  }
  return count;
}

/**
 * Dedicated-session transactional operator entrypoint. A successful journal
 * row and the physical ALTER are committed together; a failed/aborted attempt
 * exposes neither. The scoped installation lock and catalog reads share the
 * same transaction. Caller must close/burn the connection on ambiguous failure.
 *
 * Only disposable test/development databases are enabled in M03-S03.
 */
export async function executeApprovedAdditiveColumn(
  db: ClientBase,
  request: SchemaOperatorRequest,
): Promise<SchemaOperatorResult> {
  if (!INSTALLATION.test(request.installationId) || !SHA.test(request.planDigest)) {
    return deny("UNAUTHORIZED", "invalid operator invocation");
  }
  let began = false;
  let commitAttempted = false;
  try {
    await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    began = true;
    await db.query("SET LOCAL lock_timeout = '2000ms'");
    await db.query("SET LOCAL statement_timeout = '10000ms'");
    await db.query("SET LOCAL idle_in_transaction_session_timeout = '15000ms'");
    await db.query("SET LOCAL search_path = pg_catalog");
    // Advisory transaction lock is crash-safe. Hash collisions may over-serialize,
    // but cannot allow two migrations for the same installation to overlap.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03'), hashtext($1::text))",
      [request.installationId]);

    const identity = (await db.query<IdentityRow>(
      "SELECT current_user, session_user, current_database() AS database_name, " +
      "current_setting('server_version_num')::int AS postgres_version",
    )).rows[0];
    if (!identity || identity.postgres_version < 160000 || identity.postgres_version >= 170000 ||
      identity.current_user !== identity.session_user) {
      deny("UNAUTHORIZED", "unsupported PG version or operator session identity");
    }
    const installation = (await db.query<InstallationRow>(
      "SELECT i.id, i.application_id, i.environment, " +
      "(SELECT count(*)::int FROM public.platform_installations) AS total " +
      "FROM public.platform_installations i WHERE i.id = $1 FOR SHARE",
      [request.installationId],
    )).rows[0];
    if (!installation || installation.total !== 1 ||
      (installation.environment !== "test" && installation.environment !== "development")) {
      deny("UNAUTHORIZED", "installation is not an exclusive nonproduction database");
    }
    const registry = (await db.query<RegistryRow>(
      "SELECT * FROM public.platform_schema_registry WHERE installation_id = $1 FOR UPDATE",
      [request.installationId],
    )).rows[0];
    if (!registry || registry.application_id !== installation.application_id ||
      registry.environment !== installation.environment ||
      registry.database_name !== identity.database_name ||
      registry.operator_role !== identity.current_user ||
      registry.runtime_role === identity.current_user) {
      deny("UNAUTHORIZED", "registry identity/environment/database binding failed");
    }
    const planRecord = (await db.query<PlanRow>(
      "SELECT * FROM public.platform_schema_plans " +
      "WHERE installation_id = $1 AND plan_digest = $2 FOR SHARE",
      [request.installationId, request.planDigest],
    )).rows[0];
    if (!planRecord || planRecord.plan_digest !== request.planDigest) {
      deny("UNAUTHORIZED", "operator plan was not registered");
    }
    const scope = {
      applicationId: asApplicationId(registry.application_id),
      installationId: asInstallationId(registry.installation_id),
    };
    const validated = renderTrustedAdditiveColumn(
      JSON.parse(planRecord.plan), JSON.parse(planRecord.expected_manifest), scope);
    const { plan, current, ddl } = validated;
    if (plan.digest !== request.planDigest || plan.operations.length !== 1 ||
      current.applicationId !== scope.applicationId ||
      current.installationId !== scope.installationId) {
      deny("UNAUTHORIZED", "registered plan did not rehydrate");
    }
    const approval = (await db.query<ApprovalRow>(
      "SELECT operation_id, approver, operator_role, environment, " +
      "approved_at, expires_at, revoked_at, clock_timestamp() AS server_now " +
      "FROM public.platform_schema_approvals " +
      "WHERE installation_id = $1 AND plan_digest = $2 AND operation_id = $3 FOR SHARE",
      [request.installationId, request.planDigest, ddl.operationId],
    )).rows[0];
    if (!approval || approval.approver === planRecord.author ||
      approval.approver === identity.current_user ||
      approval.operator_role !== identity.current_user ||
      approval.environment !== registry.environment ||
      approval.revoked_at !== null ||
      approval.approved_at > approval.server_now ||
      approval.expires_at <= approval.server_now) {
      deny("UNAUTHORIZED", "independent plan approval is absent, revoked or expired");
    }
    const resource = current.resources.find(item => item.tableName === ddl.tableName);
    const next = plan.proposedManifest.resources.find(item => item.tableName === ddl.tableName);
    if (!resource || !next) deny("UNSUPPORTED", "resource mapping is unavailable");
    const oid = await assertAuthority(db, identity, registry, resource);
    const journal = (await db.query<JournalRow>(
      "SELECT plan_digest, previous_digest, new_digest, operator_role, status " +
      "FROM public.platform_schema_migration_journal " +
      "WHERE installation_id = $1 AND operation_id = $2 FOR UPDATE",
      [request.installationId, ddl.operationId],
    )).rows[0];
    if (journal) {
      if (journal.plan_digest !== request.planDigest ||
        journal.previous_digest !== current.digest ||
        journal.new_digest !== plan.proposedManifest.digest ||
        journal.operator_role !== identity.current_user ||
        journal.status !== "COMPLETED" ||
        registry.manifest_digest !== plan.proposedManifest.digest) {
        deny("JOURNAL_CONFLICT", "migration journal or expected schema does not match");
      }
      await verifyCatalog(db, oid, next);
      const afterRows = await rowCount(db, ddl.tableName);
      await db.query("COMMIT");
      began = false;
      return {
        status: "ALREADY_APPLIED", installationId: request.installationId,
        operationId: ddl.operationId, planDigest: request.planDigest,
        previousDigest: current.digest, newDigest: plan.proposedManifest.digest,
        beforeRows: afterRows, afterRows,
      };
    }
    if (registry.manifest_digest !== current.digest ||
      registry.manifest !== JSON.stringify(current)) {
      deny("STALE_PLAN", "accepted manifest differs from trusted plan precondition");
    }
    await verifyCatalog(db, oid, resource);
    const beforeRows = await rowCount(db, ddl.tableName);
    await db.query(ddl.sql);
    await verifyCatalog(db, oid, next);
    const afterRows = await rowCount(db, ddl.tableName);
    if (beforeRows !== afterRows) deny("CATALOG_DRIFT", "additive operation changed row count");
    const update = await db.query(
      "UPDATE public.platform_schema_registry SET manifest = $1, " +
      "manifest_digest = $2, updated_at = clock_timestamp() " +
      "WHERE installation_id = $3 AND manifest_digest = $4",
      [JSON.stringify(plan.proposedManifest), plan.proposedManifest.digest,
        request.installationId, current.digest],
    );
    if (update.rowCount !== 1) deny("STALE_PLAN", "manifest compare-and-swap failed");
    await db.query(
      "INSERT INTO public.platform_schema_migration_journal " +
      "(installation_id,operation_id,plan_digest,previous_digest,new_digest,authorization_ref," +
      "operator_role,status,started_at,completed_at,catalog_evidence) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETED',transaction_timestamp()," +
      "clock_timestamp(),$8::jsonb)",
      [
        request.installationId, ddl.operationId, request.planDigest,
        current.digest, plan.proposedManifest.digest,
        approval.approver + ":" + approval.approved_at.toISOString(),
        identity.current_user,
        JSON.stringify({ operation: "ADD_FIELD", table: ddl.tableName,
          column: ddl.columnName, beforeRows, afterRows, postgres: 16 }),
      ],
    );
    commitAttempted = true;
    await db.query("COMMIT");
    began = false;
    return {
      status: "APPLIED", installationId: request.installationId,
      operationId: ddl.operationId, planDigest: request.planDigest,
      previousDigest: current.digest, newDigest: plan.proposedManifest.digest,
      beforeRows, afterRows,
    };
  } catch (error) {
    if (began && !commitAttempted) {
      try {
        await db.query("ROLLBACK");
      } catch {
        deny("INDETERMINATE", "rollback failed; discard the operator connection and reconcile journal");
      }
    }
    if (commitAttempted) {
      deny("INDETERMINATE", "commit outcome unknown; reconcile registry and journal on a fresh connection");
    }
    if (error instanceof SchemaMigrationOperatorError) throw error;
    // No SQL, credentials, tenant data, driver details or stack in external errors.
    deny("UNAUTHORIZED", "operator verification or execution failed; inspect sanitized audit");
  }
}
