import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  CANONICAL_SCHEMA_VERSION,
  ResourceSchemaError,
  canonicalSchemaDigest,
  compileResourceSchema,
  defineResource,
  parseCanonicalSchemaIR,
  parseResourceDefinition,
  serializeCanonicalSchemaIR,
  type ResourceDefinition,
} from "../schema";

const scope = {
  applicationId: asApplicationId("customer-crm"),
  installationId: asInstallationId("crm-local"),
};

function customers(): ResourceDefinition {
  return defineResource({
    id: "customers",
    ...scope,
    ownership: "tenant",
    fields: [
      { id: "status", type: "enum", required: true, values: ["lead", "active"], default: "lead" },
      { id: "name", type: "text", required: true },
      { id: "lifetime_value", type: "number", required: false, default: 0 },
      { id: "is_verified", type: "boolean", required: false, default: false },
      { id: "contacted_at", type: "datetime", required: false, default: "2026-11-16T00:00:00Z" },
    ],
  });
}

function deals(): ResourceDefinition {
  return defineResource({
    id: "deals",
    ...scope,
    ownership: "tenant",
    fields: [
      { id: "customer", type: "relation", required: true, targetResource: "customers" },
      { id: "amount", type: "number", required: true },
      { id: "won", type: "boolean", required: false },
    ],
  });
}

