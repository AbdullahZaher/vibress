import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionPlatformRuntimeRole } from "../../packages/database/src/platform-runtime-role";

/**
 * Two-installation isolation proof for ADR-PLAT-001.
 *
 * Each installation gets its own database, non-superuser owner role and
 * NOBYPASSRLS runtime role. CONNECT is revoked from PUBLIC on both databases,
 * so a role from one installation is rejected before it can query anything.
 *
 * This test creates and drops databases and cluster roles, so it requires a
 * superuser connection. It is excluded from the root CMS test config.
 */
const BASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const suffix = Date.now().toString(36);
const applicationId = "inst-app";
const tenantId = "t-acme";

type InstallationKey = "a" | "b";

interface Installation {
  key: InstallationKey;
  database: string;
  ownerRole: string;
  ownerPassword: string;
  runtimeRole: string;
  runtimePassword: string;
}

interface BuiltInstallation {
  installation: Installation;
  owner: Client;
  runtime: Client;
}

const installations: Installation[] = (["a", "b"] as const).map((key) => ({
  key,
  database: `vibress_inst_${key}_${suffix}`,
  ownerRole: `inst_${key}_owner_${suffix}`,
  ownerPassword: `owner_${key}_${suffix}`,
  runtimeRole: `inst_${key}_rt_${suffix}`,
  runtimePassword: `rt_${key}_${suffix}`,
}));

const customerName = (installation: Installation): string =>
  `Customer in installation ${installation.key.toUpperCase()}`;

function urlFor(database: string, role: string, password: string): string {
  const url = new URL(BASE_URL);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

function adminUrl(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

const byKey = (key: InstallationKey): Installation => {
  const found = installations.find((item) => item.key === key);
  if (!found) {
    throw new Error(`missing installation ${key}`);
  }
  return found;
};

let admin: Client;
const built: BuiltInstallation[] = [];

beforeAll(async () => {
  admin = new Client({ connectionString: BASE_URL });
  await admin.connect();

  const current = await admin.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  if (!current.rows[0]?.rolsuper) {
    throw new Error(
      "installation isolation test requires a superuser connection to create databases and roles",
    );
  }

  const migration = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "packages/database/migrations/0054_platform_tenant_rls.sql",
    ),
    "utf8",
  );

  for (const installation of installations) {
    const ownerIdent = admin.escapeIdentifier(installation.ownerRole);
    await admin.query(
      `CREATE ROLE ${ownerIdent} LOGIN PASSWORD ${admin.escapeLiteral(installation.ownerPassword)}
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `CREATE DATABASE ${admin.escapeIdentifier(installation.database)} OWNER ${ownerIdent}`,
    );

    // Owner applies the additive migration, so tables are owned by a
    // non-superuser in each installation.
    const owner = new Client({
      connectionString: urlFor(
        installation.database,
        installation.ownerRole,
        installation.ownerPassword,
      ),
    });
    await owner.connect();
    await owner.query(migration);

    await owner.query(
      "INSERT INTO platform_applications (id, name) VALUES ($1, $2)",
      [applicationId, `Installation ${installation.key.toUpperCase()}`],
    );
    await owner.query(
      "INSERT INTO platform_tenants (id, application_id, name) VALUES ($1, $2, $3)",
      [tenantId, applicationId, `Acme ${installation.key}`],
    );

    // The tenant table has FORCE RLS, so the owner seeds within a scoped
    // transaction just like the runtime does.
    await owner.query("BEGIN");
    try {
      await owner.query(
        `SELECT set_config('vibress.application_id', $1, true),
                set_config('vibress.tenant_id', $2, true)`,
        [applicationId, tenantId],
      );
      await owner.query(
        `INSERT INTO platform_crm_customers (id, application_id, tenant_id, name)
         VALUES ('cust-acme', $1, $2, $3)`,
        [applicationId, tenantId, customerName(installation)],
      );
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const adminInDatabase = new Client({
      connectionString: adminUrl(installation.database),
    });
    await adminInDatabase.connect();
    await provisionPlatformRuntimeRole(adminInDatabase, {
      roleName: installation.runtimeRole,
      password: installation.runtimePassword,
    });
    // PUBLIC CONNECT would let any cluster role reach this database. Revoke it
    // so the installation boundary is credentials + database, not naming.
    await adminInDatabase.query(
      `REVOKE CONNECT ON DATABASE ${admin.escapeIdentifier(installation.database)} FROM PUBLIC`,
    );
    await adminInDatabase.end();

    const runtime = new Client({
      connectionString: urlFor(
        installation.database,
        installation.runtimeRole,
        installation.runtimePassword,
      ),
    });
    await runtime.connect();

    built.push({ installation, owner, runtime });
  }
});

afterAll(async () => {
  for (const entry of built) {
    await entry.runtime.end().catch(() => undefined);
    await entry.owner.end().catch(() => undefined);
  }
  if (admin) {
    await admin
      .query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = ANY($1) AND pid <> pg_backend_pid()`,
        [installations.map((item) => item.database)],
      )
      .catch(() => undefined);
    for (const installation of installations) {
      await admin
        .query(
          `DROP DATABASE IF EXISTS ${admin.escapeIdentifier(installation.database)}`,
        )
        .catch(() => undefined);
      for (const role of [installation.runtimeRole, installation.ownerRole]) {
        await admin
          .query(`DROP ROLE IF EXISTS ${admin.escapeIdentifier(role)}`)
          .catch(() => undefined);
      }
    }
    await admin.end().catch(() => undefined);
  }
});

