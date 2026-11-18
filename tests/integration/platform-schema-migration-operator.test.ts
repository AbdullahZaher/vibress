// @vitest-environment node
import { randomBytes, randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { RecoveryEpochAuthority, recoveryEpochMessage, type RecoveryEpochChallenge, type RecoveryEpochProof, type RecoveryEpochState } from "../../packages/database/src/schema-operator-experimental-recovery-epoch";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { migrateDisposableSchemaCandidate } from "../../packages/database/src/__tests__/fixtures/m03-s03-experimental-migrator";
import { superviseDisposableSchemaOperation } from "../../packages/database/src/schema-operator-experimental-supervisor";
import { startCommitAckDropProxy, startTransactionAckFaultProxy } from "../../scripts/platform/m03-s03-fault/pg-wire-proxy";
import path from "node:path";
import { Client, type ClientBase } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  createSchemaManifest,
  planSchemaChanges,
} from "../../packages/schema-engine/src";
import { executeApprovedAdditiveColumn } from "../fixtures/m03-s03-legacy-operator-diagnostic";
import { executeApprovedAdditiveColumn as executeP06Raw,reconcileApprovedAdditiveColumn as reconcileP06Raw,type SchemaOperatorRequest } from "../../packages/database/src/platform-schema-migration-operator";
import { ExperimentalD1Budget } from "../../packages/database/src/schema-operator-experimental-deadline";
import { ExperimentalSessionLifecycle } from "../../packages/database/src/schema-operator-experimental-session";

/** Controlled PG16 fixture: real DDL only in two fresh localhost-only databases. */
const BASE_URL = process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const id = randomBytes(4).toString("hex");
const applicationId = asApplicationId("s03-crm");
const password = "disposable_" + id;

type Key = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "aa" | "ab" | "ac" | "ad" | "ae" | "af" | "ag" | "ah" | "ai" | "aj" | "ak" | "al" | "am" | "an" | "ao" | "ap" | "aq" | "ar" | "as" | "at" | "au" | "av" | "aw" | "ax" | "ay" | "az" | "ba" | "bb" | "bc" | "bd" | "be" | "bf" | "bg" | "bh" | "bi" | "bj" | "bk" | "bl" | "bm" | "bn" | "bo" | "bp" | "bq" | "br" | "bs" | "bt";
interface Lab {
  readonly key: Key;
  readonly name: string;
  readonly installationId: ReturnType<typeof asInstallationId>;
  readonly author: string;
  readonly approver: string;
  readonly operatorRole: string;
  readonly runtimeRole: string;
  readonly table: string;
  readonly current: ReturnType<typeof createSchemaManifest>;
  readonly plan: ReturnType<typeof planSchemaChanges>;
  readonly dbAdmin: Client;
  readonly operator: Client;
  readonly runtime: Client;
}
const labs: Lab[] = [];
let cluster: Client;
// External authority is deliberately outside all disposable databases. The
// signing key is ephemeral and never printed or persisted in a DB dump.
const epochKeys = generateKeyPairSync("ed25519");
const labEpochs = new Map<string, string>();
const labRecoveryPending = new Set<string>();
function proofFor(challenge: RecoveryEpochChallenge, epoch: string, state: RecoveryEpochState = "ACTIVE"): RecoveryEpochProof {
  return { ...challenge, epoch, state, signature: sign(null, recoveryEpochMessage(challenge, epoch, state),
    epochKeys.privateKey).toString("base64url") };
}
const labRecoveryAuthority = new RecoveryEpochAuthority(epochKeys.publicKey, async challenge => {
  const epoch = labEpochs.get(challenge.installationId + ":" + challenge.databaseName);
  if (!epoch) throw Error("lab recovery authority unavailable");
  return proofFor(challenge, epoch, labRecoveryPending.has(challenge.installationId+":"+challenge.databaseName)
    ? "RECOVERY_PENDING" : "ACTIVE");
});
function executeP06(db: ClientBase, request: SchemaOperatorRequest, budget: ExperimentalD1Budget) {
  return executeP06Raw(db, request, budget, labRecoveryAuthority);
}
function reconcileP06(db: ClientBase, request: SchemaOperatorRequest, budget: ExperimentalD1Budget) {
  return reconcileP06Raw(db, request, budget, labRecoveryAuthority);
}

function urlFor(database: string, role?: string): string {
  const url = new URL(BASE_URL);
  url.pathname = "/" + database;
  if (role) {
    url.username = role;
    url.password = password;
  }
  return url.toString();
}

async function connect(database: string, role?: string): Promise<Client> {
  const client = new Client({
    connectionString: urlFor(database, role),
    connectionTimeoutMillis: 4000,
  });
  await client.connect();
  return client;
}

async function createLab(key: Key, installE2 = true): Promise<Lab> {
  const name = "vibress_s03_" + key + "_" + id;
  const installationId = asInstallationId("s03-" + key);
  const author = "s03_author_" + key + "_" + id;
  const approver = "s03_approver_" + key + "_" + id;
  const operatorRole = "s03_operator_" + key + "_" + id;
  const runtimeRole = "s03_runtime_" + key + "_" + id;
  for (const role of [author, approver, operatorRole, runtimeRole]) {
    await cluster.query("CREATE ROLE " + cluster.escapeIdentifier(role) +
      " LOGIN PASSWORD " + cluster.escapeLiteral(password) +
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  }
  await cluster.query("CREATE DATABASE " + cluster.escapeIdentifier(name));
  await cluster.query("REVOKE CONNECT ON DATABASE " +
    cluster.escapeIdentifier(name) + " FROM PUBLIC");
  for (const role of [author, approver, operatorRole, runtimeRole]) {
    await cluster.query("GRANT CONNECT ON DATABASE " + cluster.escapeIdentifier(name) +
      " TO " + cluster.escapeIdentifier(role));
  }
  const dbAdmin = await connect(name);
  const schema = readFileSync(path.resolve(
    process.cwd(), "packages/database/migrations/0059_platform_schema_execution_registry.sql"), "utf8");
  await dbAdmin.query(
    "CREATE TABLE platform_applications (id text PRIMARY KEY, name text NOT NULL);" +
    "CREATE TABLE platform_installations (id text PRIMARY KEY, application_id text NOT NULL " +
    "REFERENCES platform_applications(id), environment text NOT NULL);",
  );
  await dbAdmin.query(schema);
  await dbAdmin.query(readFileSync(path.resolve(process.cwd(),
    "packages/database/migrations/0060_platform_schema_authenticated_approvals.sql"), "utf8"));
  // Reuse the identical disposable-only PostgreSQL actor fence as fault harness.
  await dbAdmin.query(readFileSync(path.resolve(process.cwd(),
    "tests/fixtures/m03-s03-r1-actor-fence-experimental.sql"), "utf8"));
  // E2-A is ONLY a disposable test fixture, not a numbered migration and not
  // an approved real actor reactivation policy. 0059/0060 remain unchanged.
  if (installE2) {
    await dbAdmin.query(readFileSync(path.resolve(process.cwd(),
      "tests/fixtures/m03-s03-e2-actor-generation-experimental.sql"), "utf8"));
  }
  await dbAdmin.query(
    "INSERT INTO platform_applications (id,name) VALUES ($1,$2)",
    [applicationId, "Fixture CRM"],
  );
  await dbAdmin.query(
    "INSERT INTO platform_installations (id,application_id,environment) VALUES ($1,$2,'test')",
    [installationId, applicationId],
  );
  const scope = { applicationId, installationId };
  const resource = (hasWebsite: boolean) => ({
    ...scope, id: "catalog", ownership: "application" as const,
    fields: [
      { id: "name", type: "text" as const, required: true },
      ...(hasWebsite ? [{ id: "website", type: "text" as const, required: false }] : []),
    ],
  });
  const before = compileResourceSchema([resource(false)], scope);
  const after = compileResourceSchema([resource(true)], scope);
  const current = createSchemaManifest(before);
  const plan = planSchemaChanges(current, after, {
    scope, expectedCurrentDigest: current.digest,
  });
  const table = current.resources[0]?.tableName;
  if (!table) throw new Error("missing compiled physical table");
  const qualified = '"public".' + dbAdmin.escapeIdentifier(table);
  await dbAdmin.query("CREATE TABLE " + qualified + ' ("name" text NOT NULL)');
  await dbAdmin.query("ALTER TABLE " + qualified + " OWNER TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("INSERT INTO " + qualified + '("name") VALUES ($1),($2)',
    ["Alice", "Bob"]);
  await dbAdmin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  for (const role of [author, approver, operatorRole, runtimeRole]) {
    await dbAdmin.query("GRANT USAGE ON SCHEMA public TO " +
      dbAdmin.escapeIdentifier(role));
  }
  await dbAdmin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON " + qualified +
    " TO " + dbAdmin.escapeIdentifier(runtimeRole));
  await dbAdmin.query("GRANT SELECT ON platform_installations," +
    "platform_schema_registry,platform_schema_plans,platform_schema_approvals," +
    "platform_schema_trusted_actors,platform_schema_migration_journal TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT UPDATE(manifest,manifest_digest,updated_at) " +
    "ON platform_schema_registry TO " + dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT INSERT ON platform_schema_migration_journal TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  // Owner-controlled isolated database logins; no direct table DML grants.
  await dbAdmin.query("INSERT INTO platform_schema_trusted_actors " +
    "(login_name,principal_id,actor_kind) VALUES ($1,$2,'AUTHOR'),($3,$4,'APPROVER')",
    [author, "individual:" + author, approver, "individual:" + approver]);
  await dbAdmin.query("GRANT EXECUTE ON FUNCTION " +
    "public.platform_schema_submit_plan(text,text,text,text) TO " +
    dbAdmin.escapeIdentifier(author));
  await dbAdmin.query("GRANT EXECUTE ON FUNCTION " +
    "public.platform_schema_approve_operation(text,text,text,timestamptz), " +
    "public.platform_schema_revoke_operation(text,text,text) TO " +
    dbAdmin.escapeIdentifier(approver));
  await dbAdmin.query(
    "INSERT INTO platform_schema_registry " +
    "(installation_id,application_id,environment,database_name,operator_role,runtime_role,manifest,manifest_digest) " +
    "VALUES($1,$2,'test',$3,$4,$5,$6,$7)",
    [installationId, applicationId, name, operatorRole, runtimeRole,
      JSON.stringify(current), current.digest],
  );
  const writer = await connect(name, author);
  try {
    await writer.query(
      "SELECT public.platform_schema_submit_plan($1,$2,$3,$4)",
      [installationId, plan.digest, JSON.stringify(current), JSON.stringify(plan)],
    );
  } finally {
    await writer.end();
  }
  const operator = await connect(name, operatorRole);
  const runtime = await connect(name, runtimeRole);
  return { key, name, installationId, author, approver, operatorRole, runtimeRole,
    table, current, plan, dbAdmin, operator, runtime };
}

async function approve(lab: Lab): Promise<void> {
  const actor = await connect(lab.name, lab.approver);
  try {
    await actor.query(
      "SELECT public.platform_schema_approve_operation(" +
      "$1,$2,$3,clock_timestamp()+interval '20 minutes')",
      [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id],
    );
  } finally {
    await actor.end();
  }
}

async function run(lab: Lab) {
  return executeApprovedAdditiveColumn(lab.operator, {
    installationId: lab.installationId, planDigest: lab.plan.digest,
  });
}
async function hasWebsite(lab: Lab): Promise<boolean> {
  const r = await lab.dbAdmin.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_attribute a " +
    "JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relname=$1 AND a.attname='website' " +
    "AND a.attnum>0 AND NOT a.attisdropped) AS present",
    [lab.table],
  );
  return r.rows[0]?.present ?? false;
}

async function contentChecksum(lab: Lab): Promise<string> {
  const qualified = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
  const result = await lab.dbAdmin.query<{ digest: string }>(
    "SELECT md5(string_agg(name, ',' ORDER BY name)) AS digest FROM " + qualified,
  );
  const value = result.rows[0]?.digest;
  if (!value) throw new Error("fixture content checksum unavailable");
  return value;
}

beforeAll(async () => {
  const url = new URL(BASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "5433" || url.pathname !== "/vibress" ||
    url.username !== "vibress" || url.password !== "vibress" || url.search !== "") {
    throw new Error("Refusing migration integration tests outside disposable loopback fixture");
  }
  cluster = await connect("vibress");
  const db = (await cluster.query<{ rolname: string; rolsuper: boolean; ver: number }>(
    "SELECT current_user AS rolname, r.rolsuper, " +
    "current_setting('server_version_num')::int AS ver " +
    "FROM pg_roles r WHERE r.rolname = current_user",
  )).rows[0];
  if (!db?.rolsuper || db.ver < 160000 || db.ver >= 170000) {
    throw new Error("Disposable PostgreSQL 16 superuser lab required");
  }
  console.info("M03-S03 disposable lab: Node=" + process.version + " PostgreSQL server_version_num=" + db.ver);
  labs.push(await createLab("a"));
  labs.push(await createLab("b"));
  labs.push(await createLab("c")); // Dedicated concurrent execution and replay fixture.
  labs.push(await createLab("d")); // Dedicated journal failure/recovery fixture.
  labs.push(await createLab("e")); // Agent05 identity negative fixture.
  labs.push(await createLab("f")); // Revocation-before-lock fixture.
  labs.push(await createLab("g")); // Execution-before-revocation fixture.
  labs.push(await createLab("h")); // Forced rollback and replay fixture.
}, 120000);

// The eight baseline labs stay available for regression cases; every
// additional disposable lab is dismantled immediately after its owning test.
// Previously retaining each extra lab's 3 sessions until afterAll exhausted
// PostgreSQL max_connections and hid later security regressions.
afterEach(async () => {
  if (!cluster) return;
  const extra=labs.splice(8);
  for (const lab of extra) {
    if (!lab.name.startsWith("vibress_s03_") || !lab.name.endsWith("_"+id)) {
      throw new Error("REFUSE_NONOWNED_DISPOSABLE_FIXTURE_CLEANUP");
    }
    await Promise.allSettled([lab.operator.end(),lab.runtime.end(),lab.dbAdmin.end()]);
    await cluster.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
      "WHERE datname=$1 AND pid<>pg_backend_pid()",[lab.name],
    );
    await cluster.query("DROP DATABASE IF EXISTS "+cluster.escapeIdentifier(lab.name));
    for (const role of [lab.runtimeRole,lab.operatorRole,lab.approver,lab.author, "s03_delegate_" + lab.key + "_" + id, "s03_gateway_" + lab.key + "_" + id]) {
      await cluster.query("DROP ROLE IF EXISTS "+cluster.escapeIdentifier(role));
    }
  }
});

afterAll(async () => {
  for (const lab of labs) {
    await lab.operator.end().catch(() => undefined);
    await lab.runtime.end().catch(() => undefined);
    await lab.dbAdmin.end().catch(() => undefined);
  }
  if (cluster) {
    await cluster.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
      "WHERE datname = ANY($1) AND pid <> pg_backend_pid()",
      [labs.map(lab => lab.name)]).catch(() => undefined);
    for (const lab of labs) {
      await cluster.query("DROP DATABASE IF EXISTS " +
        cluster.escapeIdentifier(lab.name)).catch(() => undefined);
      for (const role of [lab.runtimeRole, lab.operatorRole, lab.approver, lab.author, "s03_delegate_" + lab.key + "_" + id, "s03_gateway_" + lab.key + "_" + id]) {
        await cluster.query("DROP ROLE IF EXISTS " + cluster.escapeIdentifier(role))
          .catch(() => undefined);
      }
    }
    await cluster.end().catch(() => undefined);
  }
});

