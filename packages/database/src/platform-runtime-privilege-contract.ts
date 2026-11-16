export type RuntimeRelationKind =
  | "table"
  | "view"
  | "materialized_view"
  | "foreign_table";

export type RuntimeRelationPrivilege =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE";

export type RuntimeSequencePrivilege = "USAGE" | "SELECT" | "UPDATE";

export interface RuntimeRelationGrant {
  readonly schema: string;
  readonly relation: string;
  readonly kind: RuntimeRelationKind;
  readonly privileges: readonly RuntimeRelationPrivilege[];
}

export interface RuntimeSequenceGrant {
  readonly schema: string;
  readonly sequence: string;
  readonly privileges: readonly RuntimeSequencePrivilege[];
}

export interface RuntimeFunctionGrant {
  readonly schema: string;
  readonly name: string;
  /**
   * Exact PostgreSQL identity arguments, as produced by
   * `pg_get_function_identity_arguments(oid)` (for example `"integer, text"`,
   * or `""` for a zero-argument function). Overloads of one name have
   * different identities and must each be authorized explicitly.
   */
  readonly identityArguments: string;
}

/**
 * Versioned description of the only database authority a runtime profile may
 * hold. Provisioning grants exactly this set and boot rejects anything else,
 * including privileges inherited through role membership or PUBLIC.
 *
 * A profile must be updated before an application gains a new relation, view,
 * sequence or owner-defined function; there is no implicit allow.
 *
 * R35: a declared `view` must exist with `security_invoker=true` (boot rejects
 * it otherwise) while both `materialized_view` and `foreign_table` are rejected outright:
 * neither provides local, caller-scoped row-level security under this contract.
 */
export interface PlatformRuntimePrivilegeContract {
  readonly version: 2;
  readonly profile: string;
  /** Non-system schemas where USAGE is permitted. CREATE is never permitted. */
  readonly schemas: readonly string[];
  readonly relations: readonly RuntimeRelationGrant[];
  readonly sequences: readonly RuntimeSequenceGrant[];
  /** Owner-defined functions (not trigger functions) the role may execute. */
  readonly functions: readonly RuntimeFunctionGrant[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const RELATION_KINDS: readonly RuntimeRelationKind[] = [
  "table",
  "view",
  "materialized_view",
  "foreign_table",
];
const RELATION_PRIVILEGES: readonly RuntimeRelationPrivilege[] = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
];
const SEQUENCE_PRIVILEGES: readonly RuntimeSequencePrivilege[] = [
  "USAGE",
  "SELECT",
  "UPDATE",
];

function assertIdentifier(kind: string, value: string): void {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Runtime privilege contract has an invalid ${kind} identifier: ${String(value)}`,
    );
  }
}

function assertUnique(
  kind: string,
  keys: readonly string[],
): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`Runtime privilege contract repeats ${kind} '${key}'`);
    }
    seen.add(key);
  }
}

export function assertValidRuntimePrivilegeContract(
  contract: PlatformRuntimePrivilegeContract,
): void {
  if (contract.version !== 2) {
    throw new Error(
      `Unsupported runtime privilege contract version: ${String(contract.version)}`,
    );
  }
  if (!contract.profile.trim()) {
    throw new Error("Runtime privilege contract requires a profile name");
  }
  contract.schemas.forEach((schema) => assertIdentifier("schema", schema));
  assertUnique("schema", contract.schemas);

  for (const grant of contract.relations) {
    assertIdentifier("schema", grant.schema);
    assertIdentifier("relation", grant.relation);
    if (!RELATION_KINDS.includes(grant.kind)) {
      throw new Error(
        `Runtime privilege contract has an invalid relation kind '${String(grant.kind)}' for ${grant.schema}.${grant.relation}`,
      );
    }
    // R35: PostgreSQL does not apply local row-level security to a foreign
    // table. A foreign server's credentials and policies are not proven by
    // this contract; fail closed until a separately reviewed FDW model exists.
    if (grant.kind === "foreign_table") {
      throw new Error(
        `Runtime privilege contract declares '${grant.schema}.${grant.relation}' as a foreign table; caller-scoped PostgreSQL row-level security is not enforced on foreign tables, so foreign tables are excluded from the runtime contract (R35)`,
      );
    }
    if (grant.kind === "materialized_view") {
      throw new Error(
        `Runtime privilege contract declares '${grant.schema}.${grant.relation}' as a materialized view; PostgreSQL cannot evaluate row-level security as the caller against stored materialized rows, so materialized views are excluded from the runtime contract (R35)`,
      );
    }
    if (grant.privileges.length === 0) {
      throw new Error(
        `Runtime privilege contract grants no privilege on ${grant.schema}.${grant.relation}`,
      );
    }
    assertUnique(
      `privilege on ${grant.schema}.${grant.relation}`,
      grant.privileges,
    );
    for (const privilege of grant.privileges) {
      if (!RELATION_PRIVILEGES.includes(privilege)) {
        throw new Error(
          `Runtime privilege contract has an unsupported relation privilege '${String(privilege)}'`,
        );
      }
    }
  }
  assertUnique(
    "relation",
    contract.relations.map((grant) => `${grant.schema}.${grant.relation}`),
  );

  for (const grant of contract.sequences) {
    assertIdentifier("schema", grant.schema);
    assertIdentifier("sequence", grant.sequence);
    if (grant.privileges.length === 0) {
      throw new Error(
        `Runtime privilege contract grants no privilege on sequence ${grant.schema}.${grant.sequence}`,
      );
    }
    assertUnique(
      `sequence privilege on ${grant.schema}.${grant.sequence}`,
      grant.privileges,
    );
    for (const privilege of grant.privileges) {
      if (!SEQUENCE_PRIVILEGES.includes(privilege)) {
        throw new Error(
          `Runtime privilege contract has an unsupported sequence privilege '${String(privilege)}'`,
        );
      }
    }
  }
  assertUnique(
    "sequence",
    contract.sequences.map((grant) => `${grant.schema}.${grant.sequence}`),
  );

  for (const grant of contract.functions) {
    assertIdentifier("schema", grant.schema);
    assertIdentifier("function", grant.name);
    if (typeof grant.identityArguments !== "string") {
      throw new Error(
        `Runtime privilege contract has invalid identity arguments for ${grant.schema}.${grant.name}`,
      );
    }
    if (
      grant.identityArguments !== grant.identityArguments.trim() ||
      grant.identityArguments.includes("\u0000") ||
      grant.identityArguments.includes("\n")
    ) {
      throw new Error(
        `Runtime privilege contract identity arguments for ${grant.schema}.${grant.name} must be the exact pg_get_function_identity_arguments value`,
      );
    }
  }
  assertUnique(
    "function",
    contract.functions.map(
      (grant) =>
        `${grant.schema}.${grant.name}(${grant.identityArguments})`,
    ),
  );
}

/**
 * The reference CRM profile. It may read and write tenant rows in
 * `platform_crm_customers` under RLS and nothing else.
 */
export const REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT: PlatformRuntimePrivilegeContract =
  Object.freeze({
    version: 2,
    profile: "reference-crm",
    schemas: ["public"],
    relations: [
      {
        schema: "public",
        relation: "platform_crm_customers",
        kind: "table",
        privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      },
    ],
    sequences: [],
    functions: [],
  } satisfies PlatformRuntimePrivilegeContract);
