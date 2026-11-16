// @vitest-environment node
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSafePlatformRuntimeRole,
  provisionPlatformRuntimeRole,
  UnsafePlatformRuntimeRoleError,
} from "../../packages/database/src/platform-runtime-role";
import { assertValidRuntimePrivilegeContract } from "../../packages/database/src/platform-runtime-privilege-contract";

/**
 * R35: runtime views must be caller-scoped. A view declared in the runtime
 * privilege contract is accepted only when PostgreSQL evaluates it as the
 * caller (`security_invoker=true`); materialized views are rejected because
 * stored rows cannot be filtered by the caller's row-level security.
 *
 * The dev fixture's owner is a superuser, so a non-invoker view genuinely
 * leaks here — the leak is measured, not assumed. Throwaway roles and a
 * throwaway view are dropped in `afterAll`.
 */
const DATABASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const suffix = Date.now().toString(36);
const applicationId = `r35-app-${suffix}`;
const tenantId = `r35-tenant-${suffix}`;
const customerId = `r35-customer-${suffix}`;
const runtimeRole = `r35_rt_${suffix}`;
const runtimePassword = `r35_${suffix}`;
const viewName = `r35_view_${suffix}`;

const contract = {
  version: 2,
  profile: "r35-view-surface-test",
  schemas: ["public"],
  relations: [
    {
      schema: "public",
      relation: viewName,
      kind: "view",
      privileges: ["SELECT"],
    },
    {
      schema: "public",
      relation: "platform_crm_customers",
      kind: "table",
      privileges: ["SELECT"],
    },
  ],
  sequences: [],
  functions: [],
} as const;

function urlFor(role: string, password: string): string {
  const url = new URL(DATABASE_URL);
  url.username = role;
  url.password = password;
  return url.toString();
}

let owner: Client;
let runtime: Client;

beforeAll(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();

  await owner.query(
    `INSERT INTO platform_applications (id, name) VALUES ($1, $2)`,
    [applicationId, "R35 view surface application"],
  );
  await owner.query(
    `INSERT INTO platform_tenants (id, application_id, name) VALUES ($1, $2, $3)`,
    [tenantId, applicationId, "R35 view surface tenant"],
  );
  await owner.query("BEGIN");
  try {
    await owner.query(
      `SELECT set_config('vibress.application_id', $1, true),
              set_config('vibress.tenant_id', $2, true)`,
      [applicationId, tenantId],
    );
    await owner.query(
      `INSERT INTO platform_crm_customers (id, application_id, tenant_id, name)
       VALUES ($1, $2, $3, 'R35 view surface customer')`,
      [customerId, applicationId, tenantId],
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  await owner.query(
    `CREATE VIEW public.${owner.escapeIdentifier(viewName)}
       AS SELECT id, tenant_id FROM platform_crm_customers`,
  );
  await provisionPlatformRuntimeRole(
    owner,
    { roleName: runtimeRole, password: runtimePassword },
    contract,
  );

  runtime = new Client({
    connectionString: urlFor(runtimeRole, runtimePassword),
  });
  await runtime.connect();
});

afterAll(async () => {
  await runtime?.end().catch(() => undefined);
  if (owner) {
    await owner
      .query(`DROP VIEW IF EXISTS public.${owner.escapeIdentifier(viewName)}`)
      .catch(() => undefined);
    await owner
      .query("DELETE FROM platform_applications WHERE id = $1", [applicationId])
      .catch(() => undefined);
    const role = owner.escapeIdentifier(runtimeRole);
    await owner.query(`DROP OWNED BY ${role}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    await owner.end().catch(() => undefined);
  }
});

async function bootViolationCodes(): Promise<string[]> {
  const error = await assertSafePlatformRuntimeRole(runtime, {
    profile: "runtime",
    privilegeContract: contract,
  }).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(UnsafePlatformRuntimeRoleError);
  return (error as UnsafePlatformRuntimeRoleError).violations.map(
    (violation) => violation.code,
  );
}

describe("R35 runtime view surface", () => {
  it("rejects a materialized view in the runtime contract", () => {
    expect(() =>
      assertValidRuntimePrivilegeContract({
        ...contract,
        relations: [
          {
            schema: "public",
            relation: viewName,
            kind: "materialized_view",
            privileges: ["SELECT"],
          },
        ],
      }),
    ).toThrow(/materialized views are excluded from the runtime contract/);
  });

  it("refuses to boot with a declared view that is not security_invoker, and the view leaks here", async () => {
    await expect(bootViolationCodes()).resolves.toContain(
      "view_not_security_invoker",
    );

    const direct = await runtime.query("SELECT id FROM platform_crm_customers");
    expect(direct.rowCount).toBe(0);

    const throughView = await runtime.query<{ id: string }>(
      `SELECT id FROM public.${owner.escapeIdentifier(viewName)}`,
    );
    expect(throughView.rows.map((row) => row.id)).toContain(customerId);
  });

  it("accepts a security_invoker view and enforces the caller's tenant scope through it", async () => {
    await owner.query(
      `ALTER VIEW public.${owner.escapeIdentifier(viewName)} SET (security_invoker = true)`,
    );

    const attributes = await assertSafePlatformRuntimeRole(runtime, {
      profile: "runtime",
      privilegeContract: contract,
    });
    expect(attributes.currentUser).toBe(runtimeRole);

    const unscoped = await runtime.query(
      `SELECT id FROM public.${owner.escapeIdentifier(viewName)}`,
    );
    expect(unscoped.rowCount).toBe(0);

    await runtime.query("BEGIN");
    try {
      await runtime.query(
        `SELECT set_config('vibress.application_id', $1, true),
                set_config('vibress.tenant_id', $2, true)`,
        [applicationId, tenantId],
      );
      const scoped = await runtime.query<{ id: string }>(
        `SELECT id FROM public.${owner.escapeIdentifier(viewName)}`,
      );
      expect(scoped.rows.map((row) => row.id)).toEqual([customerId]);
    } finally {
      await runtime.query("ROLLBACK");
    }
  });
});