describe("M03-S03 real disposable PostgreSQL 16 security boundary", () => {
  it("denies missing approval and preserves the original rows/column state", async () => {
    const lab = labs[0]!;
    await expect(run(lab)).rejects.toThrow();
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query(
      "SELECT * FROM platform_schema_migration_journal")).rowCount).toBe(0);
  });

  it("runtime cannot ALTER, DROP, CREATE or TRUNCATE, nor access registry", async () => {
    const lab = labs[0]!;
    const qualified = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    for (const command of [
      "ALTER TABLE " + qualified + " ADD COLUMN injection text",
      "DROP TABLE " + qualified,
      'CREATE TABLE "public"."unapproved" (id text)',
      "TRUNCATE TABLE " + qualified,
      "SELECT * FROM platform_schema_plans",
    ]) {
      await expect(lab.runtime.query(command)).rejects.toMatchObject({ code: "42501" });
    }
    const other = labs[1]!;
    await expect(connect(other.name, lab.runtimeRole)).rejects.toThrow();
  });

  it("rejects revoked, expired, changed or forged plan authorization", async () => {
    const lab = labs[0]!;
    const originalChecksum = await contentChecksum(lab);
    await approve(lab);
    try {
      // A revoked authorization is denied even with a valid future expiry.
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET revoked_at = clock_timestamp() " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // An expired approval remains structurally valid: approved_at < expires_at < DB time.
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET revoked_at = NULL, " +
        "approved_at = clock_timestamp() - interval '2 hours', " +
        "expires_at = clock_timestamp() - interval '1 hour' " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );
      const expired = await lab.dbAdmin.query<{ valid_window: boolean; expired: boolean }>(
        "SELECT approved_at < expires_at AS valid_window, " +
        "expires_at < clock_timestamp() AS expired " +
        "FROM platform_schema_approvals WHERE installation_id = $1",
        [lab.installationId],
      );
      expect(expired.rows[0]).toEqual({ valid_window: true, expired: true });
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // Preserve PostgreSQL's actual ordering constraint. A malformed window is
      // a database error, not an alternative way to represent expiry.
      await expect(lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET expires_at = approved_at " +
        "WHERE installation_id = $1",
        [lab.installationId],
      )).rejects.toMatchObject({
        code: "23514", constraint: "platform_schema_approvals_expiry_check",
      });

      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET " +
        "approved_at = clock_timestamp(), " +
        "expires_at = clock_timestamp() + interval '20 minutes' " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );

      // A forged target operator does not authenticate the approver's intent.
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET operator_role = $1 " +
        "WHERE installation_id = $2",
        [lab.runtimeRole, lab.installationId],
      );
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET operator_role = $1 " +
        "WHERE installation_id = $2",
        [lab.operatorRole, lab.installationId],
      );

      await lab.dbAdmin.query(
        "UPDATE platform_schema_plans SET plan = $1 WHERE installation_id = $2",
        [JSON.stringify({ ...lab.plan, digest: "e".repeat(64) }), lab.installationId],
      );
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(originalChecksum);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM platform_schema_migration_journal WHERE installation_id = $1",
        [lab.installationId],
      )).rowCount).toBe(0);
    } finally {
      // This fixture is reused for catalog and role-negative checks; always
      // reset authorized metadata, even when an assertion fails.
      await lab.dbAdmin.query(
        "UPDATE platform_schema_plans SET plan = $1 WHERE installation_id = $2",
        [JSON.stringify(lab.plan), lab.installationId],
      );
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET revoked_at = NULL, " +
        "operator_role = $1, approved_at = clock_timestamp(), " +
        "expires_at = clock_timestamp() + interval '20 minutes' " +
        "WHERE installation_id = $2",
        [lab.operatorRole, lab.installationId],
      );
    }
  });

  it("fails closed on unexpected live column and then permits deliberate fixture repair", async () => {
    const lab = labs[0]!;
    const table = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    await lab.dbAdmin.query("ALTER TABLE " + table + " ADD COLUMN unexpected text");
    await expect(run(lab)).rejects.toThrow();
    await lab.dbAdmin.query("ALTER TABLE " + table + " DROP COLUMN unexpected");
    expect(await hasWebsite(lab)).toBe(false);
  });

  it("AG06-S03-02 rejects a PUBLIC-executable SECURITY DEFINER in public", async () => {
    const lab = labs[0]!;
    const fname = lab.dbAdmin.escapeIdentifier("s03_pub_" + id);
    await lab.dbAdmin.query(
      "CREATE FUNCTION public." + fname + "() RETURNS integer LANGUAGE sql " +
      "SECURITY DEFINER SET search_path = pg_catalog AS 'SELECT 7'",
    );
    try {
      const callable = await lab.runtime.query<{ result: number }>(
        "SELECT public." + fname + "() AS result",
      );
      expect(callable.rows[0]?.result).toBe(7);
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("DROP FUNCTION IF EXISTS public." + fname + "()");
    }
  });

  it("AG06-S03-02 detects non-public SECURITY DEFINER via schema USAGE + PUBLIC EXECUTE", async () => {
    const lab = labs[0]!;
    const schema = lab.dbAdmin.escapeIdentifier("s03_priv_" + id);
    await lab.dbAdmin.query("CREATE SCHEMA " + schema);
    try {
      await lab.dbAdmin.query("GRANT USAGE ON SCHEMA " + schema + " TO " +
        lab.dbAdmin.escapeIdentifier(lab.runtimeRole));
      await lab.dbAdmin.query(
        "CREATE FUNCTION " + schema + ".probe() RETURNS integer LANGUAGE sql " +
        "SECURITY DEFINER SET search_path = pg_catalog AS 'SELECT 7'",
      );
      const reachable = await lab.runtime.query<{ result: number }>(
        "SELECT " + schema + ".probe() AS result",
      );
      expect(reachable.rows[0]?.result).toBe(7);
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("DROP SCHEMA " + schema + " CASCADE");
    }
  });

  it("AG06-S03-02 blocks inherited EXECUTE even when PUBLIC access was revoked", async () => {
    const lab = labs[0]!;
    const schema = lab.dbAdmin.escapeIdentifier("s03_inh_" + id);
    const group = lab.dbAdmin.escapeIdentifier("s03_group_" + id);
    const runtime = lab.dbAdmin.escapeIdentifier(lab.runtimeRole);
    await lab.dbAdmin.query("CREATE ROLE " + group + " NOLOGIN");
    await lab.dbAdmin.query("CREATE SCHEMA " + schema);
    try {
      await lab.dbAdmin.query("GRANT USAGE ON SCHEMA " + schema + " TO " + runtime);
      await lab.dbAdmin.query(
        "CREATE FUNCTION " + schema + ".probe() RETURNS integer LANGUAGE sql " +
        "SECURITY DEFINER SET search_path = pg_catalog AS 'SELECT 7'",
      );
      await lab.dbAdmin.query("REVOKE EXECUTE ON FUNCTION " + schema +
        ".probe() FROM PUBLIC");
      await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION " + schema +
        ".probe() TO " + group);
      await lab.dbAdmin.query("GRANT " + group + " TO " + runtime +
        " WITH INHERIT TRUE, SET FALSE");
      expect((await lab.runtime.query<{ result: number }>(
        "SELECT " + schema + ".probe() AS result",
      )).rows[0]?.result).toBe(7);
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("REVOKE " + group + " FROM " + runtime).catch(() => undefined);
      await lab.dbAdmin.query("DROP SCHEMA " + schema + " CASCADE");
      await lab.dbAdmin.query("DROP ROLE " + group);
    }
  });

  it("AG06-S03-02 rejects SET ROLE reachability even without inherited EXECUTE", async () => {
    const lab = labs[0]!;
    const group = lab.dbAdmin.escapeIdentifier("s03_set_" + id);
    const runtime = lab.dbAdmin.escapeIdentifier(lab.runtimeRole);
    await lab.dbAdmin.query("CREATE ROLE " + group + " NOLOGIN");
    try {
      await lab.dbAdmin.query("GRANT " + group + " TO " + runtime +
        " WITH INHERIT FALSE, SET TRUE");
      await lab.runtime.query("SET ROLE " + group);
      expect((await lab.runtime.query<{ principal: string }>(
        "SELECT current_user AS principal",
      )).rows[0]?.principal).toBe("s03_set_" + id);
      await lab.runtime.query("RESET ROLE");
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.runtime.query("RESET ROLE").catch(() => undefined);
      await lab.dbAdmin.query("REVOKE " + group + " FROM " + runtime);
      await lab.dbAdmin.query("DROP ROLE " + group);
    }
  });

  it("rejects runtime or operator schema CREATE outside public", async () => {
    const lab = labs[0]!;
    const schema = lab.dbAdmin.escapeIdentifier("s03_create_" + id);
    await lab.dbAdmin.query("CREATE SCHEMA " + schema);
    try {
      for (const role of [lab.runtimeRole, lab.operatorRole]) {
        await lab.dbAdmin.query("GRANT CREATE ON SCHEMA " + schema + " TO " +
          lab.dbAdmin.escapeIdentifier(role));
        await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await lab.dbAdmin.query("REVOKE CREATE ON SCHEMA " + schema + " FROM " +
          lab.dbAdmin.escapeIdentifier(role));
      }
    } finally {
      await lab.dbAdmin.query("DROP SCHEMA " + schema);
    }
  });

  it("operator owner SQL grammar is narrower than the credential's actual ALTER/DROP ability", async () => {
    const lab = labs[0]!;
    const qualified = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    const original = await contentChecksum(lab);
    await lab.operator.query("ALTER TABLE " + qualified + " ADD COLUMN owner_probe text");
    expect((await lab.dbAdmin.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_attribute a " +
      "JOIN pg_class c ON c.oid=a.attrelid WHERE c.relname=$1 " +
      "AND a.attname='owner_probe' AND NOT a.attisdropped) AS present",
      [lab.table],
    )).rows[0]?.present).toBe(true);
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "CATALOG_DRIFT" });
    } finally {
      await lab.operator.query("ALTER TABLE " + qualified + " DROP COLUMN owner_probe");
    }
    expect(await contentChecksum(lab)).toBe(original);
  });

  it("AG06-S03-03 rejects unexpected CHECK constraints and noninternal triggers", async () => {
    const lab = labs[0]!;
    const qualified = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    const fn = lab.dbAdmin.escapeIdentifier("s03_trigger_" + id);
    await lab.dbAdmin.query("ALTER TABLE " + qualified +
      " ADD CONSTRAINT s03_extra_check CHECK (char_length(name) >= 0)");
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "CATALOG_DRIFT" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("ALTER TABLE " + qualified +
        " DROP CONSTRAINT s03_extra_check");
    }
    await lab.dbAdmin.query("CREATE FUNCTION public." + fn +
      "() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog " +
      "AS 'BEGIN RETURN NEW; END'");
    try {
      await lab.dbAdmin.query("CREATE TRIGGER s03_unexpected BEFORE INSERT ON " +
        qualified + " FOR EACH ROW EXECUTE FUNCTION public." + fn + "()");
      await expect(run(lab)).rejects.toMatchObject({ code: "CATALOG_DRIFT" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("DROP TRIGGER IF EXISTS s03_unexpected ON " + qualified);
      await lab.dbAdmin.query("DROP FUNCTION IF EXISTS public." + fn + "()");
    }
  });


  it("rejects unexpected target owner, extra schema owner and unmodeled index", async () => {
    const lab = labs[0]!;
    const table = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    const originalChecksum = await contentChecksum(lab);
    await lab.dbAdmin.query("ALTER TABLE " + table + " OWNER TO " +
      lab.dbAdmin.escapeIdentifier(lab.runtimeRole));
    try {
      await expect(run(lab)).rejects.toThrow();
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("ALTER TABLE " + table + " OWNER TO " +
        lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    }
    const schema = lab.dbAdmin.escapeIdentifier("s03_owned_" + id);
    await lab.dbAdmin.query("CREATE SCHEMA " + schema);
    try {
      await lab.dbAdmin.query("ALTER SCHEMA " + schema + " OWNER TO " +
        lab.dbAdmin.escapeIdentifier(lab.operatorRole));
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await lab.dbAdmin.query("DROP SCHEMA " + schema + " CASCADE");
    }
    const index = lab.dbAdmin.escapeIdentifier("s03_idx_" + id);
    await lab.dbAdmin.query("CREATE INDEX " + index + " ON " + table + ' ("name")');
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "CATALOG_DRIFT" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("DROP INDEX public." + index);
    }
    expect(await contentChecksum(lab)).toBe(originalChecksum);
  });

  it("rejects missing or changed physical columns after non-destructive rename", async () => {
    const lab = labs[0]!;
    const table = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    const originalChecksum = await contentChecksum(lab);
    await lab.dbAdmin.query("ALTER TABLE " + table + " RENAME COLUMN name TO renamed_name");
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "CATALOG_DRIFT" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("ALTER TABLE " + table + " RENAME COLUMN renamed_name TO name");
    }
    expect(await contentChecksum(lab)).toBe(originalChecksum);
  });

  it("AG06-S03-03 rejects a noncooperating DDL commit before table lock acquisition", async () => {
    const lab = labs[0]!;
    const sqlTable = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    await lab.dbAdmin.query("BEGIN");
    try {
      await lab.dbAdmin.query("ALTER TABLE " + sqlTable + " ADD COLUMN rogue text");
      const pending = run(lab);
      await new Promise(resolve => setTimeout(resolve, 200));
      await lab.dbAdmin.query("COMMIT");
      await expect(pending).rejects.toMatchObject({ code: "CATALOG_DRIFT" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("ROLLBACK").catch(() => undefined);
      await lab.dbAdmin.query("ALTER TABLE " + sqlTable + " DROP COLUMN IF EXISTS rogue");
    }
  }, 15000);

  it("AG06-S03-03 enforces the 2-second ACCESS EXCLUSIVE lock timeout without altering schema", async () => {
    const lab = labs[0]!;
    const sqlTable = '"public".' + lab.dbAdmin.escapeIdentifier(lab.table);
    const checksum = await contentChecksum(lab);
    await lab.dbAdmin.query("BEGIN");
    try {
      await lab.dbAdmin.query("LOCK TABLE ONLY " + sqlTable + " IN ACCESS EXCLUSIVE MODE");
      await expect(run(lab)).rejects.toThrow();
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("ROLLBACK");
    }
    expect(await contentChecksum(lab)).toBe(checksum);
  }, 12000);

  it("rejects overprivileged migration identities despite valid plan approval", async () => {
    const lab = labs[0]!;
    const role = lab.dbAdmin.escapeIdentifier(lab.operatorRole);
    await lab.dbAdmin.query("GRANT CREATE ON SCHEMA public TO " + role);
    try {
      await expect(run(lab)).rejects.toThrow();
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("REVOKE CREATE ON SCHEMA public FROM " + role);
    }
    await lab.dbAdmin.query("GRANT CREATE ON DATABASE " +
      lab.dbAdmin.escapeIdentifier(lab.name) + " TO " + role);
    try {
      await expect(run(lab)).rejects.toThrow();
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query("REVOKE CREATE ON DATABASE " +
        lab.dbAdmin.escapeIdentifier(lab.name) + " FROM " + role);
    }
  });

  it("serializes concurrent operators and deterministically prevents reapplication", async () => {
    // Its own installation/database means other tests cannot leave a revoked
    // approval, drifted catalog or journal from a prior negative test.
    const lab = labs[2]!;
    await approve(lab);
    const originalChecksum = await contentChecksum(lab);
    const second = await connect(lab.name, lab.operatorRole);
    try {
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET revoked_at = clock_timestamp() " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );
      const denied = await Promise.allSettled([
        run(lab),
        executeApprovedAdditiveColumn(second, {
          installationId: lab.installationId, planDigest: lab.plan.digest,
        }),
      ]);
      expect(denied.every(result =>
        result.status === "rejected" && result.reason?.code === "UNAUTHORIZED",
      )).toBe(true);
      expect(await hasWebsite(lab)).toBe(false);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM platform_schema_migration_journal",
      )).rowCount).toBe(0);
    } finally {
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET revoked_at = NULL " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );
    }

    try {
      const results = await Promise.allSettled([
        run(lab),
        executeApprovedAdditiveColumn(second, {
          installationId: lab.installationId, planDigest: lab.plan.digest,
        }),
      ]);
      // Report actual sanitized operator outcomes if neither applied, rather
      // than weakening the requirement to accept zero migrations.
      const outcomes = results.map(result => result.status === "fulfilled"
        ? result.value.status
        : result.reason?.code === undefined ? "UNEXPECTED_REJECTION" : String(result.reason.code));
      const applied = results.filter(result => result.status === "fulfilled" &&
        result.value.status === "APPLIED");
      expect(applied, "Concurrent operator outcomes: " + outcomes.join(", "))
        .toHaveLength(1);
      expect(results.every(result => result.status === "rejected" ||
        result.value.status === "APPLIED" || result.value.status === "ALREADY_APPLIED")).toBe(true);
      expect(await hasWebsite(lab)).toBe(true);
      expect(await contentChecksum(lab)).toBe(originalChecksum);
      const retry = await run(lab);
      expect(retry.status).toBe("ALREADY_APPLIED");
      expect(retry.afterRows).toBe("2");
      const journal = await lab.dbAdmin.query<{ status: string }>(
        "SELECT status FROM platform_schema_migration_journal");
      expect(journal.rows).toEqual([{ status: "COMPLETED" }]);

      // A different plan may not borrow this operation's completed journal.
      await expect(executeApprovedAdditiveColumn(second, {
        installationId: lab.installationId, planDigest: "f".repeat(64),
      })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // A valid-format conflicting journal checksum must never masquerade as
      // an already-applied operation. Restore only inside this disposable lab.
      await lab.dbAdmin.query(
        "UPDATE platform_schema_migration_journal SET new_digest = $1 " +
        "WHERE installation_id = $2",
        ["f".repeat(64), lab.installationId],
      );
      try {
        await expect(run(lab)).rejects.toMatchObject({ code: "JOURNAL_CONFLICT" });
      } finally {
        await lab.dbAdmin.query(
          "UPDATE platform_schema_migration_journal SET new_digest = $1 " +
          "WHERE installation_id = $2",
          [lab.plan.proposedManifest.digest, lab.installationId],
        );
      }
      expect((await run(lab)).status).toBe("ALREADY_APPLIED");
    } finally {
      await second.end();
    }
  }, 20000);

  it("fails with bounded advisory lock contention and leaves B unchanged", async () => {
    const lab = labs[1]!;
    await approve(lab);
    const locker = await connect(lab.name, lab.operatorRole);
    try {
      await locker.query("BEGIN");
      await locker.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03'), hashtext($1::text))",
        [lab.installationId],
      );
      await expect(run(lab)).rejects.toThrow();
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      await locker.end();
    }
  }, 20000);

  it("rolls back ALTER if journal finalization fails, then allows a fresh authorized retry", async () => {
    const lab = labs[3]!;
    await approve(lab);
    await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_migration_journal FROM " +
      lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    await expect(run(lab)).rejects.toThrow();
    expect(await hasWebsite(lab)).toBe(false);
    const registry = await lab.dbAdmin.query<{ manifest_digest: string }>(
      "SELECT manifest_digest FROM platform_schema_registry");
    expect(registry.rows[0]?.manifest_digest).toBe(lab.current.digest);
    await lab.dbAdmin.query("GRANT INSERT ON platform_schema_migration_journal TO " +
      lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    const result = await run(lab);
    expect(result.status).toBe("APPLIED");
    expect(result.beforeRows).toBe("2");
    expect(result.afterRows).toBe("2");
    expect(await hasWebsite(lab)).toBe(true);
    const replay = await run(lab);
    expect(replay.status).toBe("ALREADY_APPLIED");
  }, 30000);
  it("runtime cannot write approvals or registry, and cannot use another installation", async () => {
    const lab = labs[0]!;
    for (const command of [
      "UPDATE public.platform_schema_registry SET updated_at=clock_timestamp()",
      "UPDATE public.platform_schema_approvals SET revoked_at=clock_timestamp()",
      "INSERT INTO public.platform_schema_approvals " +
        "(installation_id,plan_digest,operation_id,approver,operator_role,environment,expires_at) " +
        "VALUES ('x','x','x','x','x','test',clock_timestamp())",
    ]) {
      await expect(lab.runtime.query(command)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(connect(labs[1]!.name, lab.operatorRole)).rejects.toThrow();
  });

  it("AG06-S03-03 denies a noncooperating ALTER while the operator already owns the target lock", async () => {
    // Fixture D has a completed journal from the prior recovery test, so the
    // operator is performing verified ALREADY_APPLIED replay, not second DDL.
    const lab = labs[3]!;
    let signalLock!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>(resolve => { signalLock = resolve; });
    const released = new Promise<void>(resolve => { releaseLock = resolve; });
    const proxy = new Proxy(lab.operator, {
      get(target, prop) {
        if (prop === "query") {
          return async (sql: string, params?: readonly unknown[]) => {
            const response = await target.query(sql, params);
            if (sql.startsWith("LOCK TABLE ONLY")) {
              signalLock();
              await released;
            }
            return response;
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Client;
    const pending = executeApprovedAdditiveColumn(proxy, {
      installationId: lab.installationId, planDigest: lab.plan.digest,
    });
    try {
      await Promise.race([
        locked,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("operator never acquired target lock")), 5000)),
      ]);
      await lab.dbAdmin.query("SET lock_timeout = '250ms'");
      await expect(lab.dbAdmin.query(
        'ALTER TABLE "public".' + lab.dbAdmin.escapeIdentifier(lab.table) +
        " ADD COLUMN noncooperating text",
      )).rejects.toMatchObject({ code: "55P03" });
    } finally {
      releaseLock();
      await lab.dbAdmin.query("RESET lock_timeout").catch(() => undefined);
    }
    const result = await pending;
    expect(result.status).toBe("ALREADY_APPLIED");
    expect(await hasWebsite(lab)).toBe(true);
    const unexpected = await lab.dbAdmin.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_attribute a " +
      "JOIN pg_class c ON c.oid=a.attrelid " +
      "WHERE c.relname=$1 AND a.attname='noncooperating' AND NOT a.attisdropped) AS present",
      [lab.table],
    );
    expect(unexpected.rows[0]?.present).toBe(false);
  }, 15000);

});

describe("M03-S03 Agent05 authenticated provenance and revocation negatives (PG16)", () => {
  const e = () => labs[4]!;
  const operation = (lab: Lab) => lab.plan.operations[0]!.id;
  const approvalSql =
    "INSERT INTO platform_schema_approvals " +
    "(installation_id,plan_digest,operation_id,approver,operator_role,environment,expires_at) " +
    "VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '20 minutes')";

  it("AUTH-01: records distinct authenticated author/approver from separate sessions", async () => {
    const lab = e();
    await approve(lab);
    const result = await lab.dbAdmin.query<{
      author_login: string; author_principal_id: string; approver_login: string;
      approver_principal_id: string; approved_application_id: string;
    }>(
      "SELECT p.author_login,p.author_principal_id,a.approver_login," +
      "a.approver_principal_id,a.approved_application_id FROM platform_schema_plans p " +
      "JOIN platform_schema_approvals a USING (installation_id,plan_digest)",
    );
    expect(result.rows).toEqual([{
      author_login: lab.author, author_principal_id: "individual:" + lab.author,
      approver_login: lab.approver, approver_principal_id: "individual:" + lab.approver,
      approved_application_id: applicationId,
    }]);
  });

  it("AUTH-02: forged author text is rejected despite misgranted direct INSERT", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT INSERT ON platform_schema_plans TO " +
      lab.dbAdmin.escapeIdentifier(lab.author));
    const actor = await connect(lab.name, lab.author);
    try {
      await expect(actor.query(
        "INSERT INTO platform_schema_plans " +
        "(installation_id,plan_digest,expected_manifest,plan,author) VALUES($1,$2,$3,$4,$5)",
        [lab.installationId, "a".repeat(64), JSON.stringify(lab.current),
         JSON.stringify(lab.plan), lab.approver],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_plans FROM " +
        lab.dbAdmin.escapeIdentifier(lab.author));
    }
  });

  it("AUTH-03: forged approver text is rejected even with direct INSERT", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT INSERT ON platform_schema_approvals TO " +
      lab.dbAdmin.escapeIdentifier(lab.approver));
    const actor = await connect(lab.name, lab.approver);
    try {
      await expect(actor.query(approvalSql, [lab.installationId,
        lab.plan.digest, "forged", lab.author, lab.operatorRole, "test",
      ])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_approvals FROM " +
        lab.dbAdmin.escapeIdentifier(lab.approver));
    }
  });

  it("AUTH-04: same-login dual table grants cannot forge distinct principals", async () => {
    const lab = e();
    const role = lab.dbAdmin.escapeIdentifier(lab.author);
    await lab.dbAdmin.query("GRANT INSERT ON platform_schema_plans,platform_schema_approvals TO " + role);
    const actor = await connect(lab.name, lab.author);
    try {
      await expect(actor.query(approvalSql, [lab.installationId,
        lab.plan.digest, operation(lab), lab.approver, lab.operatorRole, "test",
      ])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_plans,platform_schema_approvals FROM " + role);
    }
  });

  it("AUTH-05: inherited dual grants do not change authenticated principal", async () => {
    const lab = e();
    const group = "s03_dual_" + id;
    const quoted = lab.dbAdmin.escapeIdentifier(group);
    await lab.dbAdmin.query("CREATE ROLE " + quoted + " NOLOGIN");
    try {
      await lab.dbAdmin.query("GRANT INSERT ON platform_schema_plans,platform_schema_approvals TO " + quoted);
      await lab.dbAdmin.query("GRANT " + quoted + " TO " +
        lab.dbAdmin.escapeIdentifier(lab.author) + " WITH INHERIT TRUE, SET TRUE");
      const actor = await connect(lab.name, lab.author);
      try {
        await expect(actor.query(approvalSql, [lab.installationId,
          lab.plan.digest, operation(lab), lab.approver, lab.operatorRole, "test",
        ])).rejects.toMatchObject({ code: "42501" });
      } finally { await actor.end(); }
    } finally {
      await lab.dbAdmin.query("REVOKE " + quoted + " FROM " +
        lab.dbAdmin.escapeIdentifier(lab.author));
      await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_plans,platform_schema_approvals FROM " + quoted);
      await lab.dbAdmin.query("DROP ROLE " + quoted);
    }
  });

  it("AUTH-06: SET ROLE approver cannot impersonate the authenticated login", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT " + lab.dbAdmin.escapeIdentifier(lab.approver) +
      " TO " + lab.dbAdmin.escapeIdentifier(lab.author) + " WITH SET TRUE, INHERIT FALSE");
    const actor = await connect(lab.name, lab.author);
    try {
      await actor.query("SET ROLE " + actor.escapeIdentifier(lab.approver));
      const identities = await actor.query<{ current_user: string; session_user: string }>(
        "SELECT current_user,session_user");
      expect(identities.rows[0]).toMatchObject({
        current_user: lab.approver, session_user: lab.author,
      });
      await expect(actor.query("SELECT public.platform_schema_approve_operation(" +
        "$1,$2,$3,clock_timestamp()+interval '20 minutes')",
      [lab.installationId, lab.plan.digest, operation(lab)])).rejects
        .toMatchObject({ code: "42501" });
    } finally {
      await actor.query("RESET ROLE").catch(() => undefined);
      await actor.end();
      await lab.dbAdmin.query("REVOKE " + lab.dbAdmin.escapeIdentifier(lab.approver) +
        " FROM " + lab.dbAdmin.escapeIdentifier(lab.author));
    }
  });

  it("AUTH-07: a PUBLIC direct INSERT misgrant cannot create authenticated approvals", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT INSERT ON platform_schema_approvals TO PUBLIC");
    try {
      await expect(lab.runtime.query(approvalSql, [lab.installationId,
        lab.plan.digest, operation(lab), lab.approver, lab.operatorRole, "test",
      ])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_approvals FROM PUBLIC");
    }
  });

  it("AUTH-08: runtime with misgranted EXECUTE cannot issue approvals", async () => {
    const lab = e();
    const sig = "public.platform_schema_approve_operation(text,text,text,timestamptz)";
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION " + sig + " TO " +
      lab.dbAdmin.escapeIdentifier(lab.runtimeRole));
    try {
      await expect(lab.runtime.query(
        "SELECT public.platform_schema_approve_operation($1,$2,$3,clock_timestamp()+interval '20 minutes')",
        [lab.installationId,lab.plan.digest,operation(lab)],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lab.dbAdmin.query("REVOKE EXECUTE ON FUNCTION " + sig + " FROM " +
        lab.dbAdmin.escapeIdentifier(lab.runtimeRole));
    }
  });

  it("AUTH-09: author cannot revoke approval even with EXECUTE misgrant", async () => {
    const lab = e();
    const sig = "public.platform_schema_revoke_operation(text,text,text)";
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION " + sig + " TO " +
      lab.dbAdmin.escapeIdentifier(lab.author));
    const actor = await connect(lab.name,lab.author);
    try {
      await expect(actor.query("SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,operation(lab)],
      )).rejects.toMatchObject({ code: "42501" });
      const r = await lab.dbAdmin.query("SELECT revoked_at FROM platform_schema_approvals");
      expect(r.rows[0]?.revoked_at).toBeNull();
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE EXECUTE ON FUNCTION " + sig + " FROM " +
        lab.dbAdmin.escapeIdentifier(lab.author));
    }
  });

  it("AUTH-10: operator with UPDATE misgrant cannot rewrite an approval", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT UPDATE ON platform_schema_approvals TO " +
      lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    try {
      await expect(lab.operator.query(
        "UPDATE platform_schema_approvals SET expires_at=expires_at+interval '1 day'",
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lab.dbAdmin.query("REVOKE UPDATE ON platform_schema_approvals FROM " +
        lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    }
  });

  it("AUTH-11: plan identity and canonical plan are immutable to ordinary authors", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT UPDATE ON platform_schema_plans TO " +
      lab.dbAdmin.escapeIdentifier(lab.author));
    const actor = await connect(lab.name,lab.author);
    try {
      await expect(actor.query(
        "UPDATE platform_schema_plans SET author_login=$1 WHERE installation_id=$2",
        [lab.approver,lab.installationId],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE UPDATE ON platform_schema_plans FROM " +
        lab.dbAdmin.escapeIdentifier(lab.author));
    }
  });

  it("AUTH-12: approval for a different operation is rejected at DB boundary", async () => {
    const lab = e();
    const actor = await connect(lab.name,lab.approver);
    try {
      await expect(actor.query(
        "SELECT public.platform_schema_approve_operation(" +
        "$1,$2,$3,clock_timestamp()+interval '20 minutes')",
        [lab.installationId,lab.plan.digest,"wrong-operation"],
      )).rejects.toMatchObject({ code: "42501" });
    } finally { await actor.end(); }
  });

  it("AUTH-13: changed environment/operator/application binding denies execution", async () => {
    const lab = e();
    for (const [column,value,original] of [
      ["environment","development","test"],
      ["operator_role",lab.runtimeRole,lab.operatorRole],
      ["approved_application_id","wrong-app",applicationId],
    ]) {
      await lab.dbAdmin.query("UPDATE platform_schema_approvals SET " +
        column + "=$1 WHERE installation_id=$2", [value,lab.installationId]);
      try {
        await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect(await hasWebsite(lab)).toBe(false);
      } finally {
        await lab.dbAdmin.query("UPDATE platform_schema_approvals SET " +
          column + "=$1 WHERE installation_id=$2", [original,lab.installationId]);
      }
    }
  });

  it("AUTH-14: legacy pre-0060 records without provenance fail closed", async () => {
    const lab = e();
    await lab.dbAdmin.query(
      "UPDATE platform_schema_approvals SET approver_login=NULL WHERE installation_id=$1",
      [lab.installationId],
    );
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await lab.dbAdmin.query(
        "UPDATE platform_schema_approvals SET approver_login=$1 WHERE installation_id=$2",
        [lab.approver,lab.installationId],
      );
    }
  });

  it("AUTH-15: expired authorization and crossed installation/digest cannot execute", async () => {
    const lab = e();
    await lab.dbAdmin.query("UPDATE platform_schema_approvals SET " +
      "approved_at=clock_timestamp()-interval '2 hours', " +
      "expires_at=clock_timestamp()-interval '1 hour' WHERE installation_id=$1",
      [lab.installationId]);
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await lab.dbAdmin.query("UPDATE platform_schema_approvals SET " +
        "approved_at=clock_timestamp(),expires_at=clock_timestamp()+interval '20 minutes' " +
        "WHERE installation_id=$1",[lab.installationId]);
    }
    const other = labs[5]!;
    await expect(executeApprovedAdditiveColumn(lab.operator, {
      installationId:lab.installationId,planDigest:other.plan.digest,
    })).rejects.toMatchObject({ code:"UNAUTHORIZED" });
    await expect(executeApprovedAdditiveColumn(lab.operator, {
      installationId:other.installationId,planDigest:lab.plan.digest,
    })).rejects.toMatchObject({ code:"UNAUTHORIZED" });
    expect(await hasWebsite(lab)).toBe(false);
  });

  it("AUTH-16: committed revocation before lock denies DDL and preserves audit", async () => {
    const lab = labs[5]!;
    await approve(lab);
    const revoker = await connect(lab.name,lab.approver);
    try {
      await revoker.query("SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,operation(lab)]);
      await expect(revoker.query("SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,operation(lab)])).rejects
        .toMatchObject({ code:"42501" });
    } finally { await revoker.end(); }
    await expect(run(lab)).rejects.toMatchObject({ code:"UNAUTHORIZED" });
    expect(await hasWebsite(lab)).toBe(false);
    const audit = await lab.dbAdmin.query(
      "SELECT revoked_by_login FROM platform_schema_revocation_audit");
    expect(audit.rows).toEqual([{ revoked_by_login: lab.approver }]);
    expect((await lab.dbAdmin.query("SELECT * FROM platform_schema_migration_journal")).rowCount)
      .toBe(0);
  });

  it("AUTH-17: operator transaction advisory lock wins race; revocation waits for COMMIT", async () => {
    const lab = labs[6]!;
    await approve(lab);
    let signalLock!: () => void;
    let releaseLock!: () => void;
    const afterLock = new Promise<void>(resolve => { signalLock = resolve; });
    const gate = new Promise<void>(resolve => { releaseLock = resolve; });
    const hooked = {
      escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
      query: async (sql: string, params?: unknown[]) => {
        const result = await lab.operator.query(sql,params);
        if (sql.includes("vibress_m03s03_approval")) {
          signalLock();
          await gate;
        }
        return result;
      },
    } as unknown as ClientBase;
    const executing = executeApprovedAdditiveColumn(hooked,{
      installationId:lab.installationId,planDigest:lab.plan.digest,
    });
    const revoker = await connect(lab.name,lab.approver);
    let revoking: Promise<unknown> | undefined;
    try {
      await afterLock;
      revoking = revoker.query("SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,operation(lab)]);
      let observedWait = false;
      for (let attempt=0; attempt<30; attempt+=1) {
        const state = await lab.dbAdmin.query<{ wait_event_type:string|null }>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [revoker.processID ?? -1],
        );
        if (state.rows[0]?.wait_event_type === "Lock") { observedWait = true; break; }
        await new Promise(resolve => setTimeout(resolve,25));
      }
      expect(observedWait).toBe(true);
      releaseLock();
      const applied = await executing;
      expect(applied.status).toBe("APPLIED");
      await revoking;
      await expect(run(lab)).rejects.toMatchObject({ code:"UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(true);
      expect((await lab.dbAdmin.query(
        "SELECT * FROM platform_schema_migration_journal")).rowCount).toBe(1);
      const audit = await lab.dbAdmin.query("SELECT revoked_by_login FROM platform_schema_revocation_audit");
      expect(audit.rows).toEqual([{ revoked_by_login: lab.approver }]);
    } finally {
      releaseLock();
      await Promise.allSettled([executing,revoking ?? Promise.resolve()]);
      await revoker.end();
    }
  },30000);

  it("AUTH-19: accidental actor-roster UPDATE grant cannot reclassify a principal", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT UPDATE ON platform_schema_trusted_actors TO " +
      lab.dbAdmin.escapeIdentifier(lab.author));
    const actor = await connect(lab.name,lab.author);
    try {
      await expect(actor.query(
        "UPDATE platform_schema_trusted_actors SET actor_kind='APPROVER'," +
        "principal_id=$1 WHERE login_name=$2",
        ["forged:new-identity",lab.author],
      )).rejects.toMatchObject({code:"42501"});
      const result = await lab.dbAdmin.query(
        "SELECT actor_kind,principal_id FROM platform_schema_trusted_actors WHERE login_name=$1",
        [lab.author],
      );
      expect(result.rows).toEqual([{
        actor_kind:"AUTHOR",principal_id:"individual:"+lab.author,
      }]);
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE UPDATE ON platform_schema_trusted_actors FROM " +
        lab.dbAdmin.escapeIdentifier(lab.author));
    }
  });

  it("AUTH-20: accidental DELETE grant cannot erase committed revocation audit", async () => {
    const lab = labs[5]!; // AUTH-16 committed one authentic revocation here.
    await lab.dbAdmin.query("GRANT DELETE ON platform_schema_revocation_audit TO " +
      lab.dbAdmin.escapeIdentifier(lab.approver));
    const actor = await connect(lab.name,lab.approver);
    try {
      await expect(actor.query(
        "DELETE FROM platform_schema_revocation_audit WHERE installation_id=$1",
        [lab.installationId],
      )).rejects.toMatchObject({code:"42501"});
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM platform_schema_revocation_audit")).rowCount).toBe(1);
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE DELETE ON platform_schema_revocation_audit FROM " +
        lab.dbAdmin.escapeIdentifier(lab.approver));
    }
  });

  it("AUTH-21: an unregistered runtime login cannot author through a misgranted entrypoint", async () => {
    const lab = e();
    const sig = "public.platform_schema_submit_plan(text,text,text,text)";
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION " + sig + " TO " +
      lab.dbAdmin.escapeIdentifier(lab.runtimeRole));
    try {
      await expect(lab.runtime.query(
        "SELECT public.platform_schema_submit_plan($1,$2,$3,$4)",
        [lab.installationId,"d".repeat(64),
          JSON.stringify(lab.current),JSON.stringify(lab.plan)],
      )).rejects.toMatchObject({code:"42501"});
    } finally {
      await lab.dbAdmin.query("REVOKE EXECUTE ON FUNCTION " + sig + " FROM " +
        lab.dbAdmin.escapeIdentifier(lab.runtimeRole));
    }
  });

  it("AUTH-22: a real approver cannot extend an approval using direct UPDATE", async () => {
    const lab = e();
    await lab.dbAdmin.query("GRANT UPDATE ON platform_schema_approvals TO " +
      lab.dbAdmin.escapeIdentifier(lab.approver));
    const actor = await connect(lab.name,lab.approver);
    try {
      await expect(actor.query(
        "UPDATE platform_schema_approvals SET expires_at=expires_at+interval '1 day'",
      )).rejects.toMatchObject({code:"42501"});
    } finally {
      await actor.end();
      await lab.dbAdmin.query("REVOKE UPDATE ON platform_schema_approvals FROM " +
        lab.dbAdmin.escapeIdentifier(lab.approver));
    }
  });

  it("AUTH-18: failed journal authorization rolls back DDL; later approval remains bounded", async () => {
    const lab = labs[7]!;
    await approve(lab);
    const before = await contentChecksum(lab);
    await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_migration_journal FROM " +
      lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    try {
      await expect(run(lab)).rejects.toThrow();
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(before);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM platform_schema_migration_journal")).rowCount).toBe(0);
      const current = await lab.dbAdmin.query<{manifest_digest:string}>(
        "SELECT manifest_digest FROM platform_schema_registry");
      expect(current.rows[0]?.manifest_digest).toBe(lab.current.digest);
    } finally {
      await lab.dbAdmin.query("GRANT INSERT ON platform_schema_migration_journal TO " +
        lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    }
    expect((await run(lab)).status).toBe("APPLIED");
    const revoker = await connect(lab.name,lab.approver);
    try {
      await revoker.query("SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,operation(lab)]);
    } finally { await revoker.end(); }
    await expect(run(lab)).rejects.toMatchObject({ code:"UNAUTHORIZED" });
    expect((await lab.dbAdmin.query(
      "SELECT 1 FROM platform_schema_migration_journal")).rowCount).toBe(1);
    expect(await contentChecksum(lab)).toBe(before);
  },30000);
  it("AUTH-23: registry-first order prevents direct INSERT/advisory lock inversion", async () => {
    const lab = e(); // Approved, not yet executed; isolated from Agent02 cases.
    const actor = await connect(lab.name, lab.approver);
    const grantRole = lab.dbAdmin.escapeIdentifier(lab.approver);
    await lab.dbAdmin.query("GRANT INSERT ON platform_schema_approvals TO " + grantRole);
    let signal!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(resolve => { signal = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const proxied = {
      escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
      query: async (sql: string, params?: unknown[]) => {
        const result = await lab.operator.query(sql, params);
        if (sql.includes("FROM public.platform_schema_registry WHERE installation_id") &&
            sql.includes("FOR UPDATE")) {
          signal(); // The operator holds the registry row before approval lock.
          await released;
        }
        return result;
      },
    } as unknown as ClientBase;
    const execution = executeApprovedAdditiveColumn(proxied, {
      installationId: lab.installationId, planDigest: lab.plan.digest,
    });
    let inserted: Promise<unknown> | undefined;
    try {
      await Promise.race([
        locked,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("REGISTRY_LOCK_BARRIER_TIMEOUT")), 5000)),
      ]);
      // Deliberately misgrant raw INSERT to a genuine independent approver.
      // A duplicate approval follows exactly the same advisory key as the
      // operator. Registry-first acquisition must make INSERT wait here.
      inserted = actor.query(
        "INSERT INTO platform_schema_approvals " +
        "(installation_id,plan_digest,operation_id,approver,operator_role,environment,expires_at) " +
        "VALUES($1,$2,$3,$4,$5,'test',clock_timestamp()+interval '20 minutes')",
        [lab.installationId,lab.plan.digest,operation(lab),lab.approver,lab.operatorRole],
      );
      let waiting = false;
      for (let n = 0; n < 40; n += 1) {
        const state = await lab.dbAdmin.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [actor.processID ?? -1],
        );
        if (state.rows[0]?.wait_event_type === "Lock") {
          waiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting, "Direct INSERT must wait for registry row lock, not approval lock")
        .toBe(true);
      release();
      expect((await execution).status).toBe("APPLIED");
      // E2's additional SECURITY INVOKER provenance trigger now denies
      // a direct, mistakenly granted INSERT rather than fetching privileged
      // roster data. Existing registry-before-approval lock ordering above
      // is still verified; E2 fails closed with 42501, not duplicate 23505.
      await expect(inserted).rejects.toMatchObject({code:"42501"});
      expect(await hasWebsite(lab)).toBe(true);
      expect((await lab.dbAdmin.query(
        "SELECT * FROM platform_schema_migration_journal")).rowCount).toBe(1);
    } finally {
      release();
      await Promise.allSettled([execution,inserted ?? Promise.resolve()]);
      await actor.end();
      await lab.dbAdmin.query("REVOKE INSERT ON platform_schema_approvals FROM " + grantRole);
    }
  },20000);

});


