// @vitest-environment node
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionPlatformRolesAtomically,
  type AtomicPlatformRoleProvisioningInput,
  type RoleProvisioningStage,
} from "../../scripts/lib/provision-platform-roles-atomic";

const databaseUrl =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const suffix = Date.now().toString(36);
let sequence = 0;
let owner: Client;
const allRoles = new Set<string>();

function config(): AtomicPlatformRoleProvisioningInput {
  const id = suffix + "_" + (++sequence);
  const input = {
    runtime: { roleName: "w1_rt_" + id, password: "runtime_" + id },
    reader: { roleName: "w1_rd_" + id, password: "reader_" + id },
    verifier: { roleName: "w1_vf_" + id, password: "verifier_" + id },
  };
  for (const item of [input.runtime, input.reader, input.verifier]) {
    allRoles.add(item.roleName);
  }
  return input;
}

async function actualRoles(input: AtomicPlatformRoleProvisioningInput) {
  const names = [input.runtime.roleName, input.reader.roleName, input.verifier.roleName];
  const result = await owner.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
  }>(
    "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname",
    [names],
  );
  return result.rows;
}

async function failAt(stage: RoleProvisioningStage) {
  const input = config();
  await expect(provisionPlatformRolesAtomically(owner, {
    ...input,
    async afterStage(current) {
      if (current === stage) throw new Error("injected-" + stage);
    },
  })).rejects.toThrow("injected-" + stage);
  expect(await actualRoles(input)).toEqual([]);
}

beforeAll(async () => {
  owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
});

afterAll(async () => {
  if (!owner) return;
  for (const roleName of allRoles) {
    const role = owner.escapeIdentifier(roleName);
    const present = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);
    if (present.rowCount) {
      await owner.query("DROP OWNED BY " + role);
      await owner.query("DROP ROLE " + role);
    }
  }
  await owner.end();
});

describe("AG06-05 atomic platform role provisioning on PostgreSQL", () => {
  it("commits a complete nonprivileged three-role batch", async () => {
    const input = config();
    await provisionPlatformRolesAtomically(owner, input);
    const rows = await actualRoles(input);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        rolsuper: false, rolbypassrls: false, rolcreaterole: false,
      });
    }
  });

  it("rolls back when faulted before creating the runtime role", async () => {
    await failAt("before_runtime");
  });

  it("rolls back a rejected runtime role configuration", async () => {
    const input = config();
    await expect(provisionPlatformRolesAtomically(owner, {
      ...input, runtime: { ...input.runtime, password: "" },
    })).rejects.toThrow(/password/);
    expect(await actualRoles(input)).toEqual([]);
  });

  it("rolls back runtime role changes before reader provisioning", async () => {
    await failAt("after_runtime");
  });

  it("rolls back runtime/reader changes if membership reader fails", async () => {
    const input = config();
    await expect(provisionPlatformRolesAtomically(owner, {
      ...input, reader: { ...input.reader, password: "" },
    })).rejects.toThrow(/password/);
    expect(await actualRoles(input)).toEqual([]);
  });

  it("rolls back runtime and reader when verifier provisioning fails", async () => {
    await failAt("after_reader");
  });

  it("rolls back all three roles when final privileges cannot be certified", async () => {
    await failAt("after_verifier");
    await failAt("after_validation");
  });

  it("allows idempotent retry only after the failed transaction is rolled back", async () => {
    const input = config();
    await expect(provisionPlatformRolesAtomically(owner, {
      ...input,
      async afterStage(stage) {
        if (stage === "after_reader") throw new Error("transient");
      },
    })).rejects.toThrow("transient");
    expect(await actualRoles(input)).toEqual([]);
    await provisionPlatformRolesAtomically(owner, input);
    await provisionPlatformRolesAtomically(owner, input);
    expect(await actualRoles(input)).toHaveLength(3);
  });

  it("restores previously held effective grants on rollback", async () => {
    const input = config();
    const role = owner.escapeIdentifier(input.runtime.roleName);
    await owner.query("CREATE ROLE " + role + " LOGIN PASSWORD " + owner.escapeLiteral("prior-password"));
    await owner.query("GRANT TRUNCATE ON TABLE public.platform_crm_customers TO " + role);
    const before = await owner.query<{ effective: boolean }>(
      "SELECT has_table_privilege($1, 'public.platform_crm_customers', 'TRUNCATE') AS effective",
      [input.runtime.roleName],
    );
    expect(before.rows[0]?.effective).toBe(true);

    await expect(provisionPlatformRolesAtomically(owner, {
      ...input,
      async afterStage(stage) {
        if (stage === "after_runtime") throw new Error("revert-all");
      },
    })).rejects.toThrow("revert-all");

    const after = await owner.query<{ effective: boolean }>(
      "SELECT has_table_privilege($1, 'public.platform_crm_customers', 'TRUNCATE') AS effective",
      [input.runtime.roleName],
    );
    expect(after.rows).toEqual(before.rows);
    expect(await actualRoles(input)).toHaveLength(1);
  });

  it("serializes two concurrent provisioning attempts on the same role names", async () => {
    const input = config();
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await Promise.all([
        provisionPlatformRolesAtomically(first, input),
        provisionPlatformRolesAtomically(second, input),
      ]);
      expect(await actualRoles(input)).toHaveLength(3);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});
