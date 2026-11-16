// @vitest-environment node
import { Client, type ClientBase } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionPlatformRolesAtomically,
  type AtomicPlatformRoleProvisioningInput,
  type RoleProvisioningStage,
  UnsafePlatformRoleProvisioningConnectionError,
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


// Stronger effective-privilege and unknown-outcome tests. These run only on
// disposable GitHub Actions PostgreSQL, never an operator-owned database.
const describeDisposable = process.env.AG02_DISPOSABLE_PG_CONFIRMED === "1" ? describe : describe.skip;
describeDisposable("AG06-05 failure injection: unsafe transport and privilege reconciliation", () => {
  function requireDisposable(): void {
    if (process.env.AG02_DISPOSABLE_PG_CONFIRMED !== "1") {
      throw new Error("Refusing AG06-05 fault injection without explicitly confirmed disposable PostgreSQL");
    }
  }

  async function connection(): Promise<Client> {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return client;
  }

  // Proxy only for test fault injection. The underlying Client remains a real
  // PostgreSQL session and all catalog observations use the independent owner.
  function withQueryFault(
    real: Client,
    hook: (sql: string) => Promise<"pass" | "throw">,
  ): ClientBase {
    return new Proxy(real, {
      get(target, property) {
        if (property === "query") {
          return async (sql: string, params?: unknown[]) => {
            const behavior = await hook(sql);
            if (behavior === "throw") throw new Error("injected-transport-failure-" + sql);
            return target.query(sql, params);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ClientBase;
  }

  async function effectivePrivileges(roleName: string, inheritedRole: string) {
    const snapshot = await owner.query(
      `SELECT
         has_table_privilege($1,'public.platform_crm_customers','TRUNCATE') AS truncate_customer,
         has_table_privilege($1,'public.platform_memberships','UPDATE') AS update_membership,
         has_schema_privilege($1,'public','CREATE') AS create_public,
         has_function_privilege($1,'public.prevent_comment_moderation_events_mutation()','EXECUTE') AS execute_trigger,
         pg_has_role($1,$2,'MEMBER') AS member_of_existing_role`,
      [roleName, inheritedRole],
    );
    return snapshot.rows[0];
  }

  it("rolls back existing ACL changes and rejects a pre-existing inherited role", async () => {
    requireDisposable();
    const input = config();
    const group = "w1_group_" + suffix + "_" + sequence;
    allRoles.add(group);
    const runtime = owner.escapeIdentifier(input.runtime.roleName);
    const groupId = owner.escapeIdentifier(group);
    await owner.query("CREATE ROLE " + runtime + " LOGIN PASSWORD " + owner.escapeLiteral("prior-" + suffix));
    await owner.query("CREATE ROLE " + groupId + " NOLOGIN");
    await owner.query("GRANT " + groupId + " TO " + runtime + " WITH INHERIT TRUE, SET TRUE");
    await owner.query("GRANT TRUNCATE ON TABLE public.platform_crm_customers TO " + runtime);
    await owner.query("GRANT UPDATE ON TABLE public.platform_memberships TO " + runtime);
    await owner.query("GRANT CREATE ON SCHEMA public TO " + runtime);
    const before = await effectivePrivileges(input.runtime.roleName, group);

    await expect(provisionPlatformRolesAtomically(owner, input))
      .rejects.toThrow(/role memberships/);
    const after = await effectivePrivileges(input.runtime.roleName, group);
    expect(after).toEqual(before);
    expect(await actualRoles(input)).toHaveLength(1);
    const rolledBack = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = ANY($1)", [
      [input.reader.roleName, input.verifier.roleName],
    ]);
    expect(rolledBack.rowCount).toBe(0);
  });

  it("fails closed if BEGIN response is lost and refuses the discarded client", async () => {
    requireDisposable();
    const input = config();
    const real = await connection();
    const proxy = withQueryFault(real, async (sql) => {
      if (sql !== "BEGIN") return "pass";
      await real.query("BEGIN"); // executed on server; response is lost to caller
      return "throw";
    });
    const error = await provisionPlatformRolesAtomically(proxy, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafePlatformRoleProvisioningConnectionError);
    expect((error as UnsafePlatformRoleProvisioningConnectionError).phase).toBe("begin");
    await expect(provisionPlatformRolesAtomically(proxy, input)).rejects.toThrow(/cannot be reused/);
    expect(await actualRoles(input)).toEqual([]);
  });

  it("closes an interrupted pre-COMMIT connection; server rolls back the open transaction", async () => {
    requireDisposable();
    const input = config();
    const real = await connection();
    const error = await provisionPlatformRolesAtomically(real, {
      ...input,
      async afterStage(stage) {
        if (stage === "after_validation") {
          await real.end(); // backend receives disconnect while transaction active
          throw new Error("injected-disconnect-before-commit");
        }
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafePlatformRoleProvisioningConnectionError);
    expect((error as UnsafePlatformRoleProvisioningConnectionError).phase).toBe("rollback");
    await expect(provisionPlatformRolesAtomically(real, input)).rejects.toThrow(/cannot be reused/);
    expect(await actualRoles(input)).toEqual([]);
  });

  it("treats lost COMMIT response as UNKNOWN, discards session, and reconciles separately", async () => {
    requireDisposable();
    const input = config();
    const real = await connection();
    const proxy = withQueryFault(real, async (sql) => {
      if (sql !== "COMMIT") return "pass";
      await real.query("COMMIT"); // intentionally succeeds on server
      return "throw";             // application never receives the ACK
    });
    const error = await provisionPlatformRolesAtomically(proxy, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafePlatformRoleProvisioningConnectionError);
    expect((error as UnsafePlatformRoleProvisioningConnectionError).phase).toBe("commit");
    await expect(provisionPlatformRolesAtomically(proxy, input)).rejects.toThrow(/cannot be reused/);
    // Commit DID succeed; blind retry is not justified. Verify from independent
    // owner connection and require operator to decide whether to retry.
    expect(await actualRoles(input)).toHaveLength(3);
    const probe = await connection();
    try {
      const observed = await probe.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [
        [input.runtime.roleName, input.reader.roleName, input.verifier.roleName],
      ]);
      expect(observed.rowCount).toBe(3);
    } finally {
      await probe.end();
    }
  });

  it("destroys connection if ROLLBACK fails; no partial role changes survive backend close", async () => {
    requireDisposable();
    const input = config();
    const real = await connection();
    const proxy = withQueryFault(real, async (sql) => sql === "ROLLBACK" ? "throw" : "pass");
    const error = await provisionPlatformRolesAtomically(proxy, {
      ...input,
      async afterStage(stage) {
        if (stage === "after_reader") throw new Error("injected-error-before-rollback");
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafePlatformRoleProvisioningConnectionError);
    expect((error as UnsafePlatformRoleProvisioningConnectionError).phase).toBe("rollback");
    await expect(provisionPlatformRolesAtomically(proxy, input)).rejects.toThrow(/cannot be reused/);
    expect(await actualRoles(input)).toEqual([]);
  });

  it("proves a competing transaction cannot take the advisory lock until release", async () => {
    requireDisposable();
    const input = config();
    const first = await connection();
    const second = await connection();
    let reachedResolve!: () => void;
    let continueResolve!: () => void;
    const reached = new Promise<void>((r) => { reachedResolve = r; });
    const continuation = new Promise<void>((r) => { continueResolve = r; });
    try {
      const provisioning = provisionPlatformRolesAtomically(first, {
        ...input,
        async afterStage(stage) {
          if (stage === "after_runtime") {
            reachedResolve();
            await continuation;
          }
        },
      });
      try {
        await reached;
        await second.query("BEGIN");
        const blocked = await second.query<{ grabbed: boolean }>(
          "SELECT pg_try_advisory_xact_lock($1,$2) AS grabbed",
          [20261116, 106],
        );
        expect(blocked.rows[0]?.grabbed).toBe(false);
        await second.query("ROLLBACK");
      } finally {
        continueResolve();
      }
      await provisioning;
      expect(await actualRoles(input)).toHaveLength(3);
      await second.query("BEGIN");
      const available = await second.query<{ grabbed: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1,$2) AS grabbed",
        [20261116, 106],
      );
      expect(available.rows[0]?.grabbed).toBe(true);
      await second.query("ROLLBACK");
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("enforces SET ROLE denial and narrow reader/verifier authority through real role sessions", async () => {
    requireDisposable();
    const input = config();
    await provisionPlatformRolesAtomically(owner, input);
    const ownerIdentity = (await owner.query<{ name: string }>(
      "SELECT current_user AS name",
    )).rows[0]?.name;
    expect(ownerIdentity).toBeDefined();
    for (const entry of [input.runtime, input.reader, input.verifier]) {
      const url = new URL(databaseUrl);
      url.username = entry.roleName;
      url.password = entry.password;
      const service = new Client({ connectionString: url.toString() });
      await service.connect();
      try {
        const attributes = await service.query<{
          current_user: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(
          `SELECT current_user, rolsuper, rolbypassrls
             FROM pg_roles WHERE rolname = current_user`,
        );
        expect(attributes.rows[0]).toMatchObject({
          current_user: entry.roleName,
          rolsuper: false,
          rolbypassrls: false,
        });
        await expect(service.query(
          "SET ROLE " + service.escapeIdentifier(ownerIdentity!),
        )).rejects.toMatchObject({ code: "42501" });
        await expect(service.query(
          "CREATE TABLE public.ag02_unauthorized_probe (id text)",
        )).rejects.toMatchObject({ code: "42501" });
        if (entry.roleName === input.runtime.roleName) {
          await expect(service.query("SELECT id FROM platform_installations"))
            .rejects.toMatchObject({ code: "42501" });
          const customers = await service.query("SELECT id FROM platform_crm_customers");
          expect(customers.rowCount).toBe(0);
        }
        if (entry.roleName === input.reader.roleName) {
          await expect(service.query("UPDATE platform_memberships SET active = active"))
            .rejects.toMatchObject({ code: "42501" });
          await expect(service.query("SELECT id FROM platform_crm_customers"))
            .rejects.toMatchObject({ code: "42501" });
        }
        if (entry.roleName === input.verifier.roleName) {
          await expect(service.query("UPDATE platform_installations SET environment = environment"))
            .rejects.toMatchObject({ code: "42501" });
          await expect(service.query("SELECT application_id FROM platform_memberships"))
            .rejects.toMatchObject({ code: "42501" });
        }
      } finally {
        await service.end();
      }
    }
  });

  it("rejects a reused serving role that already owns a non-system object", async () => {
    requireDisposable();
    const input = config();
    const roleName = owner.escapeIdentifier(input.runtime.roleName);
    await owner.query("CREATE ROLE " + roleName + " LOGIN PASSWORD " + owner.escapeLiteral("prior-" + suffix));
    const tableName = owner.escapeIdentifier(input.runtime.roleName + "_owned");
    await owner.query("CREATE TABLE public." + tableName + " (id text)");
    await owner.query("ALTER TABLE public." + tableName + " OWNER TO " + roleName);
    try {
      await expect(provisionPlatformRolesAtomically(owner, input)).rejects.toThrow(/owns database objects/);
      expect(await actualRoles(input)).toHaveLength(1);
    } finally {
      await owner.query("DROP TABLE IF EXISTS public." + tableName);
    }
  });
});
