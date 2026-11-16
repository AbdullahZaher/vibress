// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertValidRuntimePrivilegeContract,
  REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
} from "../../packages/database/src/platform-runtime-privilege-contract";

describe("R35 runtime relation-kind contract deny matrix", () => {
  it("continues accepting the reviewed ordinary-table reference profile", () => {
    expect(() =>
      assertValidRuntimePrivilegeContract(REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT),
    ).not.toThrow();
  });

  it.each(["foreign_table", "materialized_view"] as const)(
    "rejects %s before provisioning or any SQL",
    (kind) => {
      const contract = {
        ...REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
        relations: [
          {
            ...REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT.relations[0]!,
            kind,
          },
        ],
      };
      expect(() => assertValidRuntimePrivilegeContract(contract)).toThrow(
        /excluded from the runtime contract \(R35\)/,
      );
    },
  );

  it("rejects foreign-table writes as well as reads", () => {
    const contract = {
      ...REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
      relations: [
        {
          schema: "public",
          relation: "external_tenant_records",
          kind: "foreign_table" as const,
          privileges: ["SELECT", "INSERT"] as const,
        },
      ],
    };
    expect(() => assertValidRuntimePrivilegeContract(contract)).toThrow(
      /foreign tables are excluded/,
    );
  });
});
