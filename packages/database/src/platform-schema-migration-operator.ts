import type { ClientBase } from "pg";
import { inspectSchemaOperatorEffectivePrivileges } from "./platform-schema-effective-privileges";
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
  author_login: string | null;
  author_principal_id: string | null;
  author_application_id: string | null;
  author_environment: string | null;
}
interface FinalApprovalDecision {
  approved_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  checked_at: Date;
}
interface ApprovalRow {
  operation_id: string;
  approver: string;
  approver_login: string | null;
  approver_principal_id: string | null;
  approved_application_id: string | null;
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
  operator_schema_create: boolean;
  operator_database_create: boolean;
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
    "has_database_privilege($1, current_database(), 'CREATE') AS runtime_database_create, " +
    "has_schema_privilege($2, 'public', 'CREATE') AS operator_schema_create, " +
    "has_database_privilege($2, current_database(), 'CREATE') AS operator_database_create " +
    "FROM pg_roles op WHERE op.rolname = $2",
    [registry.runtime_role, identity.current_user],
  );
  const role = roleResult.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb ||
    role.rolcreaterole || role.rolreplication || !role.rolcanlogin ||
    role.operator_member || role.runtime_member ||
    role.runtime_schema_create || role.runtime_database_create ||
    role.operator_schema_create || role.operator_database_create) {
    deny("UNAUTHORIZED", "effective operator/runtime role authority is unsafe");
  }
  const runtime = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
    [registry.runtime_role],
  );
  if (!runtime.rows[0] || runtime.rows[0].rolsuper || runtime.rows[0].rolbypassrls) {
    deny("UNAUTHORIZED", "runtime role can bypass database policy");
  }
  const effective = await inspectSchemaOperatorEffectivePrivileges(
    db, registry.runtime_role, identity.current_user,
  );
  if (effective.reachableSecurityDefinerCount !== 0 ||
    effective.roleMembershipCount !== 0 ||
    effective.unsafeSchemaAuthorityCount !== 0 ||
    effective.runtimeRelationOwnershipCount !== 0 ||
    effective.unsafeDatabaseOwnershipCount !== 0) {
    deny("UNAUTHORIZED", "runtime/operator effective PostgreSQL authority is unsafe");
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
  const tablePrivileges = await db.query<{ can_truncate: boolean; can_reference: boolean; can_trigger: boolean }>(
    "SELECT has_table_privilege($1, $2::oid, 'TRUNCATE') AS can_truncate, " +
    "has_table_privilege($1, $2::oid, 'REFERENCES') AS can_reference, " +
    "has_table_privilege($1, $2::oid, 'TRIGGER') AS can_trigger",
    [registry.runtime_role, found.oid],
  );
  const privileges = tablePrivileges.rows[0];
  if (!privileges || privileges.can_truncate || privileges.can_reference || privileges.can_trigger) {
    deny("UNAUTHORIZED", "runtime has privileged table operations");
  }
  const unexpected = await db.query<{ count: number }>(
    "SELECT (SELECT count(*) FROM pg_constraint WHERE conrelid = $1::oid) + " +
    "(SELECT count(*) FROM pg_trigger WHERE tgrelid = $1::oid AND NOT tgisinternal) + " +
    "(SELECT count(*) FROM pg_index WHERE indrelid = $1::oid) + " +
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
    await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
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
      "FROM public.platform_installations i WHERE i.id = $1",
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
      "WHERE installation_id = $1 AND plan_digest = $2",
      [request.installationId, request.planDigest],
    )).rows[0];
    if (!planRecord || planRecord.plan_digest !== request.planDigest ||
      !planRecord.author_login || !planRecord.author_principal_id ||
      planRecord.author !== planRecord.author_login ||
      planRecord.author_application_id !== registry.application_id ||
      planRecord.author_environment !== registry.environment) {
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
    // SERIALIZED AUTHORIZATION BOUNDARY: this advisory transaction lock must
    // be acquired before the approval read. The 0060 approval DML trigger
    // takes the identical key on INSERT/UPDATE/DELETE, including misgranted
    // direct DML. With READ COMMITTED the following statement sees the most
    // recently committed revocation. No approval UPDATE ACL is granted.
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_approval'), " +
      "hashtext($1::text || ':' || $2::text || ':' || $3::text))",
      [request.installationId, request.planDigest, ddl.operationId],
    );
    const approval = (await db.query<ApprovalRow>(
      "SELECT operation_id, approver, approver_login, approver_principal_id, " +
      "approved_application_id, operator_role, environment, " +
      "approved_at, expires_at, revoked_at, clock_timestamp() AS server_now " +
      "FROM public.platform_schema_approvals " +
      "WHERE installation_id = $1 AND plan_digest = $2 AND operation_id = $3",
      [request.installationId, request.planDigest, ddl.operationId],
    )).rows[0];
    if (!approval || !approval.approver_login || !approval.approver_principal_id ||
      approval.approver !== approval.approver_login ||
      approval.approved_application_id !== registry.application_id ||
      approval.approver_login === planRecord.author_login ||
      approval.approver_principal_id === planRecord.author_principal_id ||
      approval.approver === planRecord.author ||
      approval.approver === identity.current_user ||
      approval.operator_role !== identity.current_user ||
      approval.environment !== registry.environment ||
      approval.revoked_at !== null ||
      approval.approved_at > approval.server_now ||
      approval.expires_at <= approval.server_now) {
      deny("UNAUTHORIZED", "independent plan approval is absent, revoked or expired");
    }
    // The owner-provisioned identity registry is trusted only for individually
    // authenticated PostgreSQL logins; pooled service accounts are not humans.
    // Legacy 0059 approvals without captured provenance always fail closed.
    const actors = await db.query<{
      login_name: string; principal_id: string; actor_kind: string;
      identity_mode: string; active: boolean;
    }>(
      "SELECT login_name, principal_id, actor_kind, identity_mode, active " +
      "FROM public.platform_schema_trusted_actors " +
      "WHERE login_name = $1 OR login_name = $2",
      [planRecord.author_login, approval.approver_login],
    );
    const authored = actors.rows.find(row => row.login_name === planRecord.author_login);
    const approved = actors.rows.find(row => row.login_name === approval.approver_login);
    if (!authored || !approved || actors.rows.length !== 2 ||
      authored.principal_id !== planRecord.author_principal_id ||
      approved.principal_id !== approval.approver_principal_id ||
      authored.actor_kind !== "AUTHOR" || approved.actor_kind !== "APPROVER" ||
      authored.identity_mode !== "INDIVIDUAL_DATABASE_LOGIN" ||
      approved.identity_mode !== "INDIVIDUAL_DATABASE_LOGIN" ||
      !authored.active || !approved.active) {
      deny("UNAUTHORIZED", "trusted independent approval provenance unavailable");
    }
    const resource = current.resources.find(item => item.tableName === ddl.tableName);
    const next = plan.proposedManifest.resources.find(item => item.tableName === ddl.tableName);
    if (!resource || !next) deny("UNSUPPORTED", "resource mapping is unavailable");
    // AG06-S03-03: advisory locks only synchronize cooperating operators.
    // ACCESS EXCLUSIVE is the same table-level mode taken by ADD COLUMN and
    // excludes noncooperating ALTER/CREATE TRIGGER/DROP until COMMIT/ROLLBACK.
    // Bound waiting via SET LOCAL lock_timeout above. This happens BEFORE the
    // first authoritative table/catalog inspection; READ COMMITTED rechecks
    // after any DDL that committed while this lock was being acquired.
    if (resource.tableName !== ddl.tableName ||
      !/^vr_[a-z0-9_]+_[a-f0-9]{12}$/.test(ddl.tableName)) {
      deny("CATALOG_DRIFT", "compiled target table identity is invalid");
    }
    await db.query(
      'LOCK TABLE ONLY "public".' + db.escapeIdentifier(ddl.tableName) +
      " IN ACCESS EXCLUSIVE MODE",
    );
    const oid = await assertAuthority(db, identity, registry, resource);
    const journal = (await db.query<JournalRow>(
      "SELECT plan_digest, previous_digest, new_digest, operator_role, status " +
      "FROM public.platform_schema_migration_journal " +
      "WHERE installation_id = $1 AND operation_id = $2",
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

    // EXPERIMENTAL P05/R1 ONLY: cooperative transaction advisory fencing.
    // PostgreSQL SELECT FOR SHARE would require UPDATE privilege on this
    // owner-controlled roster and MUST NOT be granted to the operator.
    // The disposable-only fixture installs a nonprivileged BEFORE actor-
    // mutation trigger that acquires the SAME per-login advisory xact key.
    // This permits a read-only operator to serialize final actor state
    // without actor DML/ownership rights. The trigger is NOT in 0059/0060;
    // normative adoption needs human IAM/DBA + migration/lock-order approval.
    for (const actorLogin of [planRecord.author_login, approval.approver_login].sort()) {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_actor'), " +
        "hashtext($1::text))",
        [actorLogin],
      );
      const expectedAuthor = actorLogin === planRecord.author_login;
      const row = await db.query<{
        login_name: string; principal_id: string; actor_kind: string;
        identity_mode: string; active: boolean;
      }>(
        "SELECT login_name, principal_id, actor_kind, identity_mode, active " +
        "FROM public.platform_schema_trusted_actors WHERE login_name = $1",
        [actorLogin],
      );
      const actor = row.rows[0];
      if (row.rows.length !== 1 || !actor || !actor.active ||
          actor.login_name !== actorLogin ||
          actor.principal_id !== (expectedAuthor ?
            planRecord.author_principal_id : approval.approver_principal_id) ||
          actor.actor_kind !== (expectedAuthor ? "AUTHOR" : "APPROVER") ||
          actor.identity_mode !== "INDIVIDUAL_DATABASE_LOGIN") {
        deny("UNAUTHORIZED", "trusted actor changed before final DDL authorization");
      }
    }

    // Proposed Policy A (owner approval pending): expiry linearizes at the
    // last database-observed authorization read, AFTER all potentially blocking
    // target-lock waits and catalog/row checks, IMMEDIATELY BEFORE DDL.
    // clock_timestamp() is fresh wall time, not BEGIN/statement time.
    // The existing approval xact advisory lock is held until COMMIT, so any
    // competing revocation must finish before this decision or wait until
    // the migration commits/rolls back. No intervening external await.
    const finalApproval = (await db.query<FinalApprovalDecision>(
      "SELECT approved_at, expires_at, revoked_at, clock_timestamp() AS checked_at " +
      "FROM public.platform_schema_approvals " +
      "WHERE installation_id = $1 AND plan_digest = $2 AND operation_id = $3",
      [request.installationId, request.planDigest, ddl.operationId],
    )).rows[0];
    if (!finalApproval || finalApproval.revoked_at !== null ||
      finalApproval.approved_at > finalApproval.checked_at ||
      finalApproval.expires_at <= finalApproval.checked_at ||
      finalApproval.approved_at.getTime() !== approval.approved_at.getTime() ||
      finalApproval.expires_at.getTime() !== approval.expires_at.getTime()) {
      deny("UNAUTHORIZED", "approval expired or changed before final DDL authorization");
    }
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
        approval.approver_principal_id + ":" + approval.approver_login + ":" +
          approval.approved_at.toISOString(),
        identity.current_user,
        JSON.stringify({ operation: "ADD_FIELD", table: ddl.tableName,
          column: ddl.columnName, beforeRows, afterRows, postgres: 16,
          finalAuthorizedAt: finalApproval.checked_at.toISOString(),
          authorizationPolicy: "FINAL_PRE_DDL" }),
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