describe("M03-S01 canonical schema compiler", () => {
  it("compiles CRM resources into a versioned, frozen, publishing-independent IR", () => {
    const ir = compileResourceSchema([deals(), customers()], scope);
    expect(ir.schemaVersion).toBe(CANONICAL_SCHEMA_VERSION);
    expect(ir.applicationId).toBe("customer-crm");
    expect(ir.installationId).toBe("crm-local");
    expect(ir.resources.map((resource) => resource.id)).toEqual(["customers", "deals"]);
    expect(ir.resources[0]?.fields.map((field) => field.id)).toEqual([
      "contacted_at", "is_verified", "lifetime_value", "name", "status",
    ]);
    expect(ir.resources[0]?.fields[0]).toMatchObject({
      type: "datetime", default: "2026-11-16T00:00:00.000Z",
    });
    expect(ir.resources[0]?.fields[4]).toMatchObject({
      values: ["active", "lead"], default: "lead",
    });
    expect(ir.resources[1]?.fields[1]).toMatchObject({
      id: "customer", type: "relation", targetResource: "customers",
    });
    expect(Object.isFrozen(ir.resources[0]?.fields)).toBe(true);
    expect(JSON.stringify(ir)).not.toContain("publication");
  });

  it("produces identical bytes and digest regardless of declaration ordering", () => {
    const a = compileResourceSchema([customers(), deals()], scope);
    const shuffled = defineResource({
      ...customers(),
      fields: [...customers().fields].reverse(),
    });
    const b = compileResourceSchema([deals(), shuffled], scope);
    expect(serializeCanonicalSchemaIR(a)).toBe(serializeCanonicalSchemaIR(b));
    expect(canonicalSchemaDigest(a)).toBe(canonicalSchemaDigest(b));
    expect(canonicalSchemaDigest(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips JSON and rejects noncanonical persisted IR", () => {
    const ir = compileResourceSchema([customers(), deals()], scope);
    expect(parseCanonicalSchemaIR(JSON.parse(serializeCanonicalSchemaIR(ir)))).toEqual(ir);
    expect(() => parseCanonicalSchemaIR({ ...ir, schemaVersion: 42 })).toThrow(ResourceSchemaError);
    expect(() => parseCanonicalSchemaIR({ ...ir, sql: "DROP TABLE customers" })).toThrow(ResourceSchemaError);
    expect(() => parseCanonicalSchemaIR({
      ...ir, resources: [...ir.resources].reverse(),
    })).toThrow(/canonical/);
  });

  it("rejects malformed, reserved and SQL-injection identifiers", () => {
    for (const id of ["bad-name", "users; DROP TABLE users", "select", "pg_catalog", "Vendors", "bad__name"]) {
      expect(() => parseResourceDefinition({ ...customers(), id })).toThrow(ResourceSchemaError);
    }
    expect(() => parseResourceDefinition({ ...customers(), fields: [
      { id: "tenant_id", type: "text", required: true },
    ] })).toThrow(/identifier/);
    expect(() => parseResourceDefinition({ ...customers(), applicationId: "pub_default" }))
      .toThrow(ResourceSchemaError);
  });

  it("rejects duplicate resource, field and enum identifiers", () => {
    expect(() => compileResourceSchema([customers(), customers()], scope)).toThrow(/duplicate resource/);
    expect(() => parseResourceDefinition({
      ...customers(), fields: [
        { id: "name", type: "text", required: true },
        { id: "name", type: "text", required: false },
      ],
    })).toThrow(/duplicate field/);
    expect(() => parseResourceDefinition({
      ...customers(), fields: [
        { id: "stage", type: "enum", required: true, values: ["new", "new"] },
      ],
    })).toThrow(/duplicate enum/);
  });

  it("fails closed for expressions, unknown keys and unsupported types", () => {
    for (const field of [
      { id: "name", type: "text", required: false, defaultSql: "current_user" },
      { id: "price", type: "number", required: false, default: { sql: "1+1" } },
      { id: "date", type: "datetime", required: true, default: "NOW()" },
      { id: "secret", type: "json", required: true },
      { id: "invalid", type: "boolean", required: true, default: "true" },
      { id: "bad", type: "relation", required: true, targetResource: "customers", onDelete: "CASCADE" },
      { id: "price", type: "number", required: true, default: Infinity },
    ]) {
      expect(() => parseResourceDefinition({ ...customers(), fields: [field] })).toThrow(ResourceSchemaError);
    }
    expect(() => parseResourceDefinition({
      ...customers(), fields: [{ id: "name", type: "text", required: false, default: undefined }],
    })).toThrow(ResourceSchemaError);
    expect(() => parseResourceDefinition({
      ...customers(), fields: [{ id: "stage", type: "enum", required: true, values: ["lead"], default: "won" }],
    })).toThrow(ResourceSchemaError);
    expect(() => parseResourceDefinition({ ...customers(), rawSql: "DROP TABLE x" }))
      .toThrow(ResourceSchemaError);
  });

  it("rejects non-boolean required flags and invalid resource ownership", () => {
    expect(() => parseResourceDefinition({
      ...customers(), fields: [{ id: "name", type: "text", required: "yes" }],
    })).toThrow(ResourceSchemaError);
    expect(() => parseResourceDefinition({ ...customers(), ownership: "publication" }))
      .toThrow(ResourceSchemaError);
  });

  it("reports typed boundary errors with the offending resource path", () => {
    try {
      compileResourceSchema([
        { ...customers(), installationId: asInstallationId("foreign-installation") },
      ], scope);
      throw new Error("expected boundary rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceSchemaError);
      if (!(error instanceof ResourceSchemaError)) throw error;
      expect(error.code).toBe("BOUNDARY_VIOLATION");
      expect(error.path).toBe("resources.customers");
    }
  });

  it("blocks resource declarations outside the authoritative installation or app", () => {
    expect(() => compileResourceSchema([
      customers(), { ...deals(), installationId: asInstallationId("other-installation") },
    ], scope)).toThrow(/another application or installation/);
    expect(() => compileResourceSchema([
      { ...customers(), applicationId: asApplicationId("other-app") },
    ], scope)).toThrow(/another application or installation/);
  });

  it("blocks unresolved, self and cross-ownership relations", () => {
    expect(() => compileResourceSchema([deals()], scope)).toThrow(/relation/);
    expect(() => compileResourceSchema([
      { ...deals(), fields: [
        { id: "parent", type: "relation", required: false, targetResource: "deals" },
      ] },
    ], scope)).toThrow(/relation/);
    expect(() => compileResourceSchema([
      customers(),
      { ...deals(), ownership: "application" },
    ], scope)).toThrow(/relation/);
    expect(() => parseResourceDefinition({
      ...deals(), fields: [
        { id: "customer", type: "relation", required: true, targetResource: "users", targetInstallationId: "foreign" },
      ],
    })).toThrow(ResourceSchemaError);
  });

  it("keeps defaults literal, never an executable SQL expression", () => {
    const literal = defineResource({
      ...customers(), fields: [
        { id: "description", type: "text", required: false, default: "NOW(); DROP TABLE clients;" },
      ],
    });
    const ir = compileResourceSchema([literal], scope);
    expect(ir.resources[0]?.fields[0]).toMatchObject({
      default: "NOW(); DROP TABLE clients;",
    });
    expect(() => parseResourceDefinition({
      ...customers(), fields: [{ id: "event_time", type: "datetime", required: true, default: "now()" }],
    })).toThrow(ResourceSchemaError);
  });
});