describe("AG06-S03-08 — proposed final pre-DDL approval expiry boundary (PG16)", () => {
  async function shortApproval(lab: Lab, milliseconds: number): Promise<void> {
    const actor = await connect(lab.name, lab.approver);
    try {
      await actor.query(
        "SELECT public.platform_schema_approve_operation($1,$2,$3," +
        "clock_timestamp() + $4::int * interval '1 millisecond')",
        [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id, milliseconds],
      );
    } finally {
      await actor.end();
    }
  }

  async function isExpired(lab: Lab): Promise<boolean> {
    const check = await lab.dbAdmin.query<{ expired: boolean }>(
      "SELECT expires_at <= clock_timestamp() AS expired " +
      "FROM public.platform_schema_approvals WHERE installation_id = $1",
      [lab.installationId],
    );
    return check.rows[0]?.expired === true;
  }

  it("EXP-01: five real table-lock waits crossing expiry must DENY without DDL or journal", async () => {
    for (const key of ["i", "j", "k", "l", "m"] as const) {
      const lab = await createLab(key);
      labs.push(lab);
      const beforeChecksum = await contentChecksum(lab);
      const blocker = await connect(lab.name);
      let pending: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          'LOCK TABLE ONLY "public".' + blocker.escapeIdentifier(lab.table) +
          " IN ACCESS EXCLUSIVE MODE",
        );
        // The approval must be valid at the initial authorization read;
        // the external relation lock forces expiry before the final decision.
        await shortApproval(lab, 1100);
        let signal!: () => void;
        const aboutToLock = new Promise<void>(resolve => { signal = resolve; });
        const proxy = new Proxy(lab.operator, {
          get(target, property) {
            if (property === "query") {
              return async (sql: string, params?: readonly unknown[]) => {
                if (sql.startsWith("LOCK TABLE ONLY")) signal();
                return target.query(sql, params);
              };
            }
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        pending = executeApprovedAdditiveColumn(proxy, {
          installationId: lab.installationId, planDigest: lab.plan.digest,
        });
        await Promise.race([
          aboutToLock,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(Error("authorization never reached table lock")), 2500)),
        ]);
        const initiallyValid = await lab.dbAdmin.query<{ valid: boolean }>(
          "SELECT approved_at <= clock_timestamp() AND expires_at > clock_timestamp() " +
          "AND revoked_at IS NULL AS valid FROM public.platform_schema_approvals " +
          "WHERE installation_id = $1",
          [lab.installationId],
        );
        expect(initiallyValid.rows[0]?.valid, "pre-lock approval must be valid").toBe(true);
        let waiting = false;
        for (let n = 0; n < 32; n += 1) {
          const state = await lab.dbAdmin.query<{ wait_event_type: string | null }>(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
            [lab.operator.processID ?? -1],
          );
          if (state.rows[0]?.wait_event_type === "Lock") { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(waiting, "operator must encounter a real PostgreSQL relation lock wait")
          .toBe(true);
        let expired = false;
        for (let n = 0; n < 75; n += 1) {
          if (await isExpired(lab)) { expired = true; break; }
          await new Promise(resolve => setTimeout(resolve, 16));
        }
        expect(expired, "approval must expire during the bounded relation lock wait")
          .toBe(true);
      } finally {
        await blocker.query("ROLLBACK").catch(() => undefined);
        await blocker.end().catch(() => undefined);
      }
      expect(pending).toBeDefined();
      await expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(beforeChecksum);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id = $1",
        [lab.installationId],
      )).rowCount).toBe(0);
      const state = await lab.dbAdmin.query<{ manifest_digest: string }>(
        "SELECT manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",
        [lab.installationId],
      );
      expect(state.rows[0]?.manifest_digest).toBe(lab.current.digest);
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  }, 65000);

  it("EXP-02: expiry after final authorization is nonretroactive under proposed Policy A", async () => {
    const lab = await createLab("n");
    labs.push(lab);
    await shortApproval(lab, 1200);
    const originalChecksum = await contentChecksum(lab);
    let signal!: () => void;
    let release!: () => void;
    const finalized = new Promise<void>(resolve => { signal = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const proxy = new Proxy(lab.operator, {
      get(target, property) {
        if (property === "query") {
          return async (sql: string, params?: readonly unknown[]) => {
            const result = await target.query(sql, params);
            if (sql.includes("clock_timestamp() AS checked_at")) {
              signal();
              await gate; // Deliberate test-only post-decision pause, not production code.
            }
            return result;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const pending = executeApprovedAdditiveColumn(proxy, {
      installationId: lab.installationId, planDigest: lab.plan.digest,
    });
    try {
      await Promise.race([
        finalized,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("final authorization point not reached")), 2500)),
      ]);
      let expired = false;
      for (let n = 0; n < 90; n += 1) {
        if (await isExpired(lab)) { expired = true; break; }
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      expect(expired).toBe(true);
    } finally {
      release();
    }
    const result = await pending;
    expect(result.status).toBe("APPLIED");
    expect(await hasWebsite(lab)).toBe(true);
    expect(await contentChecksum(lab)).toBe(originalChecksum);
    const journal = await lab.dbAdmin.query<{
      authorization_policy: string;
      final_authorized_at: string;
      completion_after_expiry: boolean;
    }>(
      "SELECT catalog_evidence->>'authorizationPolicy' AS authorization_policy, " +
      "catalog_evidence->>'finalAuthorizedAt' AS final_authorized_at, " +
      "completed_at > (SELECT expires_at FROM public.platform_schema_approvals " +
      "WHERE installation_id = $1) AS completion_after_expiry " +
      "FROM public.platform_schema_migration_journal WHERE installation_id = $1",
      [lab.installationId],
    );
    expect(journal.rows).toHaveLength(1);
    expect(journal.rows[0]?.authorization_policy).toBe("FINAL_PRE_DDL");
    expect(journal.rows[0]?.final_authorized_at).toBeTruthy();
    expect(journal.rows[0]?.completion_after_expiry).toBe(true);
    await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }, 15000);
});


/**
 * AG05 + AG03: test-only PostgreSQL 16 adversarial actor-state and watchdog
 * evidence. No production watchdog, privilege grant, DDL interface or policy
 * alteration. Owner P05/R1 requires denial after committed pre-final actor
 * deactivation; epoch and reapproval semantics remain unapproved.
 */
describe("M03-S03 IAM-RACE-01 real privileged actor-state transitions", () => {
  async function assertNoWrite(lab: Lab, before: string): Promise<void> {
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
    const journal = await lab.dbAdmin.query(
      "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
      [lab.installationId],
    );
    expect(journal.rowCount).toBe(0);
    const registry = await lab.dbAdmin.query<{manifest_digest:string}>(
      "SELECT manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",
      [lab.installationId],
    );
    expect(registry.rows[0]?.manifest_digest).toBe(lab.current.digest);
  }

  // A separate real PG session owns ACCESS EXCLUSIVE, so the operator is
  // confirmed to be waiting at the exact boundary, not merely JS-delayed.
  async function deactivateDuringTargetWait(
    key: "o" | "p", kind: "AUTHOR" | "APPROVER",
  ): Promise<void> {
    const lab = await createLab(key);
    labs.push(lab);
    await approve(lab);
    const before = await contentChecksum(lab);
    const original = kind === "AUTHOR" ? lab.author : lab.approver;
    const blocker = await connect(lab.name);
    let pending: Promise<Awaited<ReturnType<typeof run>>> | undefined;
    let signal!: () => void;
    const aboutToLock = new Promise<void>(resolve => { signal = resolve; });
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        'LOCK TABLE ONLY "public".' + blocker.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      );
      const proxied = {
        escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith("LOCK TABLE ONLY")) signal();
          return params ? lab.operator.query(sql, params) : lab.operator.query(sql);
        },
      } as unknown as ClientBase;
      pending = executeApprovedAdditiveColumn(proxied, {
        installationId: lab.installationId, planDigest: lab.plan.digest,
      });
      await Promise.race([
        aboutToLock,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("ACTOR_TARGET_LOCK_BARRIER_TIMEOUT")), 2500)),
      ]);
      let observedWait = false;
      for (let i = 0; i < 45; i += 1) {
        const wait = await lab.dbAdmin.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [lab.operator.processID ?? -1],
        );
        if (wait.rows[0]?.wait_event_type === "Lock") {
          observedWait = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      expect(observedWait, "actual PostgreSQL relation lock wait must be observed")
        .toBe(true);
      // The actor roster guard allows only owner/superuser. The fixture admin
      // acts exclusively as disposable owner; ordinary actors cannot do this.
      await lab.dbAdmin.query("BEGIN");
      await lab.dbAdmin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1 AND actor_kind=$2",
        [original, kind],
      );
      await lab.dbAdmin.query("COMMIT");
      const state = await lab.dbAdmin.query<{active:boolean}>(
        "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
        [original],
      );
      expect(state.rows[0]?.active).toBe(false);
      // Owner-approved P05/R1: committed deactivation during the real
      // ACCESS EXCLUSIVE wait MUST deny final authorization.
      await blocker.query("ROLLBACK");
      await expect(pending).rejects.toMatchObject({code:"UNAUTHORIZED"});
      await assertNoWrite(lab, before);
      await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end().catch(() => undefined);
      await Promise.allSettled([pending ?? Promise.resolve()]);
    }
  }

  it("R1-02: approver committed inactive during real table wait, experimental source DENIES", async () => {
    await deactivateDuringTargetWait("o", "APPROVER");
  }, 30000);

  it("R1-01: author committed inactive during real table wait, experimental source DENIES", async () => {
    await deactivateDuringTargetWait("p", "AUTHOR");
  }, 30000);

  it("IAM-RACE-01C: privileged actor deactivated before initial roster read must DENY without DDL", async () => {
    const lab = await createLab("q");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=false " +
      "WHERE login_name=$1", [lab.approver],
    );
    await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await assertNoWrite(lab, checksum);
  }, 30000);

  it("IAM-RACE-01D: queued immediately after approval advisory lock but before roster read, deactivation denies", async () => {
    const lab = await createLab("r");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    let notify!: () => void;
    let release!: () => void;
    const atFence = new Promise<void>(resolve => { notify = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const wrapped = {
      escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
      query: async (sql:string, params?:unknown[]) => {
        const result = params ? await lab.operator.query(sql, params) :
          await lab.operator.query(sql);
        if (sql.includes("vibress_m03s03_approval")) {
          notify();
          await gate;
        }
        return result;
      },
    } as unknown as ClientBase;
    const pending = executeApprovedAdditiveColumn(wrapped, {
      installationId:lab.installationId,planDigest:lab.plan.digest,
    });
    try {
      await Promise.race([
        atFence,
        new Promise<never>((_,reject) =>
          setTimeout(() => reject(Error("ACTOR_ADVISORY_BARRIER_TIMEOUT")), 2500)),
      ]);
      // Unlike approval revocation, roster deactivation does not acquire
      // the approval-specific advisory lock; it commits while fence is held.
      await lab.dbAdmin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1", [lab.approver],
      );
    } finally {
      release();
    }
    await expect(pending).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await assertNoWrite(lab,checksum);
  }, 30000);

  it("E2-REPLAY-01: deactivate-reactivate must NOT revive old approval (test-only E2-A)", async () => {
    const lab = await createLab("s");
    labs.push(lab);
    await approve(lab);
    const before = await contentChecksum(lab);
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=false " +
      "WHERE login_name=$1", [lab.approver],
    );
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=true " +
      "WHERE login_name=$1", [lab.approver],
    );
    await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(await contentChecksum(lab)).toBe(before);
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query(
      "SELECT 1 FROM public.platform_schema_migration_journal"
    )).rowCount).toBe(0);
    // Experimental E2-A generation bound reapproval is NOT owner approved.
  }, 30000);
});

