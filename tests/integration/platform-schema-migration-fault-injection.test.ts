// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { reconcileReadOnly, type RecoveryExpected } from "../../scripts/platform/m03-s03-fault/read-only-reconcile";
import { startCommitAckDropProxy } from "../../scripts/platform/m03-s03-fault/pg-wire-proxy";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  createSchemaManifest,
  planSchemaChanges,
} from "../../packages/schema-engine/src";
import { executeApprovedAdditiveColumn } from "../../packages/database/src/platform-schema-migration-operator";

/** Agent 04 disposable PG16 fault harness — no production database, no production injection. */
const BASE_URL = process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const id = randomBytes(4).toString("hex");
const applicationId = asApplicationId("s03-crm");
const password = "disposable_" + id;

type Key = "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y";
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

async function createLab(key: Key): Promise<Lab> {
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
    "platform_schema_migration_journal TO " + dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT UPDATE(manifest,manifest_digest,updated_at) " +
    "ON platform_schema_registry TO " + dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT INSERT ON platform_schema_migration_journal TO " +
    dbAdmin.escapeIdentifier(operatorRole));
  await dbAdmin.query("GRANT INSERT ON platform_schema_plans TO " +
    dbAdmin.escapeIdentifier(author));
  await dbAdmin.query("GRANT INSERT ON platform_schema_approvals TO " +
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
      "INSERT INTO platform_schema_plans " +
      "(installation_id,plan_digest,expected_manifest,plan,author) VALUES ($1,$2,$3,$4,$5)",
      [installationId, plan.digest, JSON.stringify(current), JSON.stringify(plan), author],
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
      "INSERT INTO platform_schema_approvals " +
      "(installation_id,plan_digest,operation_id,approver,operator_role,environment,expires_at) " +
      "VALUES($1,$2,$3,$4,$5,'test',clock_timestamp()+interval '20 minutes')",
      [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id,
        lab.approver, lab.operatorRole],
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
}, 120000);

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
      for (const role of [lab.runtimeRole, lab.operatorRole, lab.approver, lab.author]) {
        await cluster.query("DROP ROLE IF EXISTS " + cluster.escapeIdentifier(role))
          .catch(() => undefined);
      }
    }
    // A teardown that silently leaves credentials or test databases is FAIL.
    // Compare only the exact random names created by this test process.
    const allRoles = labs.flatMap(l => [l.author, l.approver, l.operatorRole, l.runtimeRole]);
    const remainingDb = await cluster.query<{ name: string }>(
      "SELECT datname AS name FROM pg_database WHERE datname = ANY($1::text[])",
      [labs.map(l => l.name)]);
    const remainingRoles = await cluster.query<{ name: string }>(
      "SELECT rolname AS name FROM pg_roles WHERE rolname = ANY($1::text[])",
      [allRoles]);
    await cluster.end();
    if (remainingDb.rows.length > 0 || remainingRoles.rows.length > 0) {
      throw Error("DISPOSABLE_FIXTURE_CLEANUP_INCOMPLETE");
    }
  }
});


type FaultMoment = "before" | "after";

