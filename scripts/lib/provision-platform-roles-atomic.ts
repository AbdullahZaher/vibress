import type { ClientBase } from "pg";
import {
  provisionPlatformDeploymentVerifierRole,
  provisionPlatformMembershipReaderRole,
  provisionPlatformRuntimeRole,
  REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
  type PlatformDeploymentVerifierConfig,
  type PlatformMembershipReaderConfig,
  type PlatformRuntimeRoleConfig,
} from "@vibress/database";

/** Internal orchestration stages; only the disposable integration harness uses the hook. */
export type RoleProvisioningStage =
  | "before_runtime"
  | "after_runtime"
  | "after_reader"
  | "after_verifier"
  | "after_validation";

export interface AtomicPlatformRoleProvisioningInput {
  readonly runtime: PlatformRuntimeRoleConfig;
  readonly reader: PlatformMembershipReaderConfig;
  readonly verifier: PlatformDeploymentVerifierConfig;
  /** Fault injection is not supplied by the production CLI. */
  readonly afterStage?: (stage: RoleProvisioningStage) => Promise<void>;
}

/**
 * An uncertain BEGIN/COMMIT response or failed ROLLBACK invalidates the
 * provisioning connection. Consumers MUST use a fresh session and reconcile
 * catalog/ACL state before retry. An error from COMMIT is not evidence that
 * PostgreSQL rolled the transaction back.
 */
export class UnsafePlatformRoleProvisioningConnectionError extends Error {
  readonly reconciliationRequired = true;
  constructor(readonly phase: "begin" | "commit" | "rollback", cause: unknown) {
    super(
      `Cannot establish PostgreSQL role-provisioning transaction outcome (${phase}); connection discarded; reconcile effective privileges from a fresh connection before retry`,
      { cause },
    );
    this.name = "UnsafePlatformRoleProvisioningConnectionError";
  }
}

const unsafeProvisioningClients = new WeakSet<ClientBase>();

async function discardUnsafeClient(client: ClientBase): Promise<void> {
  // PoolClient.release(true) is the supported pool-destruction path. A dedicated
  // pg.Client must be ended. Regardless of close failure, this object remains
  // tainted and cannot be reused through this helper.
  unsafeProvisioningClients.add(client);
  const closeable = client as ClientBase & {
    release?: (destroy?: boolean) => void;
    end?: () => Promise<void>;
  };
  try {
    if (typeof closeable.release === "function") {
      closeable.release(true);
    } else if (typeof closeable.end === "function") {
      await closeable.end();
    }
  } catch {
    // Preserve the uncertain transaction result, not an unrelated close error.
    // Never attempt another SQL statement on this client.
  }
}

/**
 * PostgreSQL role DDL, privileges, ownership and default ACL changes are
 * transactional. One client / one transaction makes the three-role batch
 * all-or-nothing. An xact-scoped advisory lock serializes cooperative
 * provisioning calls and is automatically released on rollback/commit.
 *
 * This does not revoke privileges granted via PUBLIC or another role:
 * independent startup assertions and R26 inventory remain mandatory.
 * A lost connection while COMMIT is in flight has an unknown outcome and
 * must be reconciled by read-only effective-grant inspection before retry.
 */