/**
 * IAM-WD-01 READ-ONLY OBSERVATION PROTOTYPE. This is deliberately NOT an
 * authorization to call pg_cancel_backend: separate PID lookup then signal
 * has a TOCTOU window, and pg_stat_activity lacks current SET ROLE state.
 */
describe("M03-S03 IAM-WD-01 real PostgreSQL backend-binding negatives (observation only)", () => {
  type Probe = {
    pid: number;
    backend_start: string;
    database_oid: string;
    database_name: string;
    login_name: string;
    backend_type: string;
  };
  type Binding = Probe & {
    operationId: string;
    createdAtNs: bigint;
    leaseMs: number;
    dedicated: boolean;
    eligible: boolean;
  };
  async function observe(lab: Lab, pid: number): Promise<Probe | undefined> {
    const result = await lab.dbAdmin.query<Probe>(
      "SELECT pid, backend_start::text AS backend_start, " +
      "datid::text AS database_oid, datname AS database_name, " +
      "usename::text AS login_name, backend_type " +
      "FROM pg_catalog.pg_stat_activity WHERE pid=$1",
      [pid],
    );
    return result.rows[0];
  }
  async function matchObservation(
    lab: Lab, binding: Binding | undefined, claimedOperationId: string,
  ): Promise<boolean> {
    if (!binding || !binding.dedicated || !binding.eligible ||
        !binding.operationId || binding.operationId !== claimedOperationId ||
        binding.leaseMs <= 0 ||
        process.hrtime.bigint() - binding.createdAtNs >=
          BigInt(binding.leaseMs) * 1_000_000n) return false;
    const current = await observe(lab, binding.pid);
    return !!current && current.pid === binding.pid &&
      current.backend_start === binding.backend_start &&
      current.database_oid === binding.database_oid &&
      current.database_name === binding.database_name &&
      current.login_name === binding.login_name &&
      current.backend_type === "client backend";
  }

  it("IAM-WD-01A: wrong PID/start/database/OID/login/token/pool/expiry all DENY, correct server snapshot matches", async () => {
    const lab = await createLab("t");
    labs.push(lab);
    const probe = await observe(lab,lab.operator.processID ?? -1);
    expect(probe).toBeDefined();
    expect(probe?.login_name).toBe(lab.operatorRole);
    const binding: Binding = {...probe!,operationId:"opaque-test-only-" + id,
      createdAtNs:process.hrtime.bigint(),leaseMs:2517,
      dedicated:true,eligible:true};
    expect(await matchObservation(lab,binding,binding.operationId)).toBe(true);
    expect(await matchObservation(lab,{...binding,pid:lab.runtime.processID ?? -1},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,{...binding,backend_start:"2000-01-01 00:00:00+00"},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,{...binding,database_oid:"0"},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,{...binding,database_name:"wrong_fixture"},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,{...binding,login_name:lab.runtimeRole},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,binding,"forged-operation")).toBe(false);
    expect(await matchObservation(lab,{...binding,dedicated:false},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,{...binding,eligible:false},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,{...binding,
      createdAtNs:process.hrtime.bigint()-3_000_000_000n},
      binding.operationId)).toBe(false);
    expect(await matchObservation(lab,undefined,binding.operationId)).toBe(false);
    // No pg_cancel_backend or privileged mutation occurs on an accepted
    // observation. Acceptance is NOT atomic cancel/termination permission.
  },30000);

  it("IAM-WD-01B: independent runtime cannot cancel or terminate operator; replaced backend denies stale binding", async () => {
    const lab = await createLab("u");
    labs.push(lab);
    await expect(lab.runtime.query(
      "SELECT pg_catalog.pg_cancel_backend($1)",[lab.operator.processID ?? -1],
    )).rejects.toMatchObject({code:"42501"});
    await expect(lab.runtime.query(
      "SELECT pg_catalog.pg_terminate_backend($1)",[lab.operator.processID ?? -1],
    )).rejects.toMatchObject({code:"42501"});
    // Real session replacement must invalidate the old pid/start binding.
    const previous = await connect(lab.name,lab.operatorRole);
    const previousProbe = await observe(lab,previous.processID ?? -1);
    expect(previousProbe).toBeDefined();
    await previous.end();
    const replacement = await connect(lab.name,lab.operatorRole);
    try {
      const replacementProbe = await observe(lab,replacement.processID ?? -1);
      expect(replacementProbe).toBeDefined();
      expect(
        previousProbe?.pid === replacementProbe?.pid &&
        previousProbe?.backend_start === replacementProbe?.backend_start,
      ).toBe(false);
    } finally {
      await replacement.end();
    }
  },30000);
});


describe("M03-S03 supplemental actor rollback, revocation and SQLSTATE failures", () => {
  it("IAM-RACE-01F: aborted privileged actor deactivation is not a committed policy change", async () => {
    const lab = await createLab("v");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    await lab.dbAdmin.query("BEGIN");
    try {
      await lab.dbAdmin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1", [lab.approver],
      );
      expect((await lab.dbAdmin.query<{active:boolean}>(
        "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
        [lab.approver],
      )).rows[0]?.active).toBe(false);
    } finally {
      await lab.dbAdmin.query("ROLLBACK");
    }
    expect((await lab.dbAdmin.query<{active:boolean}>(
      "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
      [lab.approver],
    )).rows[0]?.active).toBe(true);
    expect((await run(lab)).status).toBe("APPLIED");
    expect(await contentChecksum(lab)).toBe(checksum);
  },30000);

  it("IAM-RACE-01G: concurrent committed roster change does not bypass approval-revocation fence", async () => {
    const lab = await createLab("w");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    const blocker = await connect(lab.name);
    const revoker = await connect(lab.name, lab.approver);
    let ready!: () => void;
    const atTable = new Promise<void>(resolve => { ready = resolve; });
    let migrating: Promise<Awaited<ReturnType<typeof run>>> | undefined;
    let revoking: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        'LOCK TABLE ONLY "public".' + blocker.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      );
      const hooked = {
        escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
        query: async (sql:string, params?:unknown[]) => {
          if (sql.startsWith("LOCK TABLE ONLY")) ready();
          return params ? lab.operator.query(sql,params) : lab.operator.query(sql);
        },
      } as unknown as ClientBase;
      migrating = executeApprovedAdditiveColumn(hooked,{
        installationId:lab.installationId,planDigest:lab.plan.digest,
      });
      await Promise.race([
        atTable,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("ACTOR_REVOKER_TARGET_BARRIER_TIMEOUT")),2500)),
      ]);
      let waitingOnTable=false;
      for(let i=0;i<45;i+=1) {
        const state=await lab.dbAdmin.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [lab.operator.processID ?? -1],
        );
        if(state.rows[0]?.wait_event_type==="Lock"){waitingOnTable=true;break;}
        await new Promise(resolve=>setTimeout(resolve,15));
      }
      expect(waitingOnTable).toBe(true);
      revoking=revoker.query(
        "SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,lab.plan.operations[0]?.id],
      );
      let revocationWaiting=false;
      for(let i=0;i<45;i+=1) {
        const state=await lab.dbAdmin.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [revoker.processID ?? -1],
        );
        if(state.rows[0]?.wait_event_type==="Lock"){revocationWaiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,15));
      }
      expect(revocationWaiting).toBe(true);
      await lab.dbAdmin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1", [lab.author],
      );
      await blocker.query("ROLLBACK");
      // Actor deactivation was committed before the final decision. Deny.
      // Approval revocation still awaits the operator's transaction fence.
      await expect(migrating).rejects.toMatchObject({code:"UNAUTHORIZED"});
      await revoking;
      await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(checksum);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal"
      )).rowCount).toBe(0);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_revocation_audit"
      )).rowCount).toBe(1);
    } finally {
      await blocker.query("ROLLBACK").catch(()=>undefined);
      await Promise.allSettled([migrating ?? Promise.resolve(),revoking ?? Promise.resolve()]);
      await revoker.end().catch(()=>undefined);
      await blocker.end().catch(()=>undefined);
    }
  },30000);

  it("AG06-S03-10: real SQLSTATE 55P03 lock timeout is classified LOCK_NOT_AVAILABLE", async () => {
    const lab=await createLab("x");
    labs.push(lab);
    await approve(lab);
    const checksum=await contentChecksum(lab);
    const blocker=await connect(lab.name);
    const waiter=await connect(lab.name,lab.operatorRole);
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        'LOCK TABLE ONLY "public".' + blocker.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      );
      await waiter.query("BEGIN");
      await waiter.query("SET LOCAL lock_timeout='100ms'");
      await expect(waiter.query(
        'LOCK TABLE ONLY "public".' + waiter.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      )).rejects.toMatchObject({code:"55P03"});
      await waiter.query("ROLLBACK");
      // The same held real table lock triggers operator's 2000ms cap.
      // Operational SQLSTATE must not be represented as IAM denial.
      await expect(run(lab)).rejects.toMatchObject({code:"LOCK_NOT_AVAILABLE"});
      // The external ACCESS EXCLUSIVE lock also blocks checksum SELECT.
      // Release it before postconditions; its waiter already timed out safely.
      await blocker.query("ROLLBACK");
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(checksum);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal"
      )).rowCount).toBe(0);
    } finally {
      await waiter.query("ROLLBACK").catch(()=>undefined);
      await waiter.end().catch(()=>undefined);
      await blocker.query("ROLLBACK").catch(()=>undefined);
      await blocker.end().catch(()=>undefined);
    }
  },15000);
});


/**
 * Isolated P05/R1 post-catalog actor advisory fencing. These deterministic tests
 * observe actual PG16 blocked backends; poll sleeps only observe wait state,
 * never determine correctness of transaction ordering.
 */
describe("P05/R1 advisory-lock serialization (EXPERIMENT ONLY)", () => {
  it("R1-06: deactivation queued after final authorization commits after DDL", async () => {
    const lab = await createLab("y");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    const admin = await connect(lab.name);
    let reached!: () => void;
    let release!: () => void;
    const atFinal = new Promise<void>(resolve => { reached = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    let migrating: ReturnType<typeof executeApprovedAdditiveColumn> | undefined;
    let deactivating: Promise<unknown> | undefined;
    try {
      const hooked = {
        escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
        query: async (sql: string, params?: unknown[]) => {
          const result = params ? await lab.operator.query(sql, params) :
            await lab.operator.query(sql);
          if (sql.includes("clock_timestamp() AS checked_at")) {
            reached();
            await proceed; // ONLY test proxy delays after valid final decision.
          }
          return result;
        },
      } as unknown as ClientBase;
      migrating = executeApprovedAdditiveColumn(hooked, {
        installationId: lab.installationId, planDigest: lab.plan.digest,
      });
      await Promise.race([
        atFinal,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("R1_FINAL_BARRIER_TIMEOUT")), 4000)),
      ]);
      deactivating = admin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1", [lab.approver],
      );
      let blocked = false;
      for (let j = 0; j < 100; j += 1) {
        const probe = await lab.dbAdmin.query<{wait_event_type: string | null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [admin.processID ?? -1],
        );
        if (probe.rows[0]?.wait_event_type === "Lock") {
          blocked = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked, "actor UPDATE must wait for operator's advisory fence").toBe(true);
      release();
      expect((await migrating).status).toBe("APPLIED");
      await deactivating;
      expect(await hasWebsite(lab)).toBe(true);
      expect(await contentChecksum(lab)).toBe(checksum);
      const row = await lab.dbAdmin.query<{active: boolean}>(
        "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
        [lab.approver],
      );
      expect(row.rows[0]?.active).toBe(false);
      const journal = await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
        [lab.installationId],
      );
      expect(journal.rowCount).toBe(1);
    } finally {
      release();
      await Promise.allSettled([migrating ?? Promise.resolve(),
        deactivating ?? Promise.resolve()]);
      await admin.end().catch(() => undefined);
    }
  }, 30000);

  it("R1-09: an uncommitted deactivation blocks final row lock; COMMIT then denies", async () => {
    const lab = await createLab("z");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    const admin = await connect(lab.name);
    let reached!: () => void;
    const atActor = new Promise<void>(resolve => { reached = resolve; });
    let migrating: ReturnType<typeof executeApprovedAdditiveColumn> | undefined;
    try {
      await admin.query("BEGIN");
      await admin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1", [lab.author],
      );
      const hooked = {
        escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes("pg_advisory_xact_lock(hashtext('vibress_m03s03_actor')")) reached();
          return params ? lab.operator.query(sql, params) : lab.operator.query(sql);
        },
      } as unknown as ClientBase;
      migrating = executeApprovedAdditiveColumn(hooked, {
        installationId: lab.installationId, planDigest: lab.plan.digest,
      });
      await Promise.race([
        atActor,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("R1_ACTOR_ROW_BARRIER_TIMEOUT")), 4000)),
      ]);
      let blocked = false;
      for (let j = 0; j < 100; j += 1) {
        const probe = await lab.dbAdmin.query<{wait_event_type: string | null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [lab.operator.processID ?? -1],
        );
        if (probe.rows[0]?.wait_event_type === "Lock") {
          blocked = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked, "operator must wait for actor writer's advisory fence").toBe(true);
      await admin.query("COMMIT");
      await expect(migrating).rejects.toMatchObject({code:"UNAUTHORIZED"});
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(checksum);
      const journal = await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
        [lab.installationId],
      );
      expect(journal.rowCount).toBe(0);
      const registry = await lab.dbAdmin.query<{manifest_digest: string}>(
        "SELECT manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",
        [lab.installationId],
      );
      expect(registry.rows[0]?.manifest_digest).toBe(lab.current.digest);
    } finally {
      await admin.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([migrating ?? Promise.resolve()]);
      await admin.end().catch(() => undefined);
    }
  }, 30000);
});


/**
 * R1-10: Real PG16 mixed admin lock inversion proof.
 * This NEGATIVE test deliberately creates a deadlock between the existing
 * approval advisory key and the proposed actor-specific advisory key.
 * It is diagnostic evidence that the prototype is NOT production-ready.
 * Both sessions always roll back, so no real actor lifecycle mutation,
 * approval revocation or DDL can be committed by this test.
 */