/** Only the test adapter intercepts SQL; production operator has NO fault hook. */
function intercepted(
  real: Client, sqlNeedle: RegExp, moment: FaultMoment,
  action: () => Promise<void>,
): Client {
  let injected = false;
  return new Proxy(real, {
    get(target, property) {
      if (property !== "query") {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (statement: string, params?: unknown[]) => {
        const text = typeof statement === "string" ? statement : "";
        if (!injected && moment === "before" && sqlNeedle.test(text)) {
          injected = true;
          await action();
        }
        const result = params === undefined
          ? await target.query(text)
          : await target.query(text, params);
        if (!injected && moment === "after" && sqlNeedle.test(text)) {
          injected = true;
          await action();
        }
        return result;
      };
    },
  }) as Client;
}

async function isolated(key: Key): Promise<Lab> {
  const lab = await createLab(key);
  labs.push(lab);
  await approve(lab);
  return lab;
}
const request = (lab: Lab) => ({
  installationId: lab.installationId, planDigest: lab.plan.digest,
});
async function state(lab: Lab) {
  const registry = (await lab.dbAdmin.query<{ manifest_digest: string }>(
    "SELECT manifest_digest FROM platform_schema_registry")).rows[0]?.manifest_digest;
  const journal = (await lab.dbAdmin.query<{ plan_digest: string; status: string; new_digest: string }>(
    "SELECT plan_digest,status,new_digest FROM platform_schema_migration_journal")).rows;
  const column = await hasWebsite(lab);
  const checksum = await contentChecksum(lab);
  return { registry, journal, column, checksum };
}
async function assertUncommitted(lab: Lab, initial: string): Promise<void> {
  const value = await state(lab);
  expect(value).toEqual({ registry: lab.current.digest, journal: [],
    column: false, checksum: initial });
}
async function assertCommitted(lab: Lab, initial: string): Promise<void> {
  const value = await state(lab);
  expect(value.registry).toBe(lab.plan.proposedManifest.digest);
  expect(value.journal).toEqual([{
    plan_digest: lab.plan.digest, status: "COMPLETED",
    new_digest: lab.plan.proposedManifest.digest,
  }]);
  expect(value.column).toBe(true);
  expect(value.checksum).toBe(initial);
}
async function withOperator(
  lab: Lab, pattern: RegExp, moment: FaultMoment, action: () => Promise<void>,
) {
  const session = await connect(lab.name, lab.operatorRole);
  const proxy = intercepted(session, pattern, moment, action);
  try {
    return await executeApprovedAdditiveColumn(proxy, request(lab));
  } finally {
    // A failed connection is discarded, not returned to any pool.
    await session.end().catch(() => undefined);
  }
}
function dropClientSocket(db: Client): void {
  const stream = (db as unknown as {
    connection?: { stream?: { destroy(): void } }
  }).connection?.stream;
  if (!stream) throw new Error("TEST_SOCKET_UNAVAILABLE");
  stream.destroy();
}

describe("M03-S03 Agent 04 deterministic disposable PostgreSQL failures", () => {
  it("before authorization: clean transaction abort and unchanged journal/catalog", async () => {
    const lab = await isolated("e"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab, /FROM public\.platform_schema_approvals/, "before",
      async () => { throw Error("TEST_BEFORE_AUTH"); })).rejects.toThrow();
    await assertUncommitted(lab, checksum);
  });
  it("after authorization: no DDL or registry writes", async () => {
    const lab = await isolated("f"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab, /FROM public\.platform_schema_approvals/, "after",
      async () => { throw Error("TEST_AFTER_AUTH"); })).rejects.toThrow();
    await assertUncommitted(lab, checksum);
  });
  it("after migration advisory fence: automatic transaction rollback", async () => {
    const lab = await isolated("g"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab, /pg_advisory_xact_lock/, "after",
      async () => { throw Error("TEST_AFTER_FENCE"); })).rejects.toThrow();
    await assertUncommitted(lab, checksum);
  });
  it("before DDL: no journal or registry changes", async () => {
    const lab = await isolated("h"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab, /^ALTER TABLE/i, "before",
      async () => { throw Error("TEST_BEFORE_DDL"); })).rejects.toThrow();
    await assertUncommitted(lab, checksum);
  });
  it("after executed DDL but before journal: rolled back physical column", async () => {
    const lab = await isolated("i"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab, /^ALTER TABLE/i, "after",
      async () => { throw Error("TEST_AFTER_DDL"); })).rejects.toThrow();
    await assertUncommitted(lab, checksum);
    await expect(run(lab)).resolves.toMatchObject({ status: "APPLIED" });
    await assertCommitted(lab, checksum);
  });
  it("registry UPDATE privilege error: rollback and controlled retry", async () => {
    const lab = await isolated("j"), checksum = await contentChecksum(lab);
    await lab.dbAdmin.query("REVOKE UPDATE(manifest,manifest_digest,updated_at) ON platform_schema_registry FROM " +
      lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    await expect(run(lab)).rejects.toThrow();
    await assertUncommitted(lab, checksum);
    await lab.dbAdmin.query("GRANT UPDATE(manifest,manifest_digest,updated_at) " +
      "ON platform_schema_registry TO " + lab.dbAdmin.escapeIdentifier(lab.operatorRole));
    expect((await run(lab)).status).toBe("APPLIED");
    await assertCommitted(lab, checksum);
  });
  it("ROLLBACK transport failure: explicit INDETERMINATE, fresh-session old state", async () => {
    const lab = await isolated("k"), checksum = await contentChecksum(lab);
    const session = await connect(lab.name, lab.operatorRole);
    session.on("error", () => undefined);
    const proxy = new Proxy(session, {
      get(target, property) {
        if (property === "query") return async (sql: string, args?: unknown[]) => {
          if (sql === "ROLLBACK") { dropClientSocket(target); throw Error("TEST_ROLLBACK_LOSS"); }
          if (/^ALTER TABLE/i.test(sql)) throw Error("TEST_DDL_FAILURE");
          return args === undefined ? target.query(sql) : target.query(sql, args);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Client;
    try {
      await expect(executeApprovedAdditiveColumn(proxy, request(lab)))
        .rejects.toMatchObject({ code: "INDETERMINATE" });
    } finally {
      await session.end().catch(() => undefined);
    }
    await assertUncommitted(lab, checksum);
  });
  it("live backend termination after DDL: fresh connection confirms rollback", async () => {
    const lab = await isolated("l"), checksum = await contentChecksum(lab);
    const session = await connect(lab.name, lab.operatorRole);
    session.on("error", () => undefined);
    const pid = (await session.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const proxy = intercepted(session, /^ALTER TABLE/i, "after", async () => {
      const killed = await lab.dbAdmin.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend($1) AS terminated", [pid]);
      expect(killed.rows[0]?.terminated).toBe(true);
      throw Error("TEST_BACKEND_TERMINATED");
    });
    try {
      await expect(executeApprovedAdditiveColumn(proxy, request(lab))).rejects.toThrow();
    } finally { await session.end().catch(() => undefined); }
    await assertUncommitted(lab, checksum);
  });
  it("connection TCP break before COMMIT: INDETERMINATE then verified rollback", async () => {
    const lab = await isolated("m"), checksum = await contentChecksum(lab);
    const session = await connect(lab.name, lab.operatorRole);
    session.on("error", () => undefined);
    const proxy = intercepted(session, /^COMMIT$/, "before", async () => {
      dropClientSocket(session); throw Error("TEST_TCP_BREAK_BEFORE_COMMIT");
    });
    try {
      await expect(executeApprovedAdditiveColumn(proxy, request(lab)))
        .rejects.toMatchObject({ code: "INDETERMINATE" });
    } finally { await session.end().catch(() => undefined); }
    await assertUncommitted(lab, checksum);
    expect((await run(lab)).status).toBe("APPLIED");
    await assertCommitted(lab, checksum);
  });
  it("server COMMIT followed by actual socket loss before operator acknowledgment", async () => {
    const lab = await isolated("n"), checksum = await contentChecksum(lab);
    const session = await connect(lab.name, lab.operatorRole);
    const proxy = intercepted(session, /^COMMIT$/, "after", async () => {
      dropClientSocket(session); throw Error("TEST_ACK_LOST_AFTER_SERVER_COMMIT");
    });
    try {
      await expect(executeApprovedAdditiveColumn(proxy, request(lab)))
        .rejects.toMatchObject({ code: "INDETERMINATE" });
    } finally { await session.end().catch(() => undefined); }
    // Independent observer determines truth, not the disconnected caller.
    await assertCommitted(lab, checksum);
    expect((await run(lab)).status).toBe("ALREADY_APPLIED");
    await assertCommitted(lab, checksum);
  });
  it("noncooperating ALTER TABLE after advisory fence: no fabricated journal success", async () => {
    const lab = await isolated("o"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab, /pg_advisory_xact_lock/, "after", async () => {
      // A second independent session intentionally ignores the advisory lock.
      await lab.dbAdmin.query("ALTER TABLE public." +
        lab.dbAdmin.escapeIdentifier(lab.table) + " ADD COLUMN outsider text");
    })).rejects.toThrow();
    const s = await state(lab);
    expect(s.journal).toEqual([]);
    expect(s.registry).toBe(lab.current.digest);
    expect(s.checksum).toBe(checksum);
    expect(s.column).toBe(false);
  });
  it("transaction lock held by noncooperating DDL session: bounded failure, retry", async () => {
    const lab = await isolated("p"), checksum = await contentChecksum(lab);
    const external = await connect(lab.name);
    try {
      await external.query("BEGIN");
      await external.query("LOCK TABLE public." +
        external.escapeIdentifier(lab.table) + " IN ACCESS EXCLUSIVE MODE");
      await expect(run(lab)).rejects.toThrow();
    } finally {
      // Release the external ACCESS EXCLUSIVE lock before checksum inspection.
      // An observer SELECT would otherwise block, masking the operator result.
      await external.query("ROLLBACK").catch(() => undefined);
      await external.end().catch(() => undefined);
    }
    await assertUncommitted(lab, checksum);
    expect((await run(lab)).status).toBe("APPLIED");
    await assertCommitted(lab, checksum);
  }, 30000);
});

describe("M03-S03 Agent 04 process crash and competing plans", () => {
  it("actual OS SIGKILL during an open DDL transaction rolls back on disconnect", async () => {
    const lab = await isolated("q"), checksum = await contentChecksum(lab);
    const nodeArgs = ["--import", "tsx", "scripts/platform/m03-s03-fault/crash-operator.ts"];
    const child = spawn(process.execPath, nodeArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        M03_S03_DISPOSABLE_CONFIRM: "I_CONFIRM_DISPOSABLE",
        M03_S03_FAULT_DATABASE_URL: urlFor(lab.name, lab.operatorRole),
        M03_S03_FAULT_INSTALLATION: lab.installationId,
        M03_S03_FAULT_PLAN_DIGEST: lab.plan.digest,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let killed = false;
    try {
      const signal = await Promise.race([
        once(child, "message").then(args => args[0] as { phase?: string }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("FAULT_CHILD_BARRIER_TIMEOUT")), 10000)),
      ]);
      expect(signal.phase).toBe("AFTER_PHYSICAL_DDL");
      const exit = once(child, "exit");
      expect(child.kill("SIGKILL")).toBe(true);
      killed = true;
      const [code, name] = await exit;
      expect(code).toBeNull();
      expect(name).toBe("SIGKILL");
    } finally {
      if (!killed && !child.killed) child.kill("SIGKILL");
    }
    // New superuser connection examines the catalog, not the dead process's
    // uncommitted in-memory view.
    await assertUncommitted(lab, checksum);
    expect((await run(lab)).status).toBe("APPLIED");
    await assertCommitted(lab, checksum);
  }, 30000);

  it("two independently approved different plans cannot both commit", async () => {
    const lab = await isolated("r"), checksum = await contentChecksum(lab);
    const scope = { applicationId, installationId: lab.installationId };
    const alternative = compileResourceSchema([{
      ...scope, id: "catalog", ownership: "application" as const,
      fields: [
        { id: "name", type: "text" as const, required: true },
        { id: "telephone", type: "text" as const, required: false },
      ],
    }], scope);
    const otherPlan = planSchemaChanges(lab.current, alternative,
      { scope, expectedCurrentDigest: lab.current.digest });
    expect(otherPlan.digest).not.toBe(lab.plan.digest);
    const author = await connect(lab.name, lab.author);
    const approver = await connect(lab.name, lab.approver);
    try {
      await author.query("INSERT INTO platform_schema_plans " +
        "(installation_id,plan_digest,expected_manifest,plan,author) " +
        "VALUES ($1,$2,$3,$4,$5)", [
        lab.installationId, otherPlan.digest,
        JSON.stringify(lab.current), JSON.stringify(otherPlan), lab.author,
      ]);
      await approver.query("INSERT INTO platform_schema_approvals " +
        "(installation_id,plan_digest,operation_id,approver,operator_role,environment,expires_at) " +
        "VALUES($1,$2,$3,$4,$5,'test',clock_timestamp()+interval '20 minutes')", [
        lab.installationId, otherPlan.digest, otherPlan.operations[0]?.id,
        lab.approver, lab.operatorRole,
      ]);
    } finally {
      await author.end(); await approver.end();
    }
    const second = await connect(lab.name, lab.operatorRole);
    try {
      const outcomes = await Promise.allSettled([
        executeApprovedAdditiveColumn(lab.operator, request(lab)),
        executeApprovedAdditiveColumn(second, {
          installationId: lab.installationId, planDigest: otherPlan.digest,
        }),
      ]);
      const successes = outcomes.filter(x =>
        x.status === "fulfilled" && x.value.status === "APPLIED");
      expect(successes, "exactly one migration may commit").toHaveLength(1);
      const rows = (await lab.dbAdmin.query<{
        operation_id: string; plan_digest: string; status: string; new_digest: string;
      }>("SELECT operation_id,plan_digest,status,new_digest FROM platform_schema_migration_journal")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("COMPLETED");
      const resulting = (await lab.dbAdmin.query<{ manifest_digest: string }>(
        "SELECT manifest_digest FROM platform_schema_registry")).rows[0]!.manifest_digest;
      expect(resulting).toBe(rows[0]!.new_digest);
      expect([lab.plan.proposedManifest.digest, otherPlan.proposedManifest.digest])
        .toContain(resulting);
      const fields = await lab.dbAdmin.query<{ attname: string }>(
        "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid " +
        "WHERE c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped " +
        "AND a.attname IN ('website','telephone') ORDER BY a.attname",
        [lab.table]);
      expect(fields.rows).toHaveLength(1);
      expect(fields.rows[0]?.attname).toBe(
        resulting === lab.plan.proposedManifest.digest ? "website" : "telephone");
      expect(await contentChecksum(lab)).toBe(checksum);
    } finally { await second.end().catch(() => undefined); }
  }, 30000);

  it("journal INSERT succeeds but injected pre-COMMIT failure rolls back registry and DDL", async () => {
    const lab = await isolated("s"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab,
      /^INSERT INTO public\.platform_schema_migration_journal/, "after",
      async () => { throw Error("TEST_POST_JOURNAL_FAULT"); })).rejects.toThrow();
    await assertUncommitted(lab, checksum);
    expect((await run(lab)).status).toBe("APPLIED");
    await assertCommitted(lab, checksum);
  });

  it("conflicting committed journal cannot masquerade as successful retry", async () => {
    const lab = await isolated("t"), checksum = await contentChecksum(lab);
    expect((await run(lab)).status).toBe("APPLIED");
    await lab.dbAdmin.query("UPDATE platform_schema_migration_journal " +
      "SET new_digest=$1 WHERE installation_id=$2",
      ["a".repeat(64), lab.installationId]);
    try {
      await expect(run(lab)).rejects.toMatchObject({ code: "JOURNAL_CONFLICT" });
      expect(await contentChecksum(lab)).toBe(checksum);
    } finally {
      await lab.dbAdmin.query("UPDATE platform_schema_migration_journal " +
        "SET new_digest=$1 WHERE installation_id=$2",
        [lab.plan.proposedManifest.digest, lab.installationId]);
    }
    expect((await run(lab)).status).toBe("ALREADY_APPLIED");
    await assertCommitted(lab, checksum);
  });
});

function pinnedRecoveryEvidence(lab: Lab, seedChecksum: string): RecoveryExpected {
  const before = lab.current.resources.find(x => x.tableName === lab.table);
  const after = lab.plan.proposedManifest.resources.find(x => x.tableName === lab.table);
  if (!before || !after || !lab.plan.operations[0]) throw Error("MISSING_TRUSTED_MANIFEST");
  return {
    database: lab.name,
    installationId: lab.installationId,
    operationId: lab.plan.operations[0].id,
    planDigest: lab.plan.digest,
    operatorRole: lab.operatorRole,
    tableName: lab.table,
    columnName: "website",
    beforeDigest: lab.current.digest,
    afterDigest: lab.plan.proposedManifest.digest,
    beforeManifestText: JSON.stringify(lab.current),
    afterManifestText: JSON.stringify(lab.plan.proposedManifest),
    expectedSeedChecksum: seedChecksum,
    beforeColumns: before.fields.map(x => ({
      name: x.id, type: x.postgresType, required: x.required,
    })),
    afterColumns: after.fields.map(x => ({
      name: x.id, type: x.postgresType, required: x.required,
    })),
  };
}
async function independentReconcile(lab: Lab, checksum: string) {
  const inspector = await connect(lab.name);
  try {
    return await reconcileReadOnly(inspector, pinnedRecoveryEvidence(lab, checksum));
  } finally {
    await inspector.end().catch(() => undefined);
  }
}

describe("M03-S03 fresh-session recovery state machine", () => {
  it("old state requires reauthorization, committed state prohibits physical replay", async () => {
    const lab = await isolated("u");
    const checksum = await contentChecksum(lab);
    expect(await independentReconcile(lab, checksum)).toEqual({
      state: "ROLLED_BACK", retry: "REQUIRES_NEW_AUTHORIZATION_CHECK",
    });
    expect((await run(lab)).status).toBe("APPLIED");
    expect(await independentReconcile(lab, checksum)).toEqual({
      state: "COMMITTED", retry: "ALREADY_APPLIED_ONLY",
    });
    expect((await run(lab)).status).toBe("ALREADY_APPLIED");
  });
  it("contradictory digest/catalog/journal evidence halts replay", async () => {
    const lab = await isolated("v"), checksum = await contentChecksum(lab);
    const expected = pinnedRecoveryEvidence(lab, checksum);
    // A fabricated new-registry digest without its transactionally
    // committed journal/DDL is not a successful migration.
    await lab.dbAdmin.query("UPDATE platform_schema_registry SET " +
      "manifest_digest=$1,manifest=$2 WHERE installation_id=$3", [
        expected.afterDigest, expected.afterManifestText, lab.installationId,
      ]);
    try {
      expect(await independentReconcile(lab, checksum)).toEqual({
        state: "HALT_UNRECONCILABLE", retry: "DENIED",
      });
    } finally {
      await lab.dbAdmin.query("UPDATE platform_schema_registry SET " +
        "manifest_digest=$1,manifest=$2 WHERE installation_id=$3", [
          expected.beforeDigest, expected.beforeManifestText, lab.installationId,
        ]);
    }
    expect(await independentReconcile(lab, checksum)).toEqual({
      state: "ROLLED_BACK", retry: "REQUIRES_NEW_AUTHORIZATION_CHECK",
    });
  });
});

describe("M03-S03 Agent04 live DDL interruption and registry boundary", () => {
  it("kills PostgreSQL backend while actual ALTER TABLE is waiting for table lock", async () => {
    const lab = await isolated("w"), checksum = await contentChecksum(lab);
    const blocker = await connect(lab.name);
    const operator = await connect(lab.name, lab.operatorRole);
    operator.on("error", () => undefined);
    const pid = (await operator.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    let outcome: unknown;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE public." +
        blocker.escapeIdentifier(lab.table) + " IN ACCESS SHARE MODE");
      const operation = executeApprovedAdditiveColumn(operator, request(lab))
        .then(value => { outcome = value; })
        .catch(error => { outcome = error; });
      // The synchronization trigger is pg_stat_activity.wait_event_type='Lock';
      // the small poll interval is NOT used to infer when DDL began.
      let observedLockWait = false;
      const until = Date.now() + 1600;
      while (Date.now() < until) {
        const row = (await lab.dbAdmin.query<{ type: string | null }>(
          "SELECT wait_event_type AS type FROM pg_stat_activity WHERE pid=$1",
          [pid])).rows[0];
        if (row?.type === "Lock") { observedLockWait = true; break; }
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
      expect(observedLockWait, "actual DDL lock wait was never observed").toBe(true);
      const terminated = await lab.dbAdmin.query<{ done: boolean }>(
        "SELECT pg_terminate_backend($1) AS done", [pid]);
      expect(terminated.rows[0]?.done).toBe(true);
      await blocker.query("ROLLBACK");
      await operation;
      expect(outcome).toBeInstanceOf(Error);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end().catch(() => undefined);
      await operator.end().catch(() => undefined);
    }
    await assertUncommitted(lab, checksum);
  }, 25000);

  it("after registry compare-and-swap, before journal: rollback all effects", async () => {
    const lab = await isolated("x"), checksum = await contentChecksum(lab);
    await expect(withOperator(lab,
      /^UPDATE public\.platform_schema_registry SET manifest/, "after",
      async () => { throw Error("TEST_POST_REGISTRY_FAULT"); }))
      .rejects.toThrow();
    await assertUncommitted(lab, checksum);
    expect((await run(lab)).status).toBe("APPLIED");
    await assertCommitted(lab, checksum);
  });
});

describe("M03-S03 actual on-wire PostgreSQL COMMIT acknowledgment loss", () => {
  it("server commits but TCP proxy drops CommandComplete before client receives it", async () => {
    const lab = await isolated("y"), checksum = await contentChecksum(lab);
    const proxy = await startCommitAckDropProxy();
    const connection = new URL(urlFor(lab.name, lab.operatorRole));
    connection.port = String(proxy.port);
    const client = new Client({ connectionString: connection.toString(),
      connectionTimeoutMillis: 4000, query_timeout: 12000 });
    client.on("error", () => undefined);
    try {
      await client.connect();
      // No mock rejection. The PG wire proxy destroys a real TCP socket
      // after observing the server-side COMMIT CommandComplete packet.
      await expect(executeApprovedAdditiveColumn(client, request(lab)))
        .rejects.toMatchObject({ code: "INDETERMINATE" });
      await Promise.race([
        proxy.serverCommitObserved,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("PG_COMMIT_PACKET_NOT_OBSERVED")), 10000)),
      ]);
    } finally {
      await client.end().catch(() => undefined);
      await proxy.close();
    }
    // The fresh observer sees a complete journal/catalog/manifest despite
    // the caller's lost acknowledgment, and retry must NOT run ALTER again.
    await assertCommitted(lab, checksum);
    expect(await independentReconcile(lab, checksum)).toEqual({
      state: "COMMITTED", retry: "ALREADY_APPLIED_ONLY",
    });
    expect((await run(lab)).status).toBe("ALREADY_APPLIED");
  }, 30000);
});