export async function provisionPlatformRolesAtomically(
  client: ClientBase,
  input: AtomicPlatformRoleProvisioningInput,
): Promise<void> {
  if (unsafeProvisioningClients.has(client)) {
    throw new Error(
      "Unsafe PostgreSQL provisioning client cannot be reused; open a fresh connection and reconcile role/ACL state",
    );
  }
  // A custom query-only adapter cannot be safely quarantined after a lost
  // transaction response; require a destroyable pg Client or PoolClient.
  const closeable = client as ClientBase & {
    release?: (destroy?: boolean) => void;
    end?: () => Promise<void>;
  };
  if (typeof closeable.release !== "function" && typeof closeable.end !== "function") {
    throw new Error("Atomic role provisioning requires a destroyable PostgreSQL connection");
  }
  if (new Set([input.runtime.roleName, input.reader.roleName, input.verifier.roleName]).size !== 3) {
    throw new Error("Platform runtime, membership reader and deployment verifier must have distinct roles");
  }

  // A BEGIN error may represent a missing response after the server started
  // the transaction, so never reuse the connection after BEGIN failure.
  let phase: "begin" | "active" | "commit" | "completed" = "begin";
  try {
    await client.query("BEGIN");
    phase = "active";
    // Fixed cooperative lock: every provisioning caller must use this helper.
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [20261116, 106]);
    await input.afterStage?.("before_runtime");

    await provisionPlatformRuntimeRole(
      client, input.runtime, REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
    );
    await input.afterStage?.("after_runtime");

    await provisionPlatformMembershipReaderRole(client, input.reader);
    await input.afterStage?.("after_reader");

    await provisionPlatformDeploymentVerifierRole(client, input.verifier);
    await input.afterStage?.("after_verifier");

    const names = [input.runtime.roleName, input.reader.roleName, input.verifier.roleName];
    const result = await client.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls,
              rolcreaterole, rolcreatedb, rolreplication
         FROM pg_roles WHERE rolname = ANY($1)`,
      [names],
    );
    if (
      result.rows.length !== 3 ||
      result.rows.some((role) =>
        !role.rolcanlogin || role.rolsuper || role.rolbypassrls ||
        role.rolcreaterole || role.rolcreatedb || role.rolreplication
      )
    ) {
      throw new Error("One or more serving roles are missing or retain privileged attributes");
    }

    // A pre-existing role membership can bypass the explicit revokes above via
    // INHERIT or SET ROLE; reject the entire transaction rather than issuing a
    // misleading 'provisioned successfully' message.
    const memberships = await client.query<{ member: string; grantedRole: string }>(
      `SELECT member.rolname AS member,
              granted.rolname AS "grantedRole"
         FROM pg_auth_members m
         JOIN pg_roles member ON member.oid = m.member
         JOIN pg_roles granted ON granted.oid = m.roleid
        WHERE member.rolname = ANY($1)`,
      [names],
    );
    if (memberships.rows.length > 0) {
      throw new Error(
        "Serving roles retain role memberships; explicit/inherited/SET ROLE authority requires separate reconciliation",
      );
    }

    // Role ownership cannot be removed through ACL REVOKE. Do not certify a
    // reused service role that already owns a database, schema, relation or
    // non-extension routine.
    const ownership = await client.query<{ kind: string; object: string }>(
      `SELECT 'database' AS kind, d.datname AS object
           FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
          WHERE r.rolname = ANY($1)
         UNION ALL
         SELECT 'schema', n.nspname
           FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
          WHERE r.rolname = ANY($1)
            AND n.nspname NOT LIKE 'pg_%'
            AND n.nspname <> 'information_schema'
         UNION ALL
         SELECT 'relation', c.oid::regclass::text
           FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
          WHERE r.rolname = ANY($1)
         UNION ALL
         SELECT 'routine', p.oid::regprocedure::text
           FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE r.rolname = ANY($1)`,
      [names],
    );
    if (ownership.rows.length > 0) {
      throw new Error("A serving role owns database objects; provisioning aborted until ownership is remediated");
    }

    await input.afterStage?.("after_validation");

    phase = "commit";
    await client.query("COMMIT");
    phase = "completed";
  } catch (error) {
    if (phase === "commit" || phase === "begin") {
      // COMMIT may have succeeded even if its response was lost. NEVER
      // conclude ROLLBACK and NEVER automatically retry on this client.
      await discardUnsafeClient(client);
      throw new UnsafePlatformRoleProvisioningConnectionError(phase, error);
    }
    if (phase === "active") {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        await discardUnsafeClient(client);
        throw new UnsafePlatformRoleProvisioningConnectionError(
          "rollback",
          new AggregateError([error, rollbackError], "Provisioning and ROLLBACK both failed"),
        );
      }
    }
    throw error;
  }
}