describe("P05/R1 mixed-admin lock-order adversarial test (EXPERIMENT ONLY)", () => {
  it("R1-10: actor-first admin plus approval-first operator exposes 40P01 safely", async () => {
    const lab = await createLab("aa");
    labs.push(lab);
    await approve(lab);
    const before = await contentChecksum(lab);
    const operator = lab.operator;
    const admin = lab.dbAdmin;
    type Outcome = { ok: boolean; code: string | null };
    const settle = (p: Promise<unknown>): Promise<Outcome> =>
      p.then(() => ({ ok: true, code: null }),
        (err: unknown) => ({
          ok: false,
          code: typeof err === "object" && err !== null && "code" in err &&
            typeof err.code === "string" ? err.code : null,
        }));
    let operatorWait: Promise<Outcome> | undefined;
    let adminWait: Promise<Outcome> | undefined;
    try {
      await admin.query("BEGIN");
      await operator.query("BEGIN");
      // New fixture trigger holds actor advisory key for admin transaction.
      await admin.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false " +
        "WHERE login_name=$1", [lab.author],
      );
      // Operator has already obtained its existing approval advisory key A.
      await operator.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_approval'), " +
        "hashtext($1::text || ':' || $2::text || ':' || $3::text))",
        [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id],
      );
      // Operator now needs actor X, which is owned by the admin.
      operatorWait = settle(operator.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_actor'), " +
        "hashtext($1::text))", [lab.author],
      ));
      let operatorWaiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const probe = await cluster.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [operator.processID ?? -1],
        );
        if (probe.rows[0]?.wait_event_type === "Lock") {
          operatorWaiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(operatorWaiting, "must observe real PostgreSQL advisory wait").toBe(true);
      // Source-pinned diagnostic evidence: PID, exact backend_start, blocking
      // backend identity and PostgreSQL advisory/transaction locks. These
      // metadata contain no credentials, actor secrets or raw SQL parameters.
      const waitingEvidence = await cluster.query<{
        pid:number; backend_start:string; wait_event_type:string|null;
        wait_event:string|null; blockers:number[];
      }>(
        "SELECT pid,backend_start::text AS backend_start,wait_event_type,wait_event,"+
        "pg_blocking_pids(pid) AS blockers FROM pg_stat_activity "+
        "WHERE pid=ANY($1::int[]) ORDER BY pid",
        [[operator.processID??-1,admin.processID??-1]],
      );
      const advisoryEvidence = await cluster.query<{
        pid:number;locktype:string;mode:string;granted:boolean;
        classid:number|null;objid:number|null;objsubid:number|null;
      }>(
        "SELECT pid,locktype,mode,granted,classid,objid,objsubid "+
        "FROM pg_locks WHERE pid=ANY($1::int[]) "+
        "AND locktype IN ('advisory','transactionid') ORDER BY pid,locktype,mode",
        [[operator.processID??-1,admin.processID??-1]],
      );
      console.info("R1_10_BACKEND_TRACE="+JSON.stringify(waitingEvidence.rows));
      console.info("R1_10_ADVISORY_TRACE="+JSON.stringify(advisoryEvidence.rows));
      expect(waitingEvidence.rows.some(x => x.pid===(operator.processID??-1) &&
        x.wait_event_type==="Lock" &&
        x.blockers.includes(admin.processID??-1))).toBe(true);
      // Admin already holds actor X; approval UPDATE trigger needs key A.
      // PostgreSQL detects the resulting two-backend cycle and aborts one.
      adminWait = settle(admin.query(
        "UPDATE public.platform_schema_approvals SET revoked_at=clock_timestamp() " +
        "WHERE installation_id=$1 AND plan_digest=$2 AND operation_id=$3",
        [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id],
      ));
      const [opOutcome, adminOutcome] = await Promise.all([operatorWait, adminWait]);
      expect(
        [opOutcome, adminOutcome].some(x => x.code === "40P01"),
        "PG16 must detect and abort one deadlock victim with SQLSTATE 40P01",
      ).toBe(true);
    } finally {
      await admin.query("ROLLBACK").catch(() => undefined);
      await operator.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([
        operatorWait ?? Promise.resolve(),
        adminWait ?? Promise.resolve(),
      ]);
    }
    // The entire simulated admin and operator interaction was rolled back.
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
    const journal = await admin.query(
      "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
      [lab.installationId],
    );
    expect(journal.rowCount).toBe(0);
    const registry = await admin.query<{manifest_digest:string}>(
      "SELECT manifest_digest FROM public.platform_schema_registry WHERE installation_id=$1",
      [lab.installationId],
    );
    expect(registry.rows[0]?.manifest_digest).toBe(lab.current.digest);
    const actor = await admin.query<{active:boolean}>(
      "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
      [lab.author],
    );
    expect(actor.rows[0]?.active).toBe(true);
  }, 30000);
});


/**
 * L1 global admin order (fixture-only). The supported protocol takes the
 * approval-specific transaction advisory key first, then actor keys in stable
 * order, BEFORE the first UPDATE acquires any implicit tuple locks. This is
 * an owner-only SECURITY INVOKER disposable gateway, NOT an authorized
 * production administrative entrypoint or privileged function.
 */
describe("R1-10 corrected L1 admin ordering (DISPOSABLE ONLY)", () => {
  it("R1-10-FIX: approval-first admin cannot hold actor X while waiting for operator approval A", async () => {
    const lab = await createLab("ab");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    const operator = lab.operator, admin = lab.dbAdmin;
    let adminWait: Promise<unknown> | undefined;
    try {
      await operator.query("BEGIN");
      await operator.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_approval'), " +
        "hashtext($1::text || ':' || $2::text || ':' || $3::text))",
        [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id],
      );
      await admin.query("BEGIN");
      // L1 test-only SECURITY INVOKER admin gateway serializes I/R/A/X
      // before actor UPDATE and approval UPDATE. This is not a migration.
      adminWait = admin.query(
        "SELECT public.s03_test_governed_deactivate_and_revoke($1,$2,$3,$4)",
        [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id, lab.author],
      );
      let blocked = false;
      for (let attempt=0; attempt<100; attempt+=1) {
        const probe = await cluster.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [admin.processID ?? -1],
        );
        if (probe.rows[0]?.wait_event_type === "Lock") {
          blocked=true; break;
        }
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked, "admin must wait for approval key BEFORE any actor row lock").toBe(true);
      // Operator already has approval A, and can now acquire actor X without
      // waiting: admin holds NO actor-row/advisory lock in the corrected order.
      await operator.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_actor'), hashtext($1::text))",
        [lab.author],
      );
      await operator.query("COMMIT");
      await adminWait; // Gateway took A and X before the row DML.
      await admin.query("COMMIT");
    } finally {
      await operator.query("ROLLBACK").catch(()=>undefined);
      await admin.query("ROLLBACK").catch(()=>undefined);
      await Promise.allSettled([adminWait ?? Promise.resolve()]);
    }
    expect((await admin.query<{active:boolean}>(
      "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
      [lab.author],
    )).rows[0]?.active).toBe(false);
    expect((await admin.query<{revoked:boolean}>(
      "SELECT revoked_at IS NOT NULL AS revoked FROM public.platform_schema_approvals " +
      "WHERE installation_id=$1", [lab.installationId],
    )).rows[0]?.revoked).toBe(true);
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await admin.query(
      "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
      [lab.installationId],
    )).rowCount).toBe(0);
  },30000);
});

/**
 * Experimental E2-A: immutable instance + increasing generation bound into
 * plan and approval via fixture-only triggers. Owner has NOT approved E2-A.
 * Neither fixture-only DDL nor these test outcomes imply policy authorization.
 */
describe("E2 actor generation/provenance adversarial tests (TEST-ONLY POLICY)", () => {
  it("E2-01: APPROVER deactivate/reactivate increments epoch and rejects old signed approval", async () => {
    const lab=await createLab("ac"); labs.push(lab);
    await approve(lab);
    const checksum=await contentChecksum(lab);
    const before=(await lab.dbAdmin.query<{
      actor_instance_id:string;actor_generation:string
    }>("SELECT actor_instance_id,actor_generation::text FROM public.platform_schema_trusted_actors "+
      "WHERE login_name=$1",[lab.approver])).rows[0]!;
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=false WHERE login_name=$1",
      [lab.approver],
    );
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=true WHERE login_name=$1",
      [lab.approver],
    );
    const after=(await lab.dbAdmin.query<{
      actor_instance_id:string;actor_generation:string
    }>("SELECT actor_instance_id,actor_generation::text FROM public.platform_schema_trusted_actors "+
      "WHERE login_name=$1",[lab.approver])).rows[0]!;
    expect(after.actor_instance_id).toBe(before.actor_instance_id);
    expect(BigInt(after.actor_generation)).toBe(BigInt(before.actor_generation)+2n);
    await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query(
      "SELECT 1 FROM public.platform_schema_migration_journal WHERE installation_id=$1",
      [lab.installationId],
    )).rowCount).toBe(0);
  },30000);

  it("E2-02: AUTHOR deactivate/reactivate rejects old plan and approval", async () => {
    const lab=await createLab("ad"); labs.push(lab);
    await approve(lab);
    const before=await contentChecksum(lab);
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=false WHERE login_name=$1",
      [lab.author],
    );
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET active=true WHERE login_name=$1",
      [lab.author],
    );
    await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await expect(lab.dbAdmin.query(
      "UPDATE public.platform_schema_trusted_actors SET actor_generation=actor_generation+1 " +
      "WHERE login_name=$1", [lab.author],
    )).rejects.toMatchObject({code:"42501"});
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
  },30000);

  it("E2-03: DELETE and re-register same LOGIN gets new actor instance; old approval denied", async () => {
    const lab=await createLab("ae"); labs.push(lab);
    await approve(lab);
    const before=await contentChecksum(lab);
    const saved=(await lab.dbAdmin.query<{
      actor_instance_id:string;principal_id:string
    }>("SELECT actor_instance_id, principal_id FROM public.platform_schema_trusted_actors "+
      "WHERE login_name=$1",[lab.approver])).rows[0]!;
    await lab.dbAdmin.query(
      "DELETE FROM public.platform_schema_trusted_actors WHERE login_name=$1",
      [lab.approver],
    );
    await lab.dbAdmin.query(
      "INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind) " +
      "VALUES($1,$2,'APPROVER')",
      [lab.approver,saved.principal_id],
    );
    const restored=(await lab.dbAdmin.query<{
      actor_instance_id:string
    }>("SELECT actor_instance_id FROM public.platform_schema_trusted_actors "+
      "WHERE login_name=$1",[lab.approver])).rows[0]!;
    expect(restored.actor_instance_id).not.toBe(saved.actor_instance_id);
    await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
  },30000);

  it("E2-04: legacy NULL approval generation fails closed", async () => {
    const lab=await createLab("af"); labs.push(lab);
    await approve(lab);
    const before=await contentChecksum(lab);
    // Fixture database owner simulates an old/unauthenticated imported row.
    await lab.dbAdmin.query(
      "UPDATE public.platform_schema_approvals SET approver_actor_generation=NULL " +
      "WHERE installation_id=$1", [lab.installationId],
    );
    await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
  },30000);
});


describe("R1-10 governed ADMIN vs legacy revoker (TEST-ONLY)", () => {
  it("R1-10-FIX2: legacy approval UPDATE row-before-A and governed gateway remain acyclic", async () => {
    const lab=await createLab("ag"); labs.push(lab);
    await approve(lab);
    const checksum=await contentChecksum(lab);
    const op=lab.operator, admin=lab.dbAdmin;
    const revoker=await connect(lab.name,lab.approver);
    type Result={ok:boolean;code:string|null};
    const settle=(p:Promise<unknown>):Promise<Result>=>p.then(
      ()=>({ok:true,code:null}),
      (e:unknown)=>({ok:false,code:typeof e==="object"&&e!==null&&
        "code" in e&&typeof e.code==="string"?e.code:null}),
    );
    const waitBlocked=async (pid:number):Promise<boolean>=>{
      for(let i=0;i<120;i+=1){
        const row=await cluster.query<{wait_event_type:string|null}>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid]);
        if(row.rows[0]?.wait_event_type==="Lock")return true;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      return false;
    };
    let revoking:Promise<Result>|undefined;
    let adminCall:Promise<Result>|undefined;
    try {
      await op.query("BEGIN");
      await op.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_approval'),"+
        "hashtext($1::text||':'||$2::text||':'||$3::text))",
        [lab.installationId,lab.plan.digest,lab.plan.operations[0]?.id]);
      await revoker.query("BEGIN");
      revoking=settle(revoker.query(
        "SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,lab.plan.operations[0]?.id],
      ));
      expect(await waitBlocked(revoker.processID??-1),
        "real direct revoker must wait on operator approval A while holding approval row").toBe(true);
      await admin.query("BEGIN");
      adminCall=settle(admin.query(
        "SELECT public.s03_test_governed_deactivate_and_revoke($1,$2,$3,$4)",
        [lab.installationId,lab.plan.digest,lab.plan.operations[0]?.id,lab.author],
      ));
      expect(await waitBlocked(admin.processID??-1),
        "governed gateway must wait before obtaining actor X").toBe(true);
      // Operator can acquire X; admin has only the earlier independent lock
      // chain and cannot hold the actor fence before its approval row/A locks.
      await op.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_actor'),"+
        "hashtext($1::text))",[lab.author]);
      await op.query("COMMIT");
      expect((await revoking).ok).toBe(true);
      await revoker.query("COMMIT");
      const adminOutcome=await adminCall;
      expect(adminOutcome).toEqual({ok:false,code:"42501"});
      await admin.query("ROLLBACK");
    } finally {
      await op.query("ROLLBACK").catch(()=>undefined);
      await revoker.query("ROLLBACK").catch(()=>undefined);
      await admin.query("ROLLBACK").catch(()=>undefined);
      await Promise.allSettled([revoking??Promise.resolve(),adminCall??Promise.resolve()]);
      await revoker.end().catch(()=>undefined);
    }
    expect((await admin.query<{active:boolean}>(
      "SELECT active FROM public.platform_schema_trusted_actors WHERE login_name=$1",
      [lab.author],
    )).rows[0]?.active).toBe(true);
    expect((await admin.query<{revoked:boolean}>(
      "SELECT revoked_at IS NOT NULL AS revoked FROM public.platform_schema_approvals "+
      "WHERE installation_id=$1",[lab.installationId],
    )).rows[0]?.revoked).toBe(true);
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await admin.query("SELECT 1 FROM public.platform_schema_migration_journal "+
      "WHERE installation_id=$1",[lab.installationId])).rowCount).toBe(0);
  },30000);
});

describe("E2 negative privilege, UUID tombstone and rollback tests (EXPERIMENT ONLY)",()=>{
  it("E2-05: operator/runtime cannot mutate roster or execute governed admin gateway",async()=>{
    const lab=await createLab("ah");labs.push(lab);
    await approve(lab);
    const before=await contentChecksum(lab);
    for(const actor of [lab.operator,lab.runtime]){
      await expect(actor.query(
        "UPDATE public.platform_schema_trusted_actors SET active=false WHERE login_name=$1",
        [lab.approver],
      )).rejects.toMatchObject({code:"42501"});
      await expect(actor.query(
        "SELECT public.s03_test_governed_deactivate_and_revoke($1,$2,$3,$4)",
        [lab.installationId,lab.plan.digest,lab.plan.operations[0]?.id,lab.author],
      )).rejects.toMatchObject({code:"42501"});
    }
    const grants=await lab.dbAdmin.query<{operator_update:boolean;runtime_update:boolean;
      operator_admin_exec:boolean;runtime_admin_exec:boolean}>(
      "SELECT has_table_privilege($1,'public.platform_schema_trusted_actors','UPDATE') "+
      "AS operator_update, "+
      "has_table_privilege($2,'public.platform_schema_trusted_actors','UPDATE') "+
      "AS runtime_update, "+
      "has_function_privilege($1,'public.s03_test_governed_deactivate_and_revoke(text,text,text,text)','EXECUTE') "+
      "AS operator_admin_exec, "+
      "has_function_privilege($2,'public.s03_test_governed_deactivate_and_revoke(text,text,text,text)','EXECUTE') "+
      "AS runtime_admin_exec",
      [lab.operatorRole,lab.runtimeRole],
    );
    expect(grants.rows[0]).toEqual({operator_update:false,runtime_update:false,
      operator_admin_exec:false,runtime_admin_exec:false});
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
  },30000);

  it("E2-06: append-only actor-instance history blocks UUID resurrection after DELETE",async()=>{
    const lab=await createLab("ai");labs.push(lab);
    await approve(lab);
    const before=await contentChecksum(lab);
    const actor=(await lab.dbAdmin.query<{actor_instance_id:string;principal_id:string}>(
      "SELECT actor_instance_id,principal_id FROM public.platform_schema_trusted_actors "+
      "WHERE login_name=$1",[lab.approver])).rows[0]!;
    await lab.dbAdmin.query("BEGIN");
    try{
      await lab.dbAdmin.query(
        "DELETE FROM public.platform_schema_trusted_actors WHERE login_name=$1",
        [lab.approver],
      );
      await expect(lab.dbAdmin.query(
        "INSERT INTO public.platform_schema_trusted_actors "+
        "(login_name,principal_id,actor_kind,actor_instance_id) "+
        "VALUES($1,$2,'APPROVER',$3::uuid)",
        [lab.approver,actor.principal_id,actor.actor_instance_id],
      )).rejects.toMatchObject({code:"23505"});
    }finally{
      await lab.dbAdmin.query("ROLLBACK").catch(()=>undefined);
    }
    const restored=(await lab.dbAdmin.query<{actor_instance_id:string}>(
      "SELECT actor_instance_id FROM public.platform_schema_trusted_actors "+
      "WHERE login_name=$1",[lab.approver])).rows[0]!;
    expect(restored.actor_instance_id).toBe(actor.actor_instance_id);
    await expect(lab.dbAdmin.query(
      "DELETE FROM public.s03_e2_actor_instance_history WHERE actor_instance_id=$1::uuid",
      [actor.actor_instance_id],
    )).rejects.toMatchObject({code:"42501"});
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
  },30000);
});

describe("P06/D1 experimental dispatch and known committed outcome", () => {
  it("D1-01: expired budget refuses even BEGIN and preserves database state", async () => {
    const lab = await createLab("aj");
    labs.push(lab);
    await approve(lab);
    let tick = 0;
    const budget = new ExperimentalD1Budget(() => tick);
    tick = 2518;
    await expect(executeApprovedAdditiveColumn(lab.operator,
      { installationId: lab.installationId, planDigest: lab.plan.digest }, budget))
      .rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM platform_schema_migration_journal")).rowCount).toBe(0);
  }, 30000);

  it("D1-02: exhaustion after real journal INSERT prevents COMMIT and rolls back DDL", async () => {
    const lab = await createLab("ak");
    labs.push(lab);
    await approve(lab);
    const before = await contentChecksum(lab);
    let tick = 0;
    const budget = new ExperimentalD1Budget(() => tick);
    const issued: string[] = [];
    const hooked = {
      escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
      query: async (sql: string, params?: unknown[]) => {
        issued.push(sql);
        const result = params ? await lab.operator.query(sql, params) : await lab.operator.query(sql);
        if (sql.startsWith("INSERT INTO public.platform_schema_migration_journal")) tick = 2518;
        return result;
      },
    } as unknown as ClientBase;
    await expect(executeApprovedAdditiveColumn(hooked,
      { installationId: lab.installationId, planDigest: lab.plan.digest }, budget))
      .rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(issued).not.toContain("COMMIT");
    expect(issued).toContain("ROLLBACK");
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(before);
    expect((await lab.dbAdmin.query("SELECT 1 FROM platform_schema_migration_journal")).rowCount).toBe(0);
  }, 30000);

  it("D1-03: acknowledged real COMMIT after simulated deadline is COMMITTED_LATE, never APPLIED", async () => {
    const lab = await createLab("al");
    labs.push(lab);
    await approve(lab);
    let tick = 0;
    const budget = new ExperimentalD1Budget(() => tick);
    const hooked = {
      escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
      query: async (sql: string, params?: unknown[]) => {
        const result = params ? await lab.operator.query(sql, params) : await lab.operator.query(sql);
        if (sql === "COMMIT") tick = 2518;
        return result;
      },
    } as unknown as ClientBase;
    const result = await executeApprovedAdditiveColumn(hooked,
      { installationId: lab.installationId, planDigest: lab.plan.digest }, budget);
    expect(result.status).toBe("COMMITTED_LATE");
    expect(await hasWebsite(lab)).toBe(true);
    expect((await lab.dbAdmin.query("SELECT 1 FROM platform_schema_migration_journal WHERE status='COMPLETED'")).rowCount).toBe(1);
  }, 30000);
});

describe("P06 additive authorization identity (disposable prototype)", () => {
  it("P06-01: same canonical digest, fresh UUIDs, stale approval cannot authorize new operation", async () => {
    const lab = await createLab("am");
    labs.push(lab);
    await lab.dbAdmin.query(readFileSync(path.resolve(process.cwd(),
      "tests/fixtures/m03-s03-p06-authorization-identity-experimental.sql"), "utf8"));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_submit(text,text) TO " +
      lab.dbAdmin.escapeIdentifier(lab.author));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_approve(uuid) TO " +
      lab.dbAdmin.escapeIdentifier(lab.approver));
    const author = await connect(lab.name, lab.author);
    const approver = await connect(lab.name, lab.approver);
    try {
      const submit = async () => (await author.query<{ id: string }>(
        "SELECT public.s03_p06_submit($1,$2) AS id", [lab.installationId, lab.plan.digest])).rows[0]!.id;
      const sign = async (submission: string) => (await approver.query<{ id: string }>(
        "SELECT public.s03_p06_approve($1::uuid) AS id", [submission])).rows[0]!.id;
      const first = await submit();
      const oldApproval = await sign(first);
      await lab.dbAdmin.query("UPDATE public.platform_schema_trusted_actors SET active=false WHERE login_name=$1",
        [lab.approver]);
      await lab.dbAdmin.query("UPDATE public.platform_schema_trusted_actors SET active=true WHERE login_name=$1",
        [lab.approver]);
      await expect(sign(first)).rejects.toMatchObject({ code: "42501" });
      const second = await submit();
      const freshApproval = await sign(second);
      const read = await lab.dbAdmin.query<{ submission_id: string; operation_id: string; canonical_plan_digest: string }>(
        "SELECT submission_id,operation_id,canonical_plan_digest FROM public.s03_p06_submissions WHERE submission_id=ANY($1::uuid[])",
        [[first, second]]);
      const old = read.rows.find(row => row.submission_id === first)!;
      const fresh = read.rows.find(row => row.submission_id === second)!;
      expect(old.canonical_plan_digest).toBe(lab.plan.digest);
      expect(fresh.canonical_plan_digest).toBe(lab.plan.digest);
      expect(first).not.toBe(second);
      expect(old.operation_id).not.toBe(fresh.operation_id);
      expect(oldApproval).not.toBe(freshApproval);
      const current = async (op: string, approval: string) => (await lab.dbAdmin.query<{ valid: boolean }>(
        "SELECT public.s03_p06_is_current($1::uuid,$2::uuid) AS valid", [op, approval])).rows[0]?.valid;
      expect(await current(old.operation_id, oldApproval)).toBe(false);
      expect(await current(fresh.operation_id, oldApproval)).toBe(false);
      expect(await current(fresh.operation_id, freshApproval)).toBe(true);
      await expect(lab.runtime.query("SELECT public.s03_p06_submit($1,$2)",
        [lab.installationId, lab.plan.digest])).rejects.toMatchObject({ code: "42501" });
      await expect(approver.query("UPDATE public.s03_p06_approvals SET approver_generation=1"))
        .rejects.toMatchObject({ code: "42501" });
      expect(await hasWebsite(lab)).toBe(false);
    } finally {
      await author.end();
      await approver.end();
    }
  }, 30000);
});

