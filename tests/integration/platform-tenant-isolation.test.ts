// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import {
  TenantScopeMutationError,
  TenantScopeSwitchError,
  TenantUnitOfWork,
  verifyTenantScope,
  type MembershipRecord,
  type VerifiedScope,
} from "@vibress/tenancy";
import { provisionPlatformRuntimeRole } from "../../packages/database/src/platform-runtime-role";

/**
 * Real PostgreSQL isolation proof for the Wave 1 tenant contract.
 *
 * Runs against the configured development/test database, applies the additive
 * platform migration, provisions the non-owner NOBYPASSRLS runtime role and
 * exercises the deny matrix through that role. It does not use the CMS owner
 * connection for any tenant-owned read.
 */
const DATABASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const roleName = `platform_rt_${Date.now().toString(36)}`;
const password = `probe_${Date.now().toString(36)}`;
const ownerRoleName = `platform_owner_${Date.now().toString(36)}`;
const ownerPassword = `owner_${Date.now().toString(36)}`;
const ownerProbeTable = "platform_owner_rls_probe";
const applicationId = "w1-test-app";
const tenantAId = "w1-tenant-a";
const tenantBId = "w1-tenant-b";

const appId = asApplicationId(applicationId);
const tenantA = asTenantId(tenantAId);
const tenantB = asTenantId(tenantBId);
const principalId = asPrincipalId("w1-principal");

let owner: Client;
let runtime: Client;
let runtimePool: Pool;
let nonSuperOwner: Client;

function membershipFor(tenantId: typeof tenantA): MembershipRecord {
  return {
    applicationId: appId,
    tenantId,
    principalId,
    active: true,
    roles: ["staff"],
    permissions: [],
  };
}

function scopeFor(tenantId: typeof tenantA): VerifiedScope {
  const principal: VerifiedPrincipal = {
    id: principalId,
    kind: "staff",
    applicationId: appId,
    tenantIds: [tenantA, tenantB],
    roles: ["staff"],
    permissions: [],
  };
  return verifyTenantScope({
    applicationId: appId,
    tenantId,
    principal,
    membership: membershipFor(tenantId),
    authorization: {
      allowed: true,
      permissions: [],
      policyVersion: "w1-test-policy",
    },
  });
}

async function inTenantTransaction<T>(
  client: Client | PoolClient,
  tenantId: string,
  work: () => Promise<T>,
  commit = false,
): Promise<T> {
  await client.query("BEGIN");
  await client.query(
    `SELECT set_config('vibress.application_id', $1, true),
            set_config('vibress.tenant_id', $2, true)`,
    [applicationId, tenantId],
  );
  try {
    const result = await work();
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}


beforeAll(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();

  const migrationPath = path.resolve(
    process.cwd(),
    "packages/database/migrations/0054_platform_tenant_rls.sql",
  );
  await owner.query(fs.readFileSync(migrationPath, "utf8"));
  await provisionPlatformRuntimeRole(owner, { roleName, password });

  // A separate non-superuser owner. The deployment owner role must not be a
  // superuser, otherwise FORCE ROW LEVEL SECURITY is never exercised.
  const ownerRole = owner.escapeIdentifier(ownerRoleName);
  await owner.query(
    `CREATE ROLE ${ownerRole} LOGIN PASSWORD ${owner.escapeLiteral(ownerPassword)}
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  const databaseName = (
    await owner.query<{ name: string }>("SELECT current_database() AS name")
  ).rows[0]!.name;
  await owner.query(
    `GRANT CONNECT ON DATABASE ${owner.escapeIdentifier(databaseName)} TO ${ownerRole}`,
  );
  await owner.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${ownerRole}`);

  const ownerUrl = new URL(DATABASE_URL);
  ownerUrl.username = ownerRoleName;
  ownerUrl.password = ownerPassword;
  nonSuperOwner = new Client({ connectionString: ownerUrl.toString() });
  await nonSuperOwner.connect();

  await owner.query(`DROP TABLE IF EXISTS public.${ownerProbeTable}`);
  await nonSuperOwner.query(
    `CREATE TABLE public.${ownerProbeTable} (
       tenant_id text NOT NULL,
       payload text NOT NULL
     )`,
  );
  await nonSuperOwner.query(
    `INSERT INTO public.${ownerProbeTable} (tenant_id, payload)
     VALUES ($1, 'tenant-a-row'), ($2, 'tenant-b-row')`,
    [tenantAId, tenantBId],
  );
  await nonSuperOwner.query(
    `ALTER TABLE public.${ownerProbeTable} ENABLE ROW LEVEL SECURITY`,
  );
  await nonSuperOwner.query(
    `ALTER TABLE public.${ownerProbeTable} FORCE ROW LEVEL SECURITY`,
  );
  await nonSuperOwner.query(
    `CREATE POLICY ${ownerProbeTable}_isolation ON public.${ownerProbeTable}
       FOR ALL
       USING (tenant_id = NULLIF(current_setting('vibress.tenant_id', true), ''))
       WITH CHECK (tenant_id = NULLIF(current_setting('vibress.tenant_id', true), ''))`,
  );

  await owner.query(
    `INSERT INTO platform_applications (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [applicationId, "Wave 1 test application"],
  );
  for (const [id, name] of [
    [tenantAId, "Tenant A"],
    [tenantBId, "Tenant B"],
  ] as const) {
    await owner.query(
      `INSERT INTO platform_tenants (id, application_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [id, applicationId, name],
    );
  }
  await owner.query(
    "DELETE FROM platform_crm_customers WHERE application_id = $1",
    [applicationId],
  );
  await owner.query(
    `INSERT INTO platform_crm_customers (id, application_id, tenant_id, name)
     VALUES ('cust-a', $1, $2, 'Customer A'), ('cust-b', $1, $3, 'Customer B')`,
    [applicationId, tenantAId, tenantBId],
  );

  const url = new URL(DATABASE_URL);
  url.username = roleName;
  url.password = password;
  runtime = new Client({ connectionString: url.toString() });
  await runtime.connect();
  runtimePool = new Pool({ connectionString: url.toString(), max: 1 });
});

