import type { ClientBase } from "pg";
import { ExperimentalD1Budget, D1DeadlineExceeded } from "./schema-operator-experimental-deadline";
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
    | "JOURNAL_CONFLICT" | "INDETERMINATE" | "LOCK_NOT_AVAILABLE"
    | "DEADLOCK" | "QUERY_CANCELED" | "DATABASE_PRIVILEGE_FAILURE"
    | "DEADLINE_EXCEEDED" | "VERIFIED_ROLLBACK" | "OPERATION_FAILED", reason: string) {
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
interface PlanRow { plan_digest: string; expected_manifest: string; plan: string; }
interface AuthorizationRow { author_login: string; author_principal: string; approver_login: string; approver_principal: string; }
interface CompletedRow {
  submission_id: string; approval_id: string; canonical_plan_digest: string;
  previous_digest: string; new_digest: string; operator_role: string;
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
  readonly operationId: string;
  readonly submissionId: string;
  readonly approvalId: string;
  readonly envelopeVersion: 1;
}
export interface SchemaOperatorResult {
  readonly status: "APPLIED" | "ALREADY_APPLIED" | "COMMITTED_LATE" | "ALREADY_APPLIED_LATE";
  readonly installationId: string;
  readonly operationId: string;
  readonly planDigest: string;
  readonly previousDigest: string;
  readonly newDigest: string;
  readonly beforeRows: string;
  readonly afterRows: string;
}

const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
export function executeApprovedAdditiveColumn(
  db: ClientBase, request: SchemaOperatorRequest, budget: ExperimentalD1Budget,
): Promise<SchemaOperatorResult> {
  return runP06(db,request,budget,"EXECUTE");
}

/** Reconcile only, on a fresh dedicated session. Absence of evidence never dispatches DDL. */
export function reconcileApprovedAdditiveColumn(
  db: ClientBase, request: SchemaOperatorRequest, budget: ExperimentalD1Budget,
): Promise<SchemaOperatorResult> {
  return runP06(db,request,budget,"RECONCILE");
}

async function runP06(
  db: ClientBase,
  request: SchemaOperatorRequest,
  budget: ExperimentalD1Budget,
  mode: "EXECUTE" | "RECONCILE",
): Promise<SchemaOperatorResult> {
  if (!request || request.envelopeVersion !== 1 ||
      !INSTALLATION.test(request.installationId) || !SHA.test(request.planDigest) ||
      ![request.operationId,request.submissionId,request.approvalId].every(v => typeof v === "string" && UUID.test(v)) ||
      !(budget instanceof ExperimentalD1Budget)) {
    return deny("UNAUTHORIZED", "complete P06 identity and D1 budget required");
  }
  const rawDb = db;
  let transactionActive = false;
  let finalCheckCompleted = false;
  async function refreshTimeout(): Promise<void> {
    budget.checkpoint();
    const remaining = Math.max(1,Math.floor(budget.remainingMs()));
    await rawDb.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
      [String(Math.min(2000,remaining))+"ms",String(remaining)+"ms"]);
    budget.checkpoint();
  }
  db = new Proxy(rawDb, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === "query" && typeof value === "function") {
        return async (...args: unknown[]) => {
          budget.checkpoint();
          // Refresh before blocking stages, but never issue SQL between final Policy A
          // authorization and DDL dispatch. This is not a hard cancellation guarantee.
          if (transactionActive && !finalCheckCompleted) await refreshTimeout();
          finalCheckCompleted=false;
          budget.checkpoint();
          return Reflect.apply(value,target,args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let began = false;
  let commitAttempted = false;
  try {
    await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    began = true;
    transactionActive=true;
    await refreshTimeout();
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
      identity.current_user !== identity.session_user ||
        !/^vibress_s03_[a-z0-9_]+$/.test(identity.database_name)) {
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
      "SELECT plan_digest,expected_manifest,plan FROM public.platform_schema_plans WHERE installation_id=$1 AND plan_digest=$2",
      [request.installationId,request.planDigest],
    )).rows[0];
    if (!planRecord || planRecord.plan_digest !== request.planDigest) deny("UNAUTHORIZED","canonical plan unavailable");
    const scope = {applicationId:asApplicationId(registry.application_id),installationId:asInstallationId(registry.installation_id)};
    let validated: ReturnType<typeof renderTrustedAdditiveColumn>;
    try { validated=renderTrustedAdditiveColumn(JSON.parse(planRecord.plan),JSON.parse(planRecord.expected_manifest),scope); }
    catch { return deny("UNAUTHORIZED","canonical plan failed independent rehydration"); }
    const {plan,current,ddl}=validated;
    if (plan.digest!==request.planDigest || plan.operations.length!==1 ||
        current.applicationId!==scope.applicationId || current.installationId!==scope.installationId) {
      deny("UNAUTHORIZED","canonical plan digest or scope mismatch");
    }
    await db.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_p06_approval'),hashtext($1::text))",[request.approvalId]);
    const auth=(await db.query<AuthorizationRow>(
      "SELECT s.author_login,s.author_principal,a.approver_login,a.approver_principal "+
      "FROM public.s03_p06_submissions s JOIN public.s03_p06_approvals a USING(submission_id) "+
      "WHERE s.installation_id=$1 AND s.canonical_plan_digest=$2 AND s.operation_id=$3::uuid "+
      "AND s.submission_id=$4::uuid AND a.approval_id=$5::uuid",
      [request.installationId,request.planDigest,request.operationId,request.submissionId,request.approvalId],
    )).rows[0];
    if (!auth || auth.author_login===auth.approver_login || auth.author_principal===auth.approver_principal ||
        [auth.author_login,auth.approver_login].some(login=>login===registry.operator_role||login===registry.runtime_role)) {
      deny("UNAUTHORIZED","independent P06 authorization unavailable");
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
    const journal=(await db.query<CompletedRow>(
      "SELECT submission_id,approval_id,canonical_plan_digest,previous_digest,new_digest,operator_role "+
      "FROM public.s03_p06_completed_operations WHERE installation_id=$1 AND operation_id=$2::uuid",
      [request.installationId,request.operationId],
    )).rows[0];
    if (journal) {
      if (journal.submission_id!==request.submissionId || journal.approval_id!==request.approvalId ||
        journal.canonical_plan_digest!==request.planDigest || journal.previous_digest!==current.digest ||
        journal.new_digest!==plan.proposedManifest.digest || journal.operator_role!==identity.current_user ||
        registry.manifest_digest!==plan.proposedManifest.digest || registry.manifest!==JSON.stringify(plan.proposedManifest)) {
        deny("JOURNAL_CONFLICT","completed operation or registry mismatch");
      }
      await verifyCatalog(db,oid,next);
      const afterRows=await rowCount(db,ddl.tableName);
      budget.checkpoint();
      commitAttempted=true;
      const commitResult=await rawDb.query("COMMIT");
      began=false;
      if (commitResult.command==="ROLLBACK") {commitAttempted=false;deny("VERIFIED_ROLLBACK","server acknowledged rollback");}
      if (commitResult.command!=="COMMIT") deny("INDETERMINATE","unexpected commit response");
      return {installationId:request.installationId,operationId:request.operationId,planDigest:request.planDigest,
        previousDigest:current.digest,newDigest:plan.proposedManifest.digest,beforeRows:afterRows,afterRows,
        status:budget.expired()?"ALREADY_APPLIED_LATE":"ALREADY_APPLIED"};
    }
    if (mode === "RECONCILE") {
      deny("INDETERMINATE", "no matching completed operation; preserve fence and investigate before retry");
    }
    if (registry.manifest_digest !== current.digest ||
      registry.manifest !== JSON.stringify(current)) {
      deny("STALE_PLAN", "accepted manifest differs from trusted plan precondition");
    }
    await verifyCatalog(db, oid, resource);
    const beforeRows = await rowCount(db, ddl.tableName);

    // Acquire actual advisory keys in numeric order, after target-table and catalog locks.
    const keys=await db.query<{k:number}>("SELECT DISTINCT hashtext(v) AS k FROM unnest($1::text[]) AS x(v) ORDER BY k",
      [[auth.author_login,auth.approver_login]]);
    for (const key of keys.rows) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_actor'),$1::int)",[key.k]);
    }
    // One fresh server timestamp, exact identity tuple, actor fences and approval fence held until COMMIT.
    const final=(await db.query<{checked_at:Date}>(
      "WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS checked_at) "+
      "SELECT stamp.checked_at FROM public.s03_p06_submissions s JOIN public.s03_p06_approvals a USING(submission_id) "+
      "JOIN public.platform_schema_trusted_actors u ON u.login_name=s.author_login "+
      "JOIN public.platform_schema_trusted_actors v ON v.login_name=a.approver_login CROSS JOIN stamp "+
      "WHERE s.installation_id=$1 AND s.canonical_plan_digest=$2 AND s.operation_id=$3::uuid "+
      "AND s.submission_id=$4::uuid AND a.approval_id=$5::uuid "+
      "AND u.active AND v.active AND u.actor_kind='AUTHOR' AND v.actor_kind='APPROVER' "+
      "AND u.identity_mode='INDIVIDUAL_DATABASE_LOGIN' AND v.identity_mode='INDIVIDUAL_DATABASE_LOGIN' "+
      "AND u.principal_id=s.author_principal AND v.principal_id=a.approver_principal "+
      "AND u.actor_instance_id=s.author_instance AND u.actor_generation=s.author_generation "+
      "AND v.actor_instance_id=a.approver_instance AND v.actor_generation=a.approver_generation "+
      "AND s.author_login<>a.approver_login AND s.author_principal<>a.approver_principal "+
      "AND a.approved_at<=stamp.checked_at AND a.expires_at>stamp.checked_at "+
      "AND NOT EXISTS(SELECT 1 FROM public.s03_p06_revocations z WHERE z.approval_id=a.approval_id)",
      [request.installationId,request.planDigest,request.operationId,request.submissionId,request.approvalId],
    )).rows[0];
    if (!final) deny("UNAUTHORIZED","final P06 authorization stale, revoked, expired or invalid");
    finalCheckCompleted=true;
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
      "INSERT INTO public.s03_p06_completed_operations "+
      "(installation_id,operation_id,submission_id,approval_id,canonical_plan_digest,previous_digest,new_digest,"+
      "operator_role,final_authorized_at,catalog_evidence) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::jsonb)",
      [request.installationId,request.operationId,request.submissionId,request.approvalId,request.planDigest,
       current.digest,plan.proposedManifest.digest,identity.current_user,final.checked_at,
       JSON.stringify({operation:"ADD_FIELD",table:ddl.tableName,column:ddl.columnName,beforeRows,afterRows,
         postgres:16,authorizationPolicy:"FINAL_PRE_DDL",envelopeVersion:1})],
    );
    // Refresh before COMMIT, without selecting an unapproved numeric margin.
    await refreshTimeout();
    budget.checkpoint();
    commitAttempted = true;
    const commitResult = await rawDb.query("COMMIT");
    began = false;
    if (commitResult.command === "ROLLBACK") {
      commitAttempted = false;
      deny("VERIFIED_ROLLBACK", "server acknowledged rollback instead of commit");
    }
    if (commitResult.command !== "COMMIT") deny("INDETERMINATE", "unexpected commit response; reconcile before retry");
    return {
      installationId: request.installationId, operationId: request.operationId,planDigest: request.planDigest,
      previousDigest: current.digest,newDigest: plan.proposedManifest.digest,
      beforeRows, afterRows,status: budget.expired() ? "COMMITTED_LATE" : "APPLIED",
    };
  } catch (error) {
    if (began && !commitAttempted) {
      try {
        const rolled=await rawDb.query("ROLLBACK");
        if (rolled.command!=="ROLLBACK") deny("INDETERMINATE","rollback response unexpected");
      } catch {
        deny("INDETERMINATE", "rollback failed; discard the operator connection and reconcile journal");
      }
    }
    if (commitAttempted) {
      deny("INDETERMINATE", "commit outcome unknown; reconcile registry and journal on a fresh connection");
    }
    if (error instanceof SchemaMigrationOperatorError) throw error;
    if (error instanceof D1DeadlineExceeded) {
      deny("DEADLINE_EXCEEDED", "operation budget expired before dispatch; no further operation SQL sent");
    }
    // Never expose driver messages, SQL, credentials, or stack traces.
    const sqlstate = typeof error === "object" && error !== null && "code" in error
      ? error.code : undefined;
    switch (sqlstate) {
      case "55P03": return deny("LOCK_NOT_AVAILABLE", "database lock not available; transaction rolled back");
      case "40P01": return deny("DEADLOCK", "database deadlock; transaction rolled back");
      case "57014": return deny("QUERY_CANCELED", "database query canceled; transaction rolled back");
      case "42501": return deny("DATABASE_PRIVILEGE_FAILURE", "database privilege or configuration failure; inspect sanitized audit");
      default: return deny("OPERATION_FAILED", "operator execution failed; inspect sanitized audit");
    }
  }
}