describe("L1 delegated actor-only lifecycle gateway (disposable, narrow path)", () => {
  it("L1-P06-01: denies direct DML, permits scoped gateway, and blocks in-flight stale authorization", async () => {
    const lab = await createLab("an");
    labs.push(lab);
    await approve(lab);
    const before = await contentChecksum(lab);
    const delegate = "s03_delegate_" + lab.key + "_" + id;
    const gateway = "s03_gateway_" + lab.key + "_" + id;
    const esc = (name: string) => lab.dbAdmin.escapeIdentifier(name);
    await cluster.query("CREATE ROLE " + esc(delegate) +
      " LOGIN PASSWORD " + cluster.escapeLiteral(password) +
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await cluster.query("CREATE ROLE " + esc(gateway) +
      " NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await cluster.query("GRANT CONNECT ON DATABASE " + esc(lab.name) + " TO " + esc(delegate));
    await lab.dbAdmin.query(readFileSync(path.resolve(process.cwd(),
      "tests/fixtures/m03-s03-p06-l1-actor-gateway-experimental.sql"), "utf8"));
    await lab.dbAdmin.query("GRANT USAGE ON SCHEMA public TO " + esc(delegate) + "," + esc(gateway));
    await lab.dbAdmin.query("GRANT SELECT ON public.platform_schema_registry, public.s03_p06_admin_capability, " +
      "public.platform_schema_trusted_actors TO " + esc(gateway));
    await lab.dbAdmin.query("GRANT UPDATE(active) ON public.platform_schema_trusted_actors TO " + esc(gateway));
    await lab.dbAdmin.query("ALTER FUNCTION public.s03_p06_set_actor_active(text,text,boolean) OWNER TO " + esc(gateway));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_set_actor_active(text,text,boolean) TO " + esc(delegate));
    await lab.dbAdmin.query("INSERT INTO public.s03_p06_admin_capability VALUES ($1,$2)",
      [lab.installationId, delegate]);
    const admin = await connect(lab.name, delegate);
    const blocker = await connect(lab.name);
    let pending: ReturnType<typeof run> | undefined;
    try {
      for (const query of [
        "UPDATE public.platform_schema_trusted_actors SET active=false",
        "DELETE FROM public.platform_schema_trusted_actors",
        "INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind) VALUES ('x','x','AUTHOR')",
      ]) await expect(admin.query(query)).rejects.toMatchObject({ code: "42501" });
      await expect(admin.query("SET ROLE " + esc(gateway))).rejects.toMatchObject({ code: "42501" });
      await expect(lab.runtime.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",
        [lab.installationId, lab.author])).rejects.toMatchObject({ code: "42501" });
      await expect(admin.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",
        ["wrong-installation", lab.author])).rejects.toMatchObject({ code: "42501" });
      await blocker.query("BEGIN");
      await blocker.query('LOCK TABLE ONLY "public".' + esc(lab.table) + " IN ACCESS EXCLUSIVE MODE");
      pending = run(lab);
      // Attach rejection handler immediately while observing backend lock wait.
      void pending.catch(() => undefined);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const row = (await lab.dbAdmin.query<{ waiting: boolean }>(
          "SELECT cardinality(pg_blocking_pids($1)) > 0 AS waiting", [lab.operator.processID ?? -1])).rows[0];
        if (row?.waiting) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await admin.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",
        [lab.installationId, lab.author]);
      await blocker.query("ROLLBACK");
      await expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(before);
      expect((await lab.dbAdmin.query("SELECT 1 FROM public.platform_schema_migration_journal")).rowCount).toBe(0);
      const row = (await lab.dbAdmin.query<{ active: boolean; actor_generation: string }>(
        "SELECT active,actor_generation FROM public.platform_schema_trusted_actors WHERE login_name=$1",
        [lab.author])).rows[0];
      expect(row).toEqual({ active: false, actor_generation: "2" });
      const audit = await lab.dbAdmin.query<{ changed_by: string; new_generation: string }>(
        "SELECT changed_by,new_generation FROM public.s03_p06_lifecycle_audit");
      expect(audit.rows).toEqual([{ changed_by: delegate, new_generation: "2" }]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await pending?.catch(() => undefined);
      await blocker.end();
      await admin.end();
    }
  }, 30000);
});