describe("installation credentials", () => {
  it("provisions distinct non-superuser roles per installation", async () => {
    const result = await admin.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = ANY($1)
        ORDER BY rolname`,
      [
        installations.flatMap((item) => [
          item.ownerRole,
          item.runtimeRole,
        ]),
      ],
    );
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) {
      expect(row).toMatchObject({ rolsuper: false, rolbypassrls: false });
    }
  });

  it("grants neither installation membership in the superuser role", async () => {
    const a = byKey("a");
    const b = byKey("b");
    const result = await admin.query<{ a: boolean; b: boolean }>(
      `SELECT pg_has_role($1, 'vibress', 'MEMBER') AS a,
              pg_has_role($2, 'vibress', 'MEMBER') AS b`,
      [a.runtimeRole, b.runtimeRole],
    );
    expect(result.rows[0]).toEqual({ a: false, b: false });
  });

  it("rejects installation B runtime credentials at CONNECT on installation A", async () => {
    const a = byKey("a");
    const b = byKey("b");
    const client = new Client({
      connectionString: urlFor(a.database, b.runtimeRole, b.runtimePassword),
    });
    try {
      await expect(client.connect()).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  it("rejects installation A owner credentials at CONNECT on installation B", async () => {
    const a = byKey("a");
    const b = byKey("b");
    const client = new Client({
      connectionString: urlFor(b.database, a.ownerRole, a.ownerPassword),
    });
    try {
      await expect(client.connect()).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.end().catch(() => undefined);
    }
  });
});

describe("installation data independence", () => {
  it("returns no rows without tenant context in either installation", async () => {
    for (const entry of built) {
      const result = await entry.runtime.query(
        "SELECT id FROM platform_crm_customers",
      );
      expect(result.rowCount).toBe(0);
    }
  });

  it("keeps the same tenant id independent across installations", async () => {
    for (const entry of built) {
      await entry.runtime.query("BEGIN");
      try {
        await entry.runtime.query(
          `SELECT set_config('vibress.application_id', $1, true),
                  set_config('vibress.tenant_id', $2, true)`,
          [applicationId, tenantId],
        );
        const result = await entry.runtime.query<{ name: string }>(
          "SELECT name FROM platform_crm_customers ORDER BY id",
        );
        expect(result.rows).toEqual([
          { name: customerName(entry.installation) },
        ]);
      } finally {
        await entry.runtime.query("ROLLBACK");
      }
    }
  });

  it("does not let either runtime role read the application registry", async () => {
    for (const entry of built) {
      await expect(
        entry.runtime.query("SELECT id FROM platform_applications"),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("does not let either runtime role create objects", async () => {
    for (const entry of built) {
      await expect(
        entry.runtime.query("CREATE TABLE public.installation_probe (id text)"),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
