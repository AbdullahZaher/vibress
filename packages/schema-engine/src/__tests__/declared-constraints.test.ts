import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  parseCanonicalSchemaIR,
  ResourceSchemaError,
  type FieldDefinition,
  type ResourceDefinition,
} from "../schema";
import { createSchemaManifest, parseSchemaManifest } from "../planning";
import {
  compileProvisioningContract,
  compileProvisioningTransition,
  provisioningConstraintName,
  provisioningConstraints,
  provisioningProfileFor,
  PROVISIONING_PROFILE_V2,
} from "../physical-contract";

const scope = {
  applicationId: asApplicationId("declared-constraints"),
  installationId: asInstallationId("installation-constraints"),
};
const fields: readonly FieldDefinition[] = [
  { id: "code", type: "text", required: true },
  { id: "category", type: "text", required: true },
  { id: "slug", type: "text", required: true },
  { id: "priority", type: "integer", required: false },
  { id: "status", type: "enum", required: true, values: ["open", "closed"] },
];
function resource(extra: Partial<ResourceDefinition> = {}, owned: ResourceDefinition["ownership"] = "tenant"): ResourceDefinition {
  return { ...scope, id: "tickets", ownership: owned, fields, ...extra };
}
function manifest(extra: Partial<ResourceDefinition> = {}) {
  return createSchemaManifest(compileResourceSchema([resource(extra)], scope));
}
function refuse(extra: Partial<ResourceDefinition>, owned?: ResourceDefinition["ownership"]) {
  return expect(() => createSchemaManifest(compileResourceSchema([resource(extra, owned)], scope)))
    .toThrow(ResourceSchemaError);
}

describe("declared scoped unique constraints and compound indexes", () => {
  it("canonicalizes declarations and compiles them into the typed profile", () => {
    const m = manifest({ uniques: [["category", "slug"]], indexes: [["category", "priority"]] });
    expect(provisioningProfileFor(m)).toBe(PROVISIONING_PROFILE_V2);
    const tickets = m.resources[0]!;
    expect(tickets.uniques).toEqual([["category", "slug"]]);
    expect(tickets.indexes).toEqual([["category", "priority"]]);
    expect(parseSchemaManifest(m)).toEqual(m);
    expect(parseCanonicalSchemaIR(m.canonicalIr)).toEqual(m.canonicalIr);
    const physical = compileProvisioningContract(m, scope).resources[0]!;
    expect(physical.uniques).toEqual([["tenant_id", "category", "slug"]]);
    expect(physical.indexes).toEqual([["tenant_id", "category", "priority"]]);
    const constraints = provisioningConstraints(physical, compileProvisioningContract(m, scope).namespace);
    const unique = constraints.find((c) => c.kind === "u" && c.columns.length === 3)!;
    expect(unique.name).toBe(provisioningConstraintName(physical.table, "uq", "tenant_id_category_slug"));
    expect(unique.expression).toBe("UNIQUE (tenant_id, category, slug)");
    const plan = compileProvisioningTransition(null, m, scope);
    expect(plan.statements.join("\n")).toContain(
      "CREATE INDEX " + '"' + provisioningConstraintName(physical.table, "ix", "tenant_id_category_priority") + '"' +
      " ON " + '"' + compileProvisioningContract(m, scope).namespace + '"."' + physical.table + '"' +
      ' ("tenant_id", "category", "priority")',
    );
  });

  it("makes declaration order irrelevant to canonical identity", () => {
    const one = manifest({ uniques: [["category", "slug"], ["status", "priority"]], indexes: [["status", "slug"], ["category", "priority"]] });
    const two = manifest({ uniques: [["status", "priority"], ["category", "slug"]], indexes: [["category", "priority"], ["status", "slug"]] });
    expect(two.digest).toBe(one.digest);
    expect(JSON.stringify(two.canonicalIr)).toBe(JSON.stringify(one.canonicalIr));
  });

  it("keeps application-owned declarations unscoped", () => {
    const m = createSchemaManifest(compileResourceSchema([resource({ uniques: [["slug"]], indexes: [["priority", "slug"]] }, "application")], scope));
    const physical = compileProvisioningContract(m, scope).resources[0]!;
    expect(physical.uniques).toEqual([["slug"]]);
    expect(physical.indexes).toEqual([["priority", "slug"]]);
  });

  it("refuses declarations that cannot be enforced or indexed", () => {
    refuse({ uniques: [["missing"]] });
    refuse({ indexes: [["category", "category"]] });
    refuse({ uniques: [["category", "slug"], ["category", "slug"]] });
    refuse({ indexes: [["category", "priority"], ["category", "priority"]] });
    refuse({ uniques: [[] as unknown as string[]] });
    refuse({ indexes: [["category", "priority", "slug", "status", "code"]] });
    refuse({ uniques: [["code"]] });
    const json: FieldDefinition = { id: "metadata", type: "json", required: false, maxBytes: 512, maxDepth: 4, maxKeys: 16 };
    refuse({ fields: [...fields, json], indexes: [["category", "metadata"]] });
    refuse({ fields: [...fields, json], uniques: [["metadata"]] });
    const money: FieldDefinition = { id: "total", type: "money", required: false, precision: 12, scale: 2 };
    refuse({ fields: [...fields, money], indexes: [["total"]] });
  });

  it("refuses changing declared constraints on an installed revision", () => {
    const before = manifest();
    expect(() => compileProvisioningTransition(null, before, scope)).not.toThrow();
    const proposed = manifest({ indexes: [["category", "priority"]] });
    expect(() => compileProvisioningTransition(before, proposed, scope)).toThrow("PROVISIONING_DESTRUCTIVE_REFUSED");
  });
});