async function p06Install(lab:Lab):Promise<void> {
  await lab.dbAdmin.query("BEGIN");
  try {
    for(const fixture of ["m03-s03-p06-authorization-identity-experimental.sql","m03-s03-p06-l1-actor-gateway-experimental.sql","m03-s03-p06-integrated-journal-experimental.sql"])
      await lab.dbAdmin.query(readFileSync(path.resolve(process.cwd(),"tests/fixtures",fixture),"utf8"));
    const epoch = randomUUID();
    await lab.dbAdmin.query("INSERT INTO public.s03_p06_recovery_epochs VALUES($1,$2::uuid)", [lab.installationId,epoch]);
    await lab.dbAdmin.query("INSERT INTO public.s03_p06_actor_enrollments(actor_instance_id,epoch_id,role_oid) "+
      "SELECT a.actor_instance_id,$1::uuid,r.oid FROM public.platform_schema_trusted_actors a JOIN pg_catalog.pg_roles r ON r.rolname=a.login_name", [epoch]);
    await lab.dbAdmin.query("GRANT SELECT ON public.s03_p06_recovery_epochs,public.s03_p06_actor_enrollments TO "+lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_submit(text,text) TO "+lab.dbAdmin.escapeIdentifier(lab.author));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_approve(uuid),public.s03_p06_revoke(uuid) TO "+lab.dbAdmin.escapeIdentifier(lab.approver));
    await lab.dbAdmin.query("GRANT SELECT ON public.s03_p06_submissions,public.s03_p06_approvals,public.s03_p06_revocations,public.s03_p06_completed_operations TO "+lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    await lab.dbAdmin.query("GRANT INSERT ON public.s03_p06_completed_operations TO "+lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    await lab.dbAdmin.query("REVOKE EXECUTE ON FUNCTION public.platform_schema_approve_operation(text,text,text,timestamptz),public.platform_schema_revoke_operation(text,text,text) FROM "+lab.dbAdmin.escapeIdentifier(lab.approver));
    await lab.dbAdmin.query("COMMIT");
    labEpochs.set(lab.installationId+":"+lab.name,epoch);
  } catch(error){await lab.dbAdmin.query("ROLLBACK");throw error;}
}
async function freshP06(lab:Lab):Promise<SchemaOperatorRequest>{
  const author=await connect(lab.name,lab.author),approver=await connect(lab.name,lab.approver);
  try{
    const submissionId=(await author.query<{id:string}>("SELECT public.s03_p06_submit($1,$2) AS id",[lab.installationId,lab.plan.digest])).rows[0]!.id;
    const approvalId=(await approver.query<{id:string}>("SELECT public.s03_p06_approve($1::uuid) AS id",[submissionId])).rows[0]!.id;
    const operationId=(await lab.dbAdmin.query<{operation_id:string}>("SELECT operation_id FROM public.s03_p06_submissions WHERE submission_id=$1::uuid",[submissionId])).rows[0]!.operation_id;
    return {installationId:lab.installationId,planDigest:lab.plan.digest,submissionId,approvalId,operationId,envelopeVersion:1};
  } finally {await author.end();await approver.end();}
}
describe("P06-E2E integrated actual operator and atomic journal",()=>{
  it("P06-E2E-01: reject legacy, mismatched approval, concurrent retry and stale same-content precondition",async()=>{
    const lab=await createLab("ao");labs.push(lab);await approve(lab);await p06Install(lab);
    await expect(executeP06(lab.operator,{installationId:lab.installationId,planDigest:lab.plan.digest} as SchemaOperatorRequest,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    const first=await freshP06(lab),second=await freshP06(lab);
    await expect(reconcileP06(lab.operator,first,new ExperimentalD1Budget())).rejects.toMatchObject({code:"INDETERMINATE"});
    expect(await hasWebsite(lab)).toBe(false);
    expect(first.planDigest).toBe(second.planDigest);expect(first.operationId).not.toBe(second.operationId);
    await expect(executeP06(lab.operator,{...first,approvalId:second.approvalId},new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    const other=await connect(lab.name,lab.operatorRole);
    try{
      const both=await Promise.all([executeP06(lab.operator,first,new ExperimentalD1Budget()),executeP06(other,first,new ExperimentalD1Budget())]);
      expect(both.map(x=>x.status).sort()).toEqual(["ALREADY_APPLIED","APPLIED"]);
    }finally{await other.end();}
    await expect(executeP06(lab.operator,second,new ExperimentalD1Budget())).rejects.toMatchObject({code:"STALE_PLAN"});
    const evidence=await lab.dbAdmin.query("SELECT operation_id,submission_id,approval_id,canonical_plan_digest FROM public.s03_p06_completed_operations");
    expect(evidence.rows).toEqual([{operation_id:first.operationId,submission_id:first.submissionId,approval_id:first.approvalId,canonical_plan_digest:first.planDigest}]);
    expect(await hasWebsite(lab)).toBe(true);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.platform_schema_migration_journal")).rowCount).toBe(0);
  },30000);
  it("P06-E2E-02: reactivation, revocation and repeated submission in one transaction fail closed",async()=>{
    const lab=await createLab("ap");labs.push(lab);await p06Install(lab);
    const old=await freshP06(lab);
    await lab.dbAdmin.query("UPDATE public.platform_schema_trusted_actors SET active=false WHERE login_name=$1",[lab.approver]);
    await lab.dbAdmin.query("UPDATE public.platform_schema_trusted_actors SET active=true WHERE login_name=$1",[lab.approver]);
    await expect(executeP06(lab.operator,old,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    const fresh=await freshP06(lab);const approver=await connect(lab.name,lab.approver),author=await connect(lab.name,lab.author);
    try{
      await approver.query("SELECT public.s03_p06_revoke($1::uuid)",[fresh.approvalId]);
      await expect(executeP06(lab.operator,fresh,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
      await author.query("BEGIN");
      await author.query("SELECT public.s03_p06_submit($1,$2)",[lab.installationId,lab.plan.digest]);
      await expect(author.query("SELECT public.s03_p06_submit($1,$2)",[lab.installationId,lab.plan.digest])).rejects.toMatchObject({code:"42501"});
      await author.query("ROLLBACK");
    }finally{await author.end();await approver.end();}
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
  },30000);
  it("P06-E2E-03: journal constraint failure rolls back DDL and CAS; same identity can retry",async()=>{
    const lab=await createLab("aq");labs.push(lab);await p06Install(lab);
    const request=await freshP06(lab),before=await contentChecksum(lab);
    await lab.dbAdmin.query("ALTER TABLE public.s03_p06_completed_operations ADD CONSTRAINT p06_test_fail CHECK(false)");
    await expect(executeP06(lab.operator,request,new ExperimentalD1Budget())).rejects.toMatchObject({code:"OPERATION_FAILED"});
    expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(before);
    expect((await lab.dbAdmin.query("SELECT manifest_digest FROM public.platform_schema_registry")).rows[0]?.manifest_digest).toBe(lab.current.digest);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    await lab.dbAdmin.query("ALTER TABLE public.s03_p06_completed_operations DROP CONSTRAINT p06_test_fail");
    expect((await executeP06(lab.operator,request,new ExperimentalD1Budget())).status).toBe("APPLIED");
  },30000);
});

describe("Integrated P06 D1 and R1 safety",()=>{
  it("P06-E2E-04: governed actor mutation during target lock wait invalidates actual fresh approval",async()=>{
    const lab=await createLab("ar");labs.push(lab);await p06Install(lab);
    const request=await freshP06(lab),before=await contentChecksum(lab);
    const delegate="s03_delegate_"+lab.key+"_"+id,gateway="s03_gateway_"+lab.key+"_"+id;
    const esc=(name:string)=>lab.dbAdmin.escapeIdentifier(name);
    await cluster.query("CREATE ROLE "+esc(delegate)+" LOGIN PASSWORD "+cluster.escapeLiteral(password)+
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await cluster.query("CREATE ROLE "+esc(gateway)+" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await cluster.query("GRANT CONNECT ON DATABASE "+esc(lab.name)+" TO "+esc(delegate));
    await lab.dbAdmin.query("GRANT USAGE ON SCHEMA public TO "+esc(delegate)+","+esc(gateway));
    await lab.dbAdmin.query("GRANT SELECT ON public.platform_schema_registry,public.s03_p06_admin_capability,public.platform_schema_trusted_actors TO "+esc(gateway));
    await lab.dbAdmin.query("GRANT UPDATE(active) ON public.platform_schema_trusted_actors TO "+esc(gateway));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_enter() TO "+esc(gateway));
    await lab.dbAdmin.query("ALTER FUNCTION public.s03_p06_set_actor_active(text,text,boolean) OWNER TO "+esc(gateway));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_set_actor_active(text,text,boolean) TO "+esc(delegate));
    await lab.dbAdmin.query("INSERT INTO public.s03_p06_admin_capability(installation_id,delegate_login) VALUES($1,$2)",[lab.installationId,delegate]);
    const admin=await connect(lab.name,delegate),blocker=await connect(lab.name);
    let pending:ReturnType<typeof executeP06>|undefined;
    try{
      await expect(admin.query("UPDATE public.platform_schema_trusted_actors SET active=false")).rejects.toMatchObject({code:"42501"});
      await admin.query("BEGIN");
      await admin.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",[lab.installationId,lab.author]);
      await expect(admin.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",[lab.installationId,lab.approver])).rejects.toMatchObject({code:"42501"});
      await admin.query("ROLLBACK");
      await blocker.query("BEGIN");
      await blocker.query('LOCK TABLE ONLY "public".'+esc(lab.table)+" IN ACCESS EXCLUSIVE MODE");
      pending=executeP06(lab.operator,request,new ExperimentalD1Budget());
      void pending.catch(()=>undefined);
      let blocked=false;
      for(let i=0;i<100;i++){
        const row=(await lab.dbAdmin.query<{waiting:boolean}>("SELECT cardinality(pg_blocking_pids($1))>0 AS waiting",[lab.operator.processID??-1])).rows[0];
        if(row?.waiting){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);
      await admin.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",[lab.installationId,lab.approver]);
      await blocker.query("ROLLBACK");
      await expect(pending).rejects.toMatchObject({code:"UNAUTHORIZED"});
      expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(before);
      expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    }finally{await blocker.query("ROLLBACK").catch(()=>undefined);await pending?.catch(()=>undefined);await blocker.end();await admin.end();}
  },30000);
  it("P06-E2E-05: deadline exhaustion after new journal insertion prevents COMMIT and rolls back",async()=>{
    const lab=await createLab("as");labs.push(lab);await p06Install(lab);
    const request=await freshP06(lab),before=await contentChecksum(lab);let tick=0;
    const budget=new ExperimentalD1Budget(()=>tick);
    const issued:string[]=[];
    const wrapped={getTransactionStatus: () => (lab.operator as Client & {getTransactionStatus(): string | null}).getTransactionStatus(),escapeIdentifier:lab.operator.escapeIdentifier.bind(lab.operator),query:async(sql:string,params?:unknown[])=>{
      issued.push(sql);const result=params?await lab.operator.query(sql,params):await lab.operator.query(sql);
      if(sql.startsWith("INSERT INTO public.s03_p06_completed_operations"))tick=2518;
      return result;
    }} as unknown as ClientBase;
    await expect(executeP06(wrapped,request,budget)).rejects.toMatchObject({code:"DEADLINE_EXCEEDED"});
    expect(issued).not.toContain("COMMIT");expect(issued).toContain("ROLLBACK");
    expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(before);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
  },30000);
  it("P06-E2E-06: lost ACK is indeterminate; fresh session reconciles exact UUID without second DDL",async()=>{
    const lab=await createLab("at");labs.push(lab);await p06Install(lab);const request=await freshP06(lab);
    const wrapped={getTransactionStatus: () => (lab.operator as Client & {getTransactionStatus(): string | null}).getTransactionStatus(),escapeIdentifier:lab.operator.escapeIdentifier.bind(lab.operator),query:async(sql:string,params?:unknown[])=>{
      const result=params?await lab.operator.query(sql,params):await lab.operator.query(sql);
      if(sql==="COMMIT")throw new Error("simulated lost commit acknowledgment after actual server commit");
      return result;
    }} as unknown as ClientBase;
    await expect(executeP06(wrapped,request,new ExperimentalD1Budget())).rejects.toMatchObject({code:"INDETERMINATE"});
    const other=await connect(lab.name,lab.operatorRole);
    try{expect((await reconcileP06(other,request,new ExperimentalD1Budget())).status).toBe("ALREADY_APPLIED");}
    finally{await other.end();}
    expect(await hasWebsite(lab)).toBe(true);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(1);
  },30000);
});

describe("P06 integrated canonical and late-outcome regressions",()=>{
  it("P06-E2E-07: tampered persisted plan and unsupported envelope cannot authorize DDL",async()=>{
    const lab=await createLab("au");labs.push(lab);await p06Install(lab);const request=await freshP06(lab);
    await expect(executeP06(lab.operator,{...request,envelopeVersion:2} as unknown as SchemaOperatorRequest,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await expect(executeP06(lab.operator,{...request,planDigest:"d".repeat(64)},new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await lab.dbAdmin.query("UPDATE public.platform_schema_plans SET plan=$1 WHERE installation_id=$2 AND plan_digest=$3",
      [JSON.stringify({...lab.plan,digest:"d".repeat(64)}),lab.installationId,lab.plan.digest]);
    await expect(executeP06(lab.operator,request,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
  },30000);
  it("P06-E2E-08: actual COMMIT with simulated late clock must not return APPLIED",async()=>{
    const lab=await createLab("av");labs.push(lab);await p06Install(lab);const request=await freshP06(lab);
    let tick=0;const budget=new ExperimentalD1Budget(()=>tick);
    const wrapped={getTransactionStatus: () => (lab.operator as Client & {getTransactionStatus(): string | null}).getTransactionStatus(),escapeIdentifier:lab.operator.escapeIdentifier.bind(lab.operator),query:async(sql:string,params?:unknown[])=>{
      const result=params?await lab.operator.query(sql,params):await lab.operator.query(sql);
      if(sql==="COMMIT")tick=2518;return result;
    }} as unknown as ClientBase;
    expect((await executeP06(wrapped,request,budget)).status).toBe("COMMITTED_LATE");
    expect(await hasWebsite(lab)).toBe(true);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(1);
  },30000);
});

describe("P06 disposable additive migration recovery",()=>{
  it("P06-E2E-09: interrupted additive transaction preserves legacy rows; retry installs with legacy authorization denied",async()=>{
    const lab=await createLab("aw");labs.push(lab);await approve(lab);
    const checksum=await contentChecksum(lab);
    const count=await lab.dbAdmin.query("SELECT count(*)::text AS n FROM public.platform_schema_approvals");
    await lab.dbAdmin.query("BEGIN");
    try{
      for(const fixture of ["m03-s03-p06-authorization-identity-experimental.sql","m03-s03-p06-l1-actor-gateway-experimental.sql","m03-s03-p06-integrated-journal-experimental.sql"])
        await lab.dbAdmin.query(readFileSync(path.resolve(process.cwd(),"tests/fixtures",fixture),"utf8"));
      await expect(lab.dbAdmin.query("SELECT 1/0")).rejects.toMatchObject({code:"22012"});
    }finally{await lab.dbAdmin.query("ROLLBACK");}
    expect((await lab.dbAdmin.query("SELECT to_regclass('public.s03_p06_completed_operations') AS journal")).rows[0]?.journal).toBeNull();
    expect((await lab.dbAdmin.query("SELECT count(*)::text AS n FROM public.platform_schema_approvals")).rows).toEqual(count.rows);
    expect(await contentChecksum(lab)).toBe(checksum);
    await p06Install(lab);
    expect((await lab.dbAdmin.query("SELECT count(*)::text AS n FROM public.platform_schema_approvals")).rows).toEqual(count.rows);
    expect((await lab.dbAdmin.query("SELECT count(*)::text AS n FROM public.s03_p06_approvals")).rows[0]?.n).toBe("0");
    await expect(executeP06(lab.operator,{installationId:lab.installationId,planDigest:lab.plan.digest} as SchemaOperatorRequest,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    const request=await freshP06(lab);
    expect((await executeP06(lab.operator,request,new ExperimentalD1Budget())).status).toBe("APPLIED");
  },30000);
});

describe("Integrated P06 transaction-start acknowledgment safety", () => {
  it("P06-E2E-10: lost BEGIN acknowledgment rolls back actual server transaction before reporting failure", async () => {
    const lab = await createLab("ax");
    labs.push(lab);
    await p06Install(lab);
    const request = await freshP06(lab);
    const issued: string[] = [];
    const wrapped = {
      getTransactionStatus: () => (lab.operator as Client & {getTransactionStatus(): string | null}).getTransactionStatus(),
      query: async (sql: string) => {
        issued.push(sql);
        const result = await lab.operator.query(sql);
        if (sql.startsWith("BEGIN")) throw new Error("simulated lost BEGIN acknowledgment");
        return result;
      },
    } as unknown as ClientBase;
    await expect(executeP06(wrapped, request, new ExperimentalD1Budget()))
      .rejects.toMatchObject({ code: "VERIFIED_ROLLBACK" });
    expect(issued).toEqual(["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK"]);
    const activity = await lab.dbAdmin.query<{ idle: boolean; no_xact: boolean }>(
      "SELECT state='idle' AS idle,xact_start IS NULL AS no_xact FROM pg_stat_activity WHERE pid=$1",
      [lab.operator.processID],
    );
    expect(activity.rows).toEqual([{ idle: true, no_xact: true }]);
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect((await executeP06(lab.operator, request, new ExperimentalD1Budget())).status).toBe("APPLIED");
  }, 30000);

  it("P06-E2E-11: lost BEGIN and ROLLBACK acknowledgments remain indeterminate without dispatching operation SQL", async () => {
    const lab = await createLab("ay");
    labs.push(lab);
    await p06Install(lab);
    const request = await freshP06(lab);
    const issued: string[] = [];
    const wrapped = {
      getTransactionStatus: () => (lab.operator as Client & {getTransactionStatus(): string | null}).getTransactionStatus(),
      query: async (sql: string) => {
        issued.push(sql);
        await lab.operator.query(sql);
        throw new Error("simulated lost transaction-control acknowledgment");
      },
    } as unknown as ClientBase;
    await expect(executeP06(wrapped, request, new ExperimentalD1Budget()))
      .rejects.toMatchObject({ code: "INDETERMINATE" });
    expect(issued).toEqual(["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK"]);
    const other = await connect(lab.name, lab.operatorRole);
    try {
      await expect(reconcileP06(other, request, new ExperimentalD1Budget()))
        .rejects.toMatchObject({ code: "INDETERMINATE" });
    } finally {
      await other.end();
    }
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
  }, 30000);
});

describe("P06 seeded E2 migration identity preservation", () => {
  it("P06-E2E-12: migrated actors reserve UUIDs, legacy provenance stays null, and same LOGIN cannot revive authorization", async () => {
    const lab = await createLab("az", false);
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    // Apply the additive candidate to a genuinely pre-E2 roster and approval.
    await lab.dbAdmin.query(readFileSync(path.resolve(process.cwd(),
      "tests/fixtures/m03-s03-e2-actor-generation-experimental.sql"), "utf8"));
    const history = await lab.dbAdmin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.platform_schema_trusted_actors a "+
      "JOIN public.s03_e2_actor_instance_history h USING(actor_instance_id) "+
      "WHERE a.login_name=h.login_name AND a.principal_id=h.principal_id",
    );
    expect(history.rows[0]?.n).toBe("2");
    expect((await lab.dbAdmin.query(
      "SELECT author_actor_instance_id,author_actor_generation FROM public.platform_schema_plans",
    )).rows).toEqual([{ author_actor_instance_id: null, author_actor_generation: null }]);
    expect((await lab.dbAdmin.query(
      "SELECT author_actor_instance_id,author_actor_generation,approver_actor_instance_id,approver_actor_generation "+
      "FROM public.platform_schema_approvals",
    )).rows).toEqual([{ author_actor_instance_id: null, author_actor_generation: null,
      approver_actor_instance_id: null, approver_actor_generation: null }]);
    await p06Install(lab);
    const stale = await freshP06(lab);
    const prior = (await lab.dbAdmin.query<{ actor_instance_id: string; principal_id: string }>(
      "SELECT actor_instance_id,principal_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",
      [lab.author],
    )).rows[0]!;
    await lab.dbAdmin.query("DELETE FROM public.platform_schema_trusted_actors WHERE login_name=$1", [lab.author]);
    await expect(lab.dbAdmin.query(
      "INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind,actor_instance_id) "+
      "VALUES($1,$2,'AUTHOR',$3::uuid)", [lab.author, prior.principal_id, prior.actor_instance_id],
    )).rejects.toMatchObject({ code: "23505" });
    const replacement = (await lab.dbAdmin.query<{ actor_instance_id: string }>(
      "INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind) "+
      "VALUES($1,$2,'AUTHOR') RETURNING actor_instance_id", [lab.author, prior.principal_id],
    )).rows[0]!;
    expect(replacement.actor_instance_id).not.toBe(prior.actor_instance_id);
    await expect(executeP06(lab.operator, stale, new ExperimentalD1Budget()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    const fresh = await freshP06(lab);
    expect(fresh.planDigest).toBe(stale.planDigest);
    expect(fresh.operationId).not.toBe(stale.operationId);
    expect(fresh.approvalId).not.toBe(stale.approvalId);
    expect((await executeP06(lab.operator, fresh, new ExperimentalD1Budget())).status).toBe("APPLIED");
  }, 30000);
});

describe("P06 integrated residual concurrency and transport safety", () => {
  it("P06-E2E-13: real COMMIT packet loss quarantines the session; fresh reconciliation sees atomic state", async () => {
    const lab = await createLab("ba");
    labs.push(lab);
    await p06Install(lab);
    const request = await freshP06(lab);
    const checksum = await contentChecksum(lab);
    const proxy = await startCommitAckDropProxy();
    const connection = new URL(urlFor(lab.name, lab.operatorRole));
    connection.port = String(proxy.port);
    const budget = new ExperimentalD1Budget();
    const client = new Client({ connectionString: connection.toString(),
      connectionTimeoutMillis: Math.max(1, Math.floor(budget.remainingMs())),
      statement_timeout: Math.max(1, Math.floor(budget.remainingMs())) });
    client.on("error", () => undefined);
    void proxy.serverCommitObserved.catch(() => undefined);
    try {
      await client.connect();
      await expect(executeP06(client, request, budget)).rejects.toMatchObject({ code: "INDETERMINATE" });
      await proxy.serverCommitObserved;
      await expect(executeP06(client, request, new ExperimentalD1Budget())).rejects.toMatchObject({
        code: "INDETERMINATE", message: "session quarantined; use a fresh dedicated connection",
      });
      await expect(reconcileP06(client, request, new ExperimentalD1Budget())).rejects.toMatchObject({
        code: "INDETERMINATE", message: "session quarantined; use a fresh dedicated connection",
      });
    } finally {
      await client.end().catch(() => undefined);
      await proxy.close();
    }
    expect(await hasWebsite(lab)).toBe(true);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT manifest_digest FROM public.platform_schema_registry")).rows[0]?.manifest_digest)
      .toBe(lab.plan.proposedManifest.digest);
    expect((await lab.dbAdmin.query("SELECT operation_id FROM public.s03_p06_completed_operations")).rows)
      .toEqual([{ operation_id: request.operationId }]);
    const other = await connect(lab.name, lab.operatorRole);
    try {
      expect((await reconcileP06(other, request, new ExperimentalD1Budget())).status).toBe("ALREADY_APPLIED");
    } finally { await other.end(); }
  }, 30000);

  it("P06-E2E-14: actual overlapping same-client invocation denied and PG lock timeout classified without writes", async () => {
    const lab = await createLab("bb");
    labs.push(lab);
    await p06Install(lab);
    const request = await freshP06(lab);
    const checksum = await contentChecksum(lab);
    const blocker = await connect(lab.name);
    let pending: ReturnType<typeof executeP06> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query('LOCK TABLE ONLY "public".'+blocker.escapeIdentifier(lab.table)+" IN ACCESS EXCLUSIVE MODE");
      pending = executeP06(lab.operator, request, new ExperimentalD1Budget());
      void pending.catch(() => undefined);
      await expect(executeP06(lab.operator, request, new ExperimentalD1Budget())).rejects.toMatchObject({
        code: "OPERATION_FAILED", message: "dedicated session already in use",
      });
      await expect(pending).rejects.toMatchObject({ code: "LOCK_NOT_AVAILABLE" });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await pending?.catch(() => undefined);
      await blocker.end();
    }
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT manifest_digest FROM public.platform_schema_registry")).rows[0]?.manifest_digest)
      .toBe(lab.current.digest);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect((await executeP06(lab.operator, request, new ExperimentalD1Budget())).status).toBe("APPLIED");
  }, 30000);

  it("P06-E2E-15: accidental INSERT grant cannot bypass entrypoints; guard maintenance preserves active transaction", async () => {
    const lab = await createLab("bc");
    labs.push(lab);
    await p06Install(lab);
    const request = await freshP06(lab);
    await lab.dbAdmin.query("GRANT INSERT ON public.s03_p06_submissions,public.s03_p06_approvals,public.s03_p06_revocations,public.platform_schema_plans TO "
      +lab.dbAdmin.escapeIdentifier(lab.author));
    const author = await connect(lab.name, lab.author);
    try {
      for (const table of ["s03_p06_submissions", "s03_p06_approvals", "s03_p06_revocations", "platform_schema_plans"]) {
        await expect(author.query("INSERT INTO public."+author.escapeIdentifier(table)+" DEFAULT VALUES"))
          .rejects.toMatchObject({ code: "42501", message: "protected insert requires governed entrypoint" });
      }
      await expect(author.query("SELECT public.s03_p06_prune_call_guard()")).rejects.toMatchObject({ code: "42501" });
      await author.query("BEGIN");
      await author.query("SELECT public.s03_p06_submit($1,$2)", [lab.installationId, lab.plan.digest]);
      await lab.dbAdmin.query("SELECT public.s03_p06_prune_call_guard()");
      await expect(author.query("SELECT public.s03_p06_submit($1,$2)", [lab.installationId, lab.plan.digest]))
        .rejects.toMatchObject({ code: "42501" });
      await author.query("ROLLBACK");
      await lab.dbAdmin.query("SELECT public.s03_p06_prune_call_guard()");
      expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_call_guard")).rowCount).toBe(0);
    } finally { await author.query("ROLLBACK").catch(() => undefined); await author.end(); }
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect((await executeP06(lab.operator, request, new ExperimentalD1Budget())).status).toBe("APPLIED");
  }, 30000);
});

describe("P06 actual Drizzle migration-framework rehearsal", () => {
  it("P06-E2E-16: seeded 0059/0060 upgrade uses Drizzle journal, rolls back failed replay, then resumes", async () => {
    const lab = await createLab("bd", false);
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    const directory = mkdtempSync(path.join(tmpdir(), "vibress-s03-migrations-"));
    const candidate = readFileSync(path.resolve(process.cwd(),
      "tests/fixtures/m03-s03-e2-actor-generation-experimental.sql"), "utf8");
    const aclSql = "SELECT c.relname, c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND c.relname IN ('platform_schema_trusted_actors','platform_schema_plans','platform_schema_approvals') "+
      "ORDER BY c.relname";
    const beforeAcl = (await lab.dbAdmin.query(aclSql)).rows;
    const writeJournal = (includeFault: boolean) => {
      const entries = [{ idx: 0, version: "7", when: 1, tag: "experimental_e2", breakpoints: true }];
      if (includeFault) entries.push({ idx: 1, version: "7", when: 2, tag: "experimental_interruption", breakpoints: true });
      writeFileSync(path.join(directory, "meta", "_journal.json"), JSON.stringify({
        version: "7", dialect: "postgresql", entries,
      }));
    };
    try {
      mkdirSync(path.join(directory, "meta"));
      writeFileSync(path.join(directory, "experimental_e2.sql"), candidate);
      writeFileSync(path.join(directory, "experimental_interruption.sql"), "SELECT 1/0;");
      writeJournal(true);
      await expect(migrateDisposableSchemaCandidate(lab.dbAdmin, directory)).rejects.toThrow();
      expect((await lab.dbAdmin.query("SELECT to_regclass('public.s03_e2_actor_instance_history') AS history")).rows[0]?.history)
        .toBeNull();
      expect((await lab.dbAdmin.query("SELECT 1 FROM s03_experimental_drizzle.migration_log")).rowCount).toBe(0);
      expect(await contentChecksum(lab)).toBe(checksum);
      expect((await lab.dbAdmin.query(aclSql)).rows).toEqual(beforeAcl);
      writeJournal(false);
      await migrateDisposableSchemaCandidate(lab.dbAdmin, directory);
      expect((await lab.dbAdmin.query("SELECT 1 FROM s03_experimental_drizzle.migration_log")).rowCount).toBe(1);
      const roster = (await lab.dbAdmin.query("SELECT actor_instance_id,actor_generation FROM public.platform_schema_trusted_actors ORDER BY login_name")).rows;
      expect(roster).toHaveLength(2);
      expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_e2_actor_instance_history")).rowCount).toBe(2);
      expect((await lab.dbAdmin.query("SELECT author_actor_instance_id,approver_actor_instance_id FROM public.platform_schema_approvals")).rows)
        .toEqual([{ author_actor_instance_id: null, approver_actor_instance_id: null }]);
      const restarted = await connect(lab.name);
      try {
        await migrateDisposableSchemaCandidate(restarted, directory);
        expect((await restarted.query("SELECT 1 FROM s03_experimental_drizzle.migration_log")).rowCount).toBe(1);
        expect((await restarted.query("SELECT actor_instance_id,actor_generation FROM public.platform_schema_trusted_actors ORDER BY login_name")).rows)
          .toEqual(roster);
      } finally { await restarted.end(); }
      expect((await lab.dbAdmin.query(aclSql)).rows).toEqual(beforeAcl);
      await p06Install(lab);
      await expect(executeP06(lab.operator, {installationId:lab.installationId,planDigest:lab.plan.digest} as SchemaOperatorRequest,
        new ExperimentalD1Budget())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(checksum);
      const request = await freshP06(lab);
      expect((await executeP06(lab.operator, request, new ExperimentalD1Budget())).status).toBe("APPLIED");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30000);
});

describe("P06 dedicated session transaction admission", () => {
  it("P06-E2E-17: caller-owned active and aborted transactions cannot be committed by operator", async () => {
    const lab = await createLab("be");
    labs.push(lab);
    await p06Install(lab);
    const request = await freshP06(lab);
    const checksum = await contentChecksum(lab);
    try {
      await lab.operator.query("BEGIN");
      await lab.operator.query('INSERT INTO "public".'+lab.operator.escapeIdentifier(lab.table)+' ("name") VALUES ($1)', ["uncommitted"]);
      await expect(executeP06(lab.operator, request, new ExperimentalD1Budget())).rejects.toMatchObject({
        code: "OPERATION_FAILED", message: "dedicated session must be idle before operation",
      });
      expect(await contentChecksum(lab)).toBe(checksum);
      await expect(lab.operator.query("SELECT 1/0")).rejects.toMatchObject({ code: "22012" });
      await expect(reconcileP06(lab.operator, request, new ExperimentalD1Budget())).rejects.toMatchObject({
        code: "OPERATION_FAILED", message: "dedicated session must be idle before operation",
      });
    } finally { await lab.operator.query("ROLLBACK"); }
    expect(await contentChecksum(lab)).toBe(checksum);
    expect(await hasWebsite(lab)).toBe(false);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect((await executeP06(lab.operator, request, new ExperimentalD1Budget())).status).toBe("APPLIED");
  }, 30000);
});

describe("P06 isolated same-name backup and external recovery epoch", () => {
  it("P06-E2E-18: actual pg_dump/pg_restore rewinds local state but fresh signed epoch prevents historical replay", async () => {
    const lab = await createLab("bf");
    labs.push(lab);
    await p06Install(lab);
    const stale = await freshP06(lab);
    const revoked = await freshP06(lab);
    const completed = await freshP06(lab);
    const checksum = await contentChecksum(lab);
    const key = lab.installationId+":"+lab.name;
    const oldEpoch = labEpochs.get(key)!;
    const archive = spawnSync("docker", ["compose","-f","compose.dev.yml","exec","-T","postgres",
      "pg_dump","-U","vibress","--format=custom","--dbname",lab.name],
      { timeout: 20000, maxBuffer: 16*1024*1024 });
    expect(archive.status).toBe(0);
    expect(archive.stdout.length).toBeGreaterThan(0);
    const approver = await connect(lab.name, lab.approver);
    try { await approver.query("SELECT public.s03_p06_revoke($1::uuid)", [revoked.approvalId]); }
    finally { await approver.end(); }
    expect((await executeP06(lab.operator, completed, new ExperimentalD1Budget())).status).toBe("APPLIED");
    await lab.dbAdmin.query("UPDATE public.platform_schema_trusted_actors SET active=false WHERE login_name=$1",[lab.author]);
    const prior = (await lab.dbAdmin.query<{principal_id:string}>(
      "SELECT principal_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.approver])).rows[0]!;
    await lab.dbAdmin.query("DELETE FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.approver]);
    await lab.dbAdmin.query("INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind) VALUES($1,$2,'APPROVER')",
      [lab.approver,prior.principal_id]);
    // The harness is the disposable recovery orchestrator. Fence all sessions
    // first, advance the external epoch, and retain the original DB until the
    // same-name restore is checked. It is never a production recovery command.
    await Promise.all([lab.operator.end(),lab.runtime.end(),lab.dbAdmin.end()]);
    const retained = lab.name+"_retained";
    const escaped = (value:string) => cluster.escapeIdentifier(value);
    let retainedExists = false;
    let restored: Lab | undefined;
    try {
      await cluster.query("ALTER DATABASE "+escaped(lab.name)+" RENAME TO "+escaped(retained));
      retainedExists = true;
      const nextEpoch = randomUUID();
      labEpochs.set(key,nextEpoch);
      labRecoveryPending.add(key);
      await cluster.query("CREATE DATABASE "+escaped(lab.name));
      await cluster.query("REVOKE CONNECT ON DATABASE "+escaped(lab.name)+" FROM PUBLIC");
      for (const role of [lab.author,lab.approver,lab.operatorRole,lab.runtimeRole])
        await cluster.query("GRANT CONNECT ON DATABASE "+escaped(lab.name)+" TO "+escaped(role));
      const restore = spawnSync("docker", ["compose","-f","compose.dev.yml","exec","-T","postgres",
        "pg_restore","-U","vibress","--exit-on-error","--single-transaction","--dbname",lab.name],
        { input: archive.stdout, timeout: 20000, maxBuffer: 16*1024*1024 });
      expect(restore.status).toBe(0);
      restored = {...lab,dbAdmin:await connect(lab.name),operator:await connect(lab.name,lab.operatorRole),
        runtime:await connect(lab.name,lab.runtimeRole)};
      labs[labs.indexOf(lab)] = restored;
      expect((await restored.dbAdmin.query("SELECT epoch_id FROM public.s03_p06_recovery_epochs")).rows)
        .toEqual([{epoch_id:oldEpoch}]);
      expect(await hasWebsite(restored)).toBe(false);
      expect(await contentChecksum(restored)).toBe(checksum);
      expect((await restored.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
      // Test epoch mismatch independently even if an authority actively
      // attests the new epoch. The actual lab authority stays pending.
      const activeNewEpoch = new RecoveryEpochAuthority(epochKeys.publicKey, async challenge => proofFor(challenge,nextEpoch));
      for (const request of [stale,revoked,completed]) {
        await expect(executeP06Raw(restored.operator,request,new ExperimentalD1Budget(),activeNewEpoch))
          .rejects.toMatchObject({code:"UNAUTHORIZED",message:"recovery epoch mismatch; re-enrollment required"});
        await expect(executeP06(restored.operator,request,new ExperimentalD1Budget()))
          .rejects.toMatchObject({code:"UNAUTHORIZED",message:"fresh recovery authority proof unavailable"});
      }
      await expect(reconcileP06(restored.operator,completed,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
      await expect(executeP06Raw(restored.operator,stale,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
      const unavailable = new RecoveryEpochAuthority(epochKeys.publicKey, async () => {throw Error("unavailable");});
      const replay = new RecoveryEpochAuthority(epochKeys.publicKey, async challenge =>
        proofFor({...challenge,nonce:randomUUID()},oldEpoch));
      const forged = new RecoveryEpochAuthority(epochKeys.publicKey, async challenge =>
        ({...proofFor(challenge,nextEpoch),signature:"A".repeat(86)}));
      for (const invalid of [unavailable,replay,forged])
        await expect(executeP06Raw(restored.operator,stale,new ExperimentalD1Budget(),invalid))
          .rejects.toMatchObject({code:"UNAUTHORIZED"});
      // Explicit disposable recovery enrollment, under I -> registry fence.
      // No automatic approval or historical journal reconstruction.
      await restored.dbAdmin.query("BEGIN");
      try {
        await restored.dbAdmin.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03'),hashtext($1))",[lab.installationId]);
        await restored.dbAdmin.query("SELECT 1 FROM public.platform_schema_registry WHERE installation_id=$1 FOR UPDATE",[lab.installationId]);
        await restored.dbAdmin.query("UPDATE public.s03_p06_recovery_epochs SET epoch_id=$1::uuid",[nextEpoch]);
        await restored.dbAdmin.query("COMMIT");
      } catch (error) {await restored.dbAdmin.query("ROLLBACK");throw error;}
      const actor = await connect(lab.name,lab.author);
      try {
        await expect(actor.query("SELECT public.s03_p06_submit($1,$2)",[lab.installationId,lab.plan.digest]))
          .rejects.toMatchObject({code:"42501"});
      } finally {await actor.end();}
      // Simulate separately authenticated root re-enrollment. Prior UUIDs stay
      // in the restored history. This does not certify external journal recovery.
      for (const [login,kind] of [[lab.author,"AUTHOR"],[lab.approver,"APPROVER"]]) {
        const row=(await restored.dbAdmin.query<{principal_id:string}>(
          "SELECT principal_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",[login])).rows[0]!;
        await restored.dbAdmin.query("DELETE FROM public.platform_schema_trusted_actors WHERE login_name=$1",[login]);
        await restored.dbAdmin.query("INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind) VALUES($1,$2,$3)",
          [login,row.principal_id,kind]);
      }
      await expect(executeP06Raw(restored.operator,stale,new ExperimentalD1Budget(),activeNewEpoch))
        .rejects.toMatchObject({code:"UNAUTHORIZED",message:"independent P06 authorization unavailable"});
      const fresh = await freshP06(restored);
      expect(fresh.planDigest).toBe(stale.planDigest);
      expect(fresh.operationId).not.toBe(stale.operationId);
      expect(fresh.approvalId).not.toBe(stale.approvalId);
      // Fresh enrollment and approval are insufficient while the authority
      // marks the rewound completed operation as requiring recovery review.
      await expect(executeP06(restored.operator,fresh,new ExperimentalD1Budget()))
        .rejects.toMatchObject({code:"UNAUTHORIZED",message:"fresh recovery authority proof unavailable"});
      expect(await hasWebsite(restored)).toBe(false);
      expect((await restored.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    } finally {
      if (retainedExists) await cluster.query("DROP DATABASE "+escaped(retained));
      labEpochs.delete(key);
      labRecoveryPending.delete(key);
    }
  }, 90000);
});

describe("P06 root lifecycle and LOGIN identity boundaries", () => {
  it("P06-E2E-19: root lifecycle pre-locks actor; mixed root calls roll back; replacement invalidates stale authority", async () => {
    const lab=await createLab("bg");labs.push(lab);await p06Install(lab);
    const stale=await freshP06(lab),checksum=await contentChecksum(lab);
    const before=(await lab.dbAdmin.query<{actor_instance_id:string;principal_id:string}>(
      "SELECT actor_instance_id,principal_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.author])).rows[0]!;
    await expect(lab.runtime.query("SELECT public.s03_p06_root_retire($1,$2)",[lab.installationId,lab.author])).rejects.toMatchObject({code:"42501"});
    await lab.dbAdmin.query("BEGIN");
    try {
      await lab.dbAdmin.query("SELECT public.s03_p06_root_retire($1,$2)",[lab.installationId,lab.author]);
      await expect(lab.dbAdmin.query("SELECT public.s03_p06_root_register($1,$2,$3,'AUTHOR')",
        [lab.installationId,lab.author,before.principal_id])).rejects.toMatchObject({code:"42501"});
    } finally {await lab.dbAdmin.query("ROLLBACK");}
    expect((await lab.dbAdmin.query("SELECT actor_instance_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.author])).rows)
      .toEqual([{actor_instance_id:before.actor_instance_id}]);
    const blocker=await connect(lab.name),writer=await connect(lab.name);
    let pending:Promise<unknown>|undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_actor'),hashtext($1))",[lab.author]);
      pending=writer.query("SELECT public.s03_p06_root_replace($1,$2,$3,'AUTHOR')",
        [lab.installationId,lab.author,before.principal_id]);
      void pending.catch(()=>undefined);
      let waiting=false;
      for(let i=0;i<100;i++){
        const row=(await lab.dbAdmin.query<{waiting:boolean}>("SELECT $1::int=ANY(pg_blocking_pids($2)) AS waiting",
          [blocker.processID,writer.processID])).rows[0];
        if(row?.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      // Root writer is waiting on advisory X, not holding the actor tuple.
      await blocker.query("SELECT 1 FROM public.platform_schema_trusted_actors WHERE login_name=$1 FOR UPDATE NOWAIT",[lab.author]);
      await blocker.query("COMMIT");
      await pending;
    } finally {await blocker.query("ROLLBACK").catch(()=>undefined);await pending?.catch(()=>undefined);await blocker.end();await writer.end();}
    expect((await lab.dbAdmin.query("SELECT actor_instance_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.author])).rows[0]?.actor_instance_id)
      .not.toBe(before.actor_instance_id);
    await expect(executeP06(lab.operator,stale,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect((await executeP06(lab.operator,await freshP06(lab),new ExperimentalD1Budget())).status).toBe("APPLIED");
  },30000);

  it("P06-E2E-20: LOGIN name reuse with different PostgreSQL role OID cannot revive approved authority", async () => {
    const lab=await createLab("bh");labs.push(lab);await p06Install(lab);
    const stale=await freshP06(lab),checksum=await contentChecksum(lab);
    const previous=lab.author+"_old",esc=(v:string)=>cluster.escapeIdentifier(v);
    await cluster.query("ALTER ROLE "+esc(lab.author)+" RENAME TO "+esc(previous));
    let replacement=false;
    try {
      await cluster.query("CREATE ROLE "+esc(lab.author)+" LOGIN PASSWORD "+cluster.escapeLiteral(password)+
        " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      replacement=true;
      await lab.dbAdmin.query("GRANT CONNECT ON DATABASE "+esc(lab.name)+" TO "+esc(lab.author));
      await lab.dbAdmin.query("GRANT USAGE ON SCHEMA public TO "+esc(lab.author));
      await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_submit(text,text) TO "+esc(lab.author));
      const impostor=await connect(lab.name,lab.author);
      try {await expect(impostor.query("SELECT public.s03_p06_submit($1,$2)",[lab.installationId,lab.plan.digest]))
        .rejects.toMatchObject({code:"42501"});} finally {await impostor.end();}
      await expect(executeP06(lab.operator,stale,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
      expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(checksum);
      expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    } finally {
      if(replacement){await lab.dbAdmin.query("DROP OWNED BY "+esc(lab.author));await cluster.query("DROP ROLE "+esc(lab.author));}
      await cluster.query("ALTER ROLE "+esc(previous)+" RENAME TO "+esc(lab.author));
    }
    // Trusted cluster administration must reenroll after identity transitions;
    // an OID check alone cannot detect a role rename that was later reversed.
    const principal=(await lab.dbAdmin.query<{principal_id:string}>("SELECT principal_id FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.author])).rows[0]!;
    await lab.dbAdmin.query("SELECT public.s03_p06_root_replace($1,$2,$3,'AUTHOR')",[lab.installationId,lab.author,principal.principal_id]);
    await expect(executeP06(lab.operator,stale,new ExperimentalD1Budget())).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect((await executeP06(lab.operator,await freshP06(lab),new ExperimentalD1Budget())).status).toBe("APPLIED");
  },30000);
});

describe("P06 owned physical session supervisor and capability ordering", () => {
  it("P06-E2E-21: committed capability removal fences a waiting delegated transition before DML", async () => {
    const lab=await createLab("bi");labs.push(lab);await p06Install(lab);
    const request=await freshP06(lab),checksum=await contentChecksum(lab);
    const delegate="s03_delegate_"+lab.key+"_"+id,gateway="s03_gateway_"+lab.key+"_"+id;
    const esc=(v:string)=>cluster.escapeIdentifier(v);
    await cluster.query("CREATE ROLE "+esc(delegate)+" LOGIN PASSWORD "+cluster.escapeLiteral(password)+
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await cluster.query("CREATE ROLE "+esc(gateway)+" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    await cluster.query("GRANT CONNECT ON DATABASE "+esc(lab.name)+" TO "+esc(delegate));
    await lab.dbAdmin.query("GRANT USAGE ON SCHEMA public TO "+esc(delegate)+","+esc(gateway));
    await lab.dbAdmin.query("GRANT SELECT ON public.platform_schema_registry,public.s03_p06_admin_capability,public.platform_schema_trusted_actors TO "+esc(gateway));
    await lab.dbAdmin.query("GRANT UPDATE(active) ON public.platform_schema_trusted_actors TO "+esc(gateway));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_enter() TO "+esc(gateway));
    await lab.dbAdmin.query("ALTER FUNCTION public.s03_p06_set_actor_active(text,text,boolean) OWNER TO "+esc(gateway));
    await lab.dbAdmin.query("GRANT EXECUTE ON FUNCTION public.s03_p06_set_actor_active(text,text,boolean) TO "+esc(delegate));
    await lab.dbAdmin.query("SELECT public.s03_p06_root_set_capability($1,$2,true)",[lab.installationId,delegate]);
    const admin=await connect(lab.name,delegate);
    let pending:Promise<unknown>|undefined;
    try {
      await expect(admin.query("SELECT public.s03_p06_root_set_capability($1,$2,true)",[lab.installationId,delegate])).rejects.toMatchObject({code:"42501"});
      await lab.dbAdmin.query("BEGIN");
      await lab.dbAdmin.query("SELECT public.s03_p06_root_set_capability($1,$2,false)",[lab.installationId,delegate]);
      pending=admin.query("SELECT public.s03_p06_set_actor_active($1,$2,false)",[lab.installationId,lab.author]);
      void pending.catch(()=>undefined);
      const observer=await connect(lab.name);
      try {
        let waiting=false;
        for(let i=0;i<100;i++){
          const row=(await observer.query<{waiting:boolean}>("SELECT $1::int=ANY(pg_blocking_pids($2)) AS waiting",[lab.dbAdmin.processID,admin.processID])).rows[0];
          if(row?.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
        }
        expect(waiting).toBe(true);
        // The delegated writer is still upstream of the actor tuple.
        await observer.query("BEGIN");
        await observer.query("SELECT 1 FROM public.platform_schema_trusted_actors WHERE login_name=$1 FOR UPDATE NOWAIT",[lab.author]);
        await observer.query("ROLLBACK");
      }finally{await observer.end();}
      await lab.dbAdmin.query("COMMIT");
      await expect(pending).rejects.toMatchObject({code:"42501"});
    }finally{await lab.dbAdmin.query("ROLLBACK").catch(()=>undefined);await pending?.catch(()=>undefined);await admin.end();}
    expect((await lab.dbAdmin.query("SELECT active,actor_generation FROM public.platform_schema_trusted_actors WHERE login_name=$1",[lab.author])).rows)
      .toEqual([{active:true,actor_generation:"1"}]);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_admin_capability")).rowCount).toBe(0);
    expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect((await executeP06(lab.operator,request,new ExperimentalD1Budget())).status).toBe("APPLIED");
  },30000);

  it("P06-E2E-22: real stalled BEGIN acknowledgment hits D1, burns owned connection and leaves no committed effect", async () => {
    const lab=await createLab("bj");labs.push(lab);await p06Install(lab);
    const request=await freshP06(lab),checksum=await contentChecksum(lab);
    const proxy=await startTransactionAckFaultProxy("BEGIN","STALL");
    void proxy.serverCommitObserved.catch(()=>undefined);
    const connection=new URL(urlFor(lab.name,lab.operatorRole));
    connection.port=String(proxy.port);
    const budget=new ExperimentalD1Budget();
    try {
      await expect(superviseDisposableSchemaOperation(connection.toString(),request,labRecoveryAuthority,"EXECUTE",budget))
        .rejects.toMatchObject({code:"INDETERMINATE"});
      await proxy.serverCommitObserved;
      expect(budget.expired()).toBe(true);
      let sessions=0;
      for(let i=0;i<100;i++){
        sessions=Number((await lab.dbAdmin.query<{n:string}>(
          "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2",[lab.name,lab.operatorRole])).rows[0]!.n);
        if(sessions===1)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(sessions).toBe(1); // only original unused lab.operator remains
      expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(checksum);
      expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
      await expect(reconcileP06(lab.operator,request,new ExperimentalD1Budget())).rejects.toMatchObject({code:"INDETERMINATE"});
    }finally{await proxy.close();}
  },30000);
});

describe("P06 administrative metadata, cancellation diagnostic and D1 measurement", () => {
  it("P06-E2E-23: accidental metadata DML/TRUNCATE grants cannot forge capability, epoch, enrollment or journal", async () => {
    const lab=await createLab("bk");labs.push(lab);await p06Install(lab);
    const request=await freshP06(lab),checksum=await contentChecksum(lab);
    const rootTables=["s03_p06_admin_capability","s03_p06_actor_enrollments","s03_p06_recovery_epochs",
      "s03_p06_call_guard","s03_e2_actor_instance_history","s03_p06_lifecycle_audit"];
    const immutableTables=["s03_p06_submissions","s03_p06_approvals","s03_p06_revocations","s03_p06_completed_operations"];
    const author=await connect(lab.name,lab.author);
    try {
      for(const table of [...rootTables,...immutableTables]){
        const qualified="public."+lab.dbAdmin.escapeIdentifier(table);
        await lab.dbAdmin.query("GRANT INSERT,UPDATE,DELETE,TRUNCATE ON "+qualified+" TO "+lab.dbAdmin.escapeIdentifier(lab.author));
        if(rootTables.includes(table)) await expect(author.query("INSERT INTO "+qualified+" DEFAULT VALUES")).rejects.toMatchObject({code:"42501"});
        await expect(author.query("DELETE FROM "+qualified)).rejects.toMatchObject({code:"42501"});
        // FK prechecks may reject TRUNCATE before its BEFORE STATEMENT trigger.
        await expect(author.query("TRUNCATE "+qualified)).rejects.toMatchObject({code:expect.stringMatching(/^(42501|0A000)$/)});
      }
    }finally{await author.end();}
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_admin_capability")).rowCount).toBe(0);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_actor_enrollments")).rowCount).toBe(2);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_recovery_epochs")).rowCount).toBe(1);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_submissions")).rowCount).toBe(1);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_approvals")).rowCount).toBe(1);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
    expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(checksum);
    expect((await executeP06(lab.operator,request,new ExperimentalD1Budget())).status).toBe("APPLIED");
  },30000);

  it("P06-E2E-24: delayed same-role cancellation can strike a subsequent query on reused backend, not a separate session", async () => {
    const lab=await createLab("bl");labs.push(lab);await p06Install(lab);
    const checksum=await contentChecksum(lab);
    const reused=await connect(lab.name,lab.operatorRole),signaler=await connect(lab.name,lab.operatorRole),fresh=await connect(lab.name,lab.operatorRole);
    let second:Promise<unknown>|undefined;
    try {
      await reused.query("SELECT 1");
      second=reused.query("SELECT pg_sleep(5) /* s03_next_statement */");
      void second.catch(()=>undefined);
      let running=false;
      for(let i=0;i<100;i++){
        const row=(await lab.dbAdmin.query<{running:boolean}>("SELECT state='active' AND query LIKE '%s03_next_statement%' AS running FROM pg_stat_activity WHERE pid=$1",[reused.processID])).rows[0];
        if(row?.running){running=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(running).toBe(true);
      // Diagnostic only: ordinary same-role permission, NOT a privileged
      // cancellation gateway or wire CancelRequest implementation.
      expect((await signaler.query<{sent:boolean}>("SELECT pg_cancel_backend($1) AS sent",[reused.processID])).rows[0]?.sent).toBe(true);
      await expect(second).rejects.toMatchObject({code:"57014"});
      expect((await fresh.query("SELECT 1 AS ok")).rows).toEqual([{ok:1}]);
    }finally{await second?.catch(()=>undefined);await Promise.all([reused.end(),signaler.end(),fresh.end()]);}
    expect(await hasWebsite(lab)).toBe(false);expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
  },30000);

  it("P06-E2E-25: measure five isolated integrated one-shot operations from before connect through outcome", async () => {
    const samples:number[]=[];
    for(const key of ["bm","bn","bo","bp","bq"] as const){
      const lab=await createLab(key);labs.push(lab);await p06Install(lab);
      const request=await freshP06(lab),checksum=await contentChecksum(lab);
      const budget=new ExperimentalD1Budget();
      const result=await superviseDisposableSchemaOperation(urlFor(lab.name,lab.operatorRole),request,labRecoveryAuthority,"EXECUTE",budget);
      const elapsed=2517-budget.remainingMs();
      samples.push(Math.round(elapsed*1000)/1000);
      expect(result.status).toBe("APPLIED");expect(elapsed).toBeLessThan(2517);
      expect(await hasWebsite(lab)).toBe(true);expect(await contentChecksum(lab)).toBe(checksum);
      expect((await lab.dbAdmin.query("SELECT operation_id FROM public.s03_p06_completed_operations")).rows).toEqual([{operation_id:request.operationId}]);
    }
    // Exploratory only: two fixture rows, ephemeral in-process signing provider,
    // one runner; no inferential percentile, no approved admission margin.
    console.info("D1_INTEGRATED_EXPLORATORY "+JSON.stringify({samplesMs:samples,n:samples.length,rows:2,margin:"NOT_DETERMINABLE"}));
  },60000);
});

describe("P06 supervised terminal session regression", () => {
  it("P06-E2E-26: transport failure during external proof fences the suspended operation", async () => {
    const lab = await createLab("br"); labs.push(lab); await p06Install(lab);
    const request = await freshP06(lab), checksum = await contentChecksum(lab);
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const providerEntered = new Promise<void>(resolve => { entered = resolve; });
    const providerRelease = new Promise<void>(resolve => { release = resolve; });
    const authority = new RecoveryEpochAuthority(epochKeys.publicKey, async challenge => {
      entered();
      await providerRelease;
      return proofFor(challenge, labEpochs.get(challenge.installationId + ":" + challenge.databaseName)!);
    });
    const operation = superviseDisposableSchemaOperation(urlFor(lab.name, lab.operatorRole), request, authority);
    void operation.catch(() => undefined);
    try {
      await Promise.race([providerEntered, operation.then(() => { throw Error("unexpected completion"); })]);
      const killed = await lab.dbAdmin.query<{ killed: boolean }>(
        "SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND pid<>$3",
        [lab.name, lab.operatorRole, lab.operator.processID]);
      expect(killed.rows).toEqual([{ killed: true }]);
      await expect(operation).rejects.toMatchObject({ code: "INDETERMINATE",
        message: "supervisor transport failed; reconcile on fresh connection" });
    } finally {
      release();
      await operation.catch(() => undefined);
    }
    await expect(reconcileP06(lab.operator, request, new ExperimentalD1Budget()))
      .rejects.toMatchObject({ code: "INDETERMINATE" });
    expect(await hasWebsite(lab)).toBe(false);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
  }, 30000);

  it("P06-E2E-27: supervised lost COMMIT acknowledgment remains indeterminate and reconciles exactly once", async () => {
    const lab = await createLab("bs"); labs.push(lab); await p06Install(lab);
    const request = await freshP06(lab), checksum = await contentChecksum(lab);
    const proxy = await startCommitAckDropProxy();
    void proxy.serverCommitObserved.catch(() => undefined);
    const connection = new URL(urlFor(lab.name, lab.operatorRole));
    connection.port = String(proxy.port);
    try {
      await expect(superviseDisposableSchemaOperation(connection.toString(), request, labRecoveryAuthority))
        .rejects.toMatchObject({ code: "INDETERMINATE" });
      await proxy.serverCommitObserved;
    } finally {
      await proxy.close();
    }
    expect(await hasWebsite(lab)).toBe(true);
    expect(await contentChecksum(lab)).toBe(checksum);
    expect((await lab.dbAdmin.query("SELECT operation_id FROM public.s03_p06_completed_operations")).rows)
      .toEqual([{ operation_id: request.operationId }]);
    expect((await superviseDisposableSchemaOperation(urlFor(lab.name, lab.operatorRole), request,
      labRecoveryAuthority, "RECONCILE")).status).toBe("ALREADY_APPLIED");
  }, 30000);
});

it("P06-E2E-28: actual operator refuses all dispatch after fence while proof is suspended", async () => {
  const lab = await createLab("bt"); labs.push(lab); await p06Install(lab);
  const request = await freshP06(lab), checksum = await contentChecksum(lab);
  const client = await connect(lab.name, lab.operatorRole);
  // Freeze this test clock to isolate the terminal-state mechanism from D1.
  // Real elapsed-time/transport behavior is covered separately by E2E-22/26/27.
  const budget = new ExperimentalD1Budget(() => 0);
  const session = new ExperimentalSessionLifecycle(budget);
  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const providerEntered = new Promise<void>(resolve => { entered = resolve; });
  const providerRelease = new Promise<void>(resolve => { release = resolve; });
  const authority = new RecoveryEpochAuthority(epochKeys.publicKey, async challenge => {
    entered();
    await providerRelease;
    return proofFor(challenge, labEpochs.get(challenge.installationId + ":" + challenge.databaseName)!);
  });
  // Observe calls at the driver boundary, including timeout refresh, DDL,
  // COMMIT and ROLLBACK. Socket termination alone would not prove this.
  let dispatches = 0;
  const wrapped = {
    getTransactionStatus: () => (client as Client & {getTransactionStatus(): string | null}).getTransactionStatus(),
    escapeIdentifier: client.escapeIdentifier.bind(client),
    query: (sql: string, params?: unknown[]) => {
      dispatches++;
      return params ? client.query(sql, params) : client.query(sql);
    },
  } as unknown as ClientBase;
  const operation = executeP06Raw(wrapped, request, budget, authority, session);
  void operation.catch(() => undefined);
  try {
    await Promise.race([providerEntered, operation.then(() => { throw Error("unexpected completion"); })]);
    const beforeFence = dispatches;
    expect(beforeFence).toBeGreaterThan(0);
    expect(session.fence("TRANSPORT_FAILED")).toBe(true);
    session.retire();
    release();
    await expect(operation).rejects.toMatchObject({code: "INDETERMINATE"});
    expect(dispatches).toBe(beforeFence);
    expect(session.snapshot()).toMatchObject({beginDispatched: true, commitDispatched: false,
      terminalCause: "TRANSPORT_FAILED", cleanupPermitted: false});
  } finally {
    release();
    await operation.catch(() => undefined);
    await client.end();
  }
  await expect(reconcileP06(lab.operator, request, new ExperimentalD1Budget()))
    .rejects.toMatchObject({code: "INDETERMINATE"});
  expect(await hasWebsite(lab)).toBe(false);
  expect(await contentChecksum(lab)).toBe(checksum);
  expect((await lab.dbAdmin.query("SELECT 1 FROM public.s03_p06_completed_operations")).rowCount).toBe(0);
}, 30000);
