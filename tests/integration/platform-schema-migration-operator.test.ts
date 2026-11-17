// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  createSchemaManifest,
  planSchemaChanges,
} from "../../packages/schema-engine/src";
import { executeApprovedAdditiveColumn } from "../../packages/database/src/platform-schema-migration-operator";

/** Controlled PG16 fixture: real DDL only in two fresh localhost-only databases. */
const BASE_URL = process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";
const id = randomBytes(4).toString("hex");
const applicationId = asApplicationId("s03-crm");
const password = "disposable_" + id;

type Key = "a" | "b" | "c" | "d";
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
  labs.push(await createLab("a"));
  labs.push(await createLab("b"));
  labs.push(await createLab("c")); // Dedicated concurrent execution and replay fixture.
  labs.push(await createLab("d")); // Dedicated journal failure/recovery fixture.
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
