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
  if (new Set([input.runtime.roleName, input.reader.roleName, input.verifier.roleName]).size !== 3) {
    throw new Error("Platform runtime, membership reader and deployment verifier must have distinct roles");
  }

  await client.query("BEGIN");
  try {
    // Two fixed, app-specific lock keys. Do not split these steps across clients.
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
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ANY($1)",
      [names],
    );
    if (result.rows.length !== 3 ||
        result.rows.some((role) =>
          role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb)) {
      throw new Error("One or more platform roles are missing or retain privileged attributes");
    }
    await input.afterStage?.("after_validation");
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Never report a clean rollback when the session/transaction state is unknown.
      throw new AggregateError(
        [error, rollbackError],
        "Platform role provisioning failed and rollback could not be confirmed; close the connection and audit role/ACL state",
      );
    }
    throw error;
  }
}