afterAll(async () => {
  await runtimePool?.end().catch(() => undefined);
  await runtime?.end().catch(() => undefined);
  if (nonSuperOwner) {
    await nonSuperOwner
      .query(`DROP TABLE IF EXISTS public.${ownerProbeTable}`)
      .catch(() => undefined);
    await nonSuperOwner.end().catch(() => undefined);
  }
  if (owner) {
    await owner
      .query("DELETE FROM platform_applications WHERE id = $1", [applicationId])
      .catch(() => undefined);
    const role = owner.escapeIdentifier(roleName);
    await owner.query(`DROP OWNED BY ${role}`).catch(() => undefined);
    await owner.query(`DROP ROLE ${role}`).catch(() => undefined);
    const ownerRole = owner.escapeIdentifier(ownerRoleName);
    await owner.query(`DROP OWNED BY ${ownerRole}`).catch(() => undefined);
    await owner.query(`DROP ROLE ${ownerRole}`).catch(() => undefined);
    await owner.end().catch(() => undefined);
  }
});

describe("provisioned platform runtime role", () => {
  it("is a non-superuser with NOBYPASSRLS", async () => {
    const result = await owner.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
      [roleName],
    );
    expect(result.rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
    });
  });

  it("cannot create tables in the public schema", async () => {
    await expect(
      runtime.query("CREATE TABLE public.platform_rls_probe (id text)"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot TRUNCATE tenant-owned rows", async () => {
    await expect(
      runtime.query("TRUNCATE TABLE platform_crm_customers"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot read the CMS users table", async () => {
    await expect(
      runtime.query("SELECT count(*) FROM users"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot read the operator-owned application registry", async () => {
    await expect(
      runtime.query("SELECT id FROM platform_applications"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("still executes owner-owned public functions through PUBLIC (R26 open)", async () => {
    // PostgreSQL grants EXECUTE on new functions to PUBLIC. The role-specific
    // REVOKE in provisionPlatformRuntimeRole does not remove that effective
    // grant, so this probe pins the residual until the R26 function inventory
    // and a reviewed targeted-revocation migration land. This is recorded as a
    // Wave 1 blocker, not as accepted behavior.
    const functionName = `public.${roleName}_probe`;
    await owner.query(
      `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS text
         LANGUAGE sql STABLE AS 'SELECT current_user::text'`,
    );
    try {
      const result = await runtime.query<{ executed_as: string }>(
        `SELECT ${functionName}() AS executed_as`,
      );
      expect(result.rows[0]?.executed_as).toBe(roleName);
    } finally {
      await owner.query(`DROP FUNCTION IF EXISTS ${functionName}`);
    }
  });
});

describe("FORCE RLS with a non-superuser table owner", () => {
  it("provisions an owner that is not a superuser and cannot bypass RLS", async () => {
    const result = await owner.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [ownerRoleName],
    );
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("returns no rows to the owner without tenant context", async () => {
    const result = await nonSuperOwner.query(
      `SELECT payload FROM public.${ownerProbeTable}`,
    );
    expect(result.rowCount).toBe(0);
  });

  it("treats row_security=off as an error for the owner", async () => {
    await nonSuperOwner.query("BEGIN");
    try {
      await nonSuperOwner.query("SET LOCAL row_security = off");
      await expect(
        nonSuperOwner.query(`SELECT payload FROM public.${ownerProbeTable}`),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await nonSuperOwner.query("ROLLBACK");
    }
  });

  it("shows the owner only rows matching the tenant context", async () => {
    await nonSuperOwner.query("BEGIN");
    try {
      await nonSuperOwner.query(
        "SELECT set_config('vibress.tenant_id', $1, true)",
        [tenantAId],
      );
      const result = await nonSuperOwner.query<{ payload: string }>(
        `SELECT payload FROM public.${ownerProbeTable}`,
      );
      expect(result.rows.map((row) => row.payload)).toEqual(["tenant-a-row"]);
    } finally {
      await nonSuperOwner.query("ROLLBACK");
    }
  });

  it("still allows the owner to run DDL on its own table", async () => {
    await nonSuperOwner.query(
      `ALTER TABLE public.${ownerProbeTable} ADD COLUMN IF NOT EXISTS note text`,
    );
  });
});

describe("tenant row-level security", () => {
  it("returns no rows when application/tenant context is missing", async () => {
    const result = await runtime.query(
      "SELECT id FROM platform_crm_customers ORDER BY id",
    );
    expect(result.rowCount).toBe(0);
  });

  it("shows only tenant A rows under tenant A context", async () => {
    const rows = await inTenantTransaction(runtime, tenantAId, async () => {
      const result = await runtime.query<{ id: string }>(
        "SELECT id FROM platform_crm_customers ORDER BY id",
      );
      return result.rows.map((row) => row.id);
    });
    expect(rows).toEqual(["cust-a"]);
  });

  it("shows only tenant B rows under tenant B context", async () => {
    const rows = await inTenantTransaction(runtime, tenantBId, async () => {
      const result = await runtime.query<{ id: string }>(
        "SELECT id FROM platform_crm_customers ORDER BY id",
      );
      return result.rows.map((row) => row.id);
    });
    expect(rows).toEqual(["cust-b"]);
  });

  it("cannot update another tenant's row", async () => {
    const affected = await inTenantTransaction(runtime, tenantAId, async () => {
      const result = await runtime.query(
        "UPDATE platform_crm_customers SET name = 'stolen' WHERE id = 'cust-b'",
      );
      return result.rowCount;
    });
    expect(affected).toBe(0);
  });

  it("rejects an insert whose tenant does not match the context", async () => {
    await expect(
      inTenantTransaction(runtime, tenantAId, async () => {
        await runtime.query(
          `INSERT INTO platform_crm_customers (id, application_id, tenant_id, name)
           VALUES ('cust-x', $1, $2, 'Cross tenant')`,
          [applicationId, tenantBId],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("allows an insert whose tenant matches the context", async () => {
    const inserted = await inTenantTransaction(
      runtime,
      tenantAId,
      async () => {
        const result = await runtime.query(
          `INSERT INTO platform_crm_customers (id, application_id, tenant_id, name)
           VALUES ('cust-a2', $1, $2, 'Customer A2')`,
          [applicationId, tenantAId],
        );
        return result.rowCount;
      },
      true,
    );
    expect(inserted).toBe(1);
  });

  it("treats row_security=off as an error, not a bypass", async () => {
    await expect(
      inTenantTransaction(runtime, tenantAId, async () => {
        await runtime.query("SET LOCAL row_security = off");
        await runtime.query("SELECT id FROM platform_crm_customers");
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("does not leak transaction-local context through a pooled connection", async () => {
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('vibress.application_id', $1, true),
                set_config('vibress.tenant_id', $2, true)`,
        [applicationId, tenantAId],
      );
      const inside = await client.query("SELECT id FROM platform_crm_customers");
      expect(inside.rowCount).toBeGreaterThan(0);
      await client.query("COMMIT");

      const after = await client.query("SELECT id FROM platform_crm_customers");
      expect(after.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe("tenant unit of work against PostgreSQL", () => {
  it("reads only the scoped tenant", async () => {
    const uow = new TenantUnitOfWork(runtimePool);
    const rows = await uow.run(scopeFor(tenantA), async (tx) => {
      const result = await tx.query<{ id: string }>(
        "SELECT id FROM platform_crm_customers ORDER BY id",
      );
      return result.rows.map((row) => row.id);
    });
    expect(rows).toEqual(["cust-a", "cust-a2"]);
  });

  it("rejects a nested tenant switch before it can query", async () => {
    const uow = new TenantUnitOfWork(runtimePool);
    await expect(
      uow.run(scopeFor(tenantA), async () => {
        await uow.run(scopeFor(tenantB), async () => undefined);
      }),
    ).rejects.toThrow(TenantScopeSwitchError);
  });

  it("rejects raw scope mutation inside the scoped transaction", async () => {
    const uow = new TenantUnitOfWork(runtimePool);
    await expect(
      uow.run(scopeFor(tenantA), async (tx) => {
        await tx.query(
          "SELECT set_config('vibress.tenant_id', 'w1-tenant-b', true)",
        );
      }),
    ).rejects.toThrow(TenantScopeMutationError);
  });
});
