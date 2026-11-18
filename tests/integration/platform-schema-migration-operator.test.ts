// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, type ClientBase } from "pg";
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

type Key = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "aa" | "ab" | "ac" | "ad" | "ae" | "af";
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
  await dbAdmin.query(readFileSync(path.resolve(process.cwd(),
    "packages/database/migrations/0060_platform_schema_authenticated_approvals.sql"), "utf8"));
  // EXPERIMENT ONLY, installed in each owned disposable PG16 fixture AFTER
  // the unchanged 0060 migration. SECURITY INVOKER with no extra operator
  // grants: the actor roster writer and reader share per-login xact advisory
  // keys. This is NOT a deployable 0061 or approved production mechanism.
  await dbAdmin.query(
    "CREATE FUNCTION public.s03_test_actor_xact_fence() " +
    "RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER " +
    "SET search_path=pg_catalog,pg_temp AS $actor$ " +
    "DECLARE k text; BEGIN " +
    "IF TG_OP = 'INSERT' THEN " +
    "  PERFORM pg_catalog.pg_advisory_xact_lock(" +
    "    pg_catalog.hashtext('vibress_m03s03_actor'), " +
    "    pg_catalog.hashtext(NEW.login_name)); RETURN NEW; " +
    "ELSIF TG_OP = 'DELETE' THEN " +
    "  PERFORM pg_catalog.pg_advisory_xact_lock(" +
    "    pg_catalog.hashtext('vibress_m03s03_actor'), " +
    "    pg_catalog.hashtext(OLD.login_name)); RETURN OLD; " +
    "ELSE " +
    "  FOR k IN SELECT DISTINCT a.login FROM " +
    "    pg_catalog.unnest(ARRAY[OLD.login_name,NEW.login_name]) AS a(login) " +
    "    ORDER BY a.login LOOP " +
    "    PERFORM pg_catalog.pg_advisory_xact_lock(" +
    "      pg_catalog.hashtext('vibress_m03s03_actor'), pg_catalog.hashtext(k)); " +
    "  END LOOP; RETURN NEW; " +
    "END IF; END $actor$; " +
    "CREATE TRIGGER s03_test_actor_xact_fence " +
    "BEFORE INSERT OR UPDATE OR DELETE ON public.platform_schema_trusted_actors " +
    "FOR EACH ROW EXECUTE FUNCTION public.s03_test_actor_xact_fence(); " +
    "REVOKE ALL ON FUNCTION public.s03_test_actor_xact_fence() FROM PUBLIC"
  );
  // E2-A is ONLY a disposable test fixture, not a numbered migration and not
  // an approved real actor reactivation policy. 0059/0060 remain unchanged.
  await dbAdmin.query(readFileSync(path.resolve(process.cwd(),
    "tests/fixtures/m03-s03-e2-actor-generation-experimental.sql"), "utf8"));
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
      await expect(inserted).rejects.toMatchObject({code:"23505"});
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

  it("AG06-S03-10: real SQLSTATE 55P03 lock timeout is incorrectly classified UNAUTHORIZED", async () => {
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
      // Current catch wrongly turns this operational PG error into IAM denial.
      await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
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
