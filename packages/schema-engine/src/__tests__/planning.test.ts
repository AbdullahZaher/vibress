import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  canonicalSchemaDigest,
  compileResourceSchema,
  parseResourceDefinition,
  ResourceSchemaError,
  type CanonicalSchemaIR,
  type SchemaCompilationScope,
} from "../schema";
import {
  createSchemaManifest,
  parseSchemaManifest,
  planSchemaChanges,
  SchemaPlanningError,
  SCHEMA_MANIFEST_VERSION,
  type SchemaChangePlan,
  type SchemaManifest,
} from "../planning";
import {
  crmCustomers,
  crmDeals,
  crmPlanningExample,
  crmScope,
} from "../fixtures/crm";

function compile(resources = [crmCustomers(), crmDeals()]): CanonicalSchemaIR {
  return compileResourceSchema(resources, crmScope);
}

function accepted() {
  const ir = compile();
  return { ir, manifest: createSchemaManifest(ir) };
}

function plan(current: SchemaManifest | null, next: CanonicalSchemaIR): SchemaChangePlan {
  return planSchemaChanges(current, next, {
    expectedCurrentDigest: current?.digest ?? null,
    scope: crmScope,
  });
}

describe("M03-S02 canonical PostgreSQL 16 schema manifest", () => {
  it("round-trips versioned, deterministic, scoped manifests and public contracts", () => {
    const a: SchemaManifest = createSchemaManifest(compile());
    const b = createSchemaManifest(compile([crmDeals(), crmCustomers()]));
    expect(a.manifestVersion).toBe(SCHEMA_MANIFEST_VERSION);
    expect(a.schemaVersion).toBe(1);
    expect(a.applicationId).toBe(crmScope.applicationId);
    expect(a.installationId).toBe(crmScope.installationId);
    expect(a.canonicalIrDigest).toBe(canonicalSchemaDigest(a.canonicalIr));
    expect(a.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(parseSchemaManifest(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(a.resources.map((resource) => resource.id)).toEqual(["customers", "deals"]);
    expect(a.resources[0]?.securityPrerequisite).toBe("TENANT_RLS_AND_ACL");
    expect(a.resources[0]?.tableName).toMatch(/^vr_[a-z0-9_]+_[a-f0-9]{12}$/);
    expect(a.resources[0]?.fields.find((field) => field.id === "name"))
      .toMatchObject({ postgresType: "text", mappingStatus: "MAPPED" });
  });

  it("rejects schema versions, forged checksums, physical mapping and noncanonical order", () => {
    const { manifest } = accepted();
    for (const changed of [
      { ...manifest, manifestVersion: 2 },
      { ...manifest, schemaVersion: 2 },
    ]) {
      expect(() => parseSchemaManifest(changed)).toThrow(/version/);
    }
    expect(() => parseSchemaManifest({ ...manifest, digest: "0".repeat(64) }))
      .toThrow(/checksum/);
    expect(() => parseSchemaManifest({ ...manifest, applicationId: "foreign-app" }))
      .toThrow(SchemaPlanningError);
    expect(() => parseSchemaManifest({ ...manifest, resources: [...manifest.resources].reverse() }))
      .toThrow(SchemaPlanningError);
    expect(() => parseSchemaManifest({ ...manifest, sql: "DROP TABLE customers" }))
      .toThrow(SchemaPlanningError);
    const forged = {
      ...manifest,
      resources: manifest.resources.map((resource) =>
        resource.id === "customers" ? { ...resource, tableName: "public_users" } : resource),
    };
    expect(() => parseSchemaManifest(forged)).toThrow(SchemaPlanningError);
  });

  it("rejects prototype pollution, accessor/symbol/hidden fields and oversized input", () => {
    const { manifest } = accepted();
    expect(() => parseSchemaManifest(JSON.parse(
      '{"__proto__":{"isAdmin":true},"manifestVersion":1}',
    ))).toThrow(SchemaPlanningError);
    const extra = { ...manifest, [Symbol("sql")]: "DROP TABLE x" };
    expect(() => parseSchemaManifest(extra)).toThrow(SchemaPlanningError);
    const hidden = { ...manifest };
    Object.defineProperty(hidden, "danger", { value: "DROP TABLE x", enumerable: false });
    expect(() => parseSchemaManifest(hidden)).toThrow(SchemaPlanningError);
    const accessor = { ...manifest };
    Object.defineProperty(accessor, "digest", { get() { throw new Error("getter invoked"); } });
    expect(() => parseSchemaManifest(accessor)).toThrow(SchemaPlanningError);
    expect(() => parseSchemaManifest({ ...manifest, garbage: "x".repeat(9000) }))
      .toThrow(SchemaPlanningError);
    const array = Array.from({ length: 129 }, () => manifest.resources[0]);
    expect(() => parseSchemaManifest({ ...manifest, resources: array }))
      .toThrow(SchemaPlanningError);
  });

  it("hardens the existing DSL against symbol, nonenumerable and accessor properties", () => {
    const source = crmCustomers();
    expect(() => parseResourceDefinition({ ...source, [Symbol("sql")]: "DROP" }))
      .toThrow(/unsupported property/);
    const field = { id: "name", type: "text", required: true };
    Object.defineProperty(field, "required", { value: true, enumerable: false });
    expect(() => parseResourceDefinition({ ...source, fields: [field] }))
      .toThrow(/hidden or accessor/);
    const accessor = { ...source };
    Object.defineProperty(accessor, "ownership", { get() { throw new Error("getter called"); } });
    expect(() => parseResourceDefinition(accessor)).toThrow(/hidden or accessor/);
    let reads = 0;
    const accessorField = { id: "name", type: "text", required: true };
    Object.defineProperty(accessorField, "id", {
      enumerable: true,
      get() { reads++; return "name"; },
    });
    expect(() => parseResourceDefinition({ ...source, fields: [accessorField] }))
      .toThrow(/hidden or accessor/);
    expect(reads).toBe(0);
  });
});

describe("M03-S02 deterministic non-executing change planning", () => {
  it("rejects hostile IR accessors before invocation", () => {
    const ir = compile();
    const customer = ir.resources.find((resource) => resource.id === "customers");
    if (!customer) throw new Error("missing fixture customer");
    const first = customer.fields[0];
    if (!first) throw new Error("missing fixture field");
    const poison = { ...first };
    let calls = 0;
    Object.defineProperty(poison, "required", {
      enumerable: true,
      get() { calls++; return false; },
    });
    const hostile = {
      ...ir,
      resources: ir.resources.map((resource) =>
        resource.id === "customers" ? {
          ...resource, fields: [poison, ...resource.fields.slice(1)],
        } : resource),
    };
    expect(() => planSchemaChanges(null, hostile, {
      scope: crmScope, expectedCurrentDigest: null,
    })).toThrow(SchemaPlanningError);
    expect(calls).toBe(0);
  });

  it("produces explicit review-required CREATE_RESOURCE and stable operation IDs", () => {
    const first: SchemaChangePlan = plan(null, compile());
    const reversed = plan(null, compile([crmDeals(), crmCustomers()]));
    expect(first.disposition).toBe("REVIEW_REQUIRED");
    expect(first.operations.map((change) => change.type)).toEqual([
      "CREATE_RESOURCE", "CREATE_RESOURCE",
    ]);
    expect(first.operations.every((change) =>
      change.status === "REQUIRES_REVIEW" &&
      change.approval === "INDEPENDENT_REVIEW")).toBe(true);
    expect(first.preconditions.expectedCurrentDigest).toBeNull();
    expect(first.preconditions.verifyLiveDatabaseDrift).toBe(true);
    expect(first.preconditions.verifyInstallationAndPrivileges).toBe(true);
    expect(first.preconditions.requireOperatorAuthorization).toBe(true);
    expect(first.postgresVersion).toBe(16);
    expect(JSON.stringify(first)).toBe(JSON.stringify(reversed));
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.operations[0]?.id).toMatch(/^op_[a-f0-9]{24}$/);
  });

  it("no-ops an accepted manifest and plans only the optional scalar addition", () => {
    const { ir, manifest } = accepted();
    const unchanged = plan(manifest, ir);
    expect(unchanged.disposition).toBe("NO_CHANGES");
    expect(unchanged.operations).toEqual([]);
    const next = compile([crmCustomers(true), crmDeals()]);
    const planned = plan(manifest, next);
    expect(planned.disposition).toBe("PLANNED");
    expect(planned.operations).toHaveLength(1);
    expect(planned.operations[0]).toMatchObject({
      type: "ADD_FIELD", resourceId: "customers", fieldId: "website",
      expected: null, status: "PLANNED", risk: "LOW",
      approval: "OPERATOR", compatibility: "ADDITIVE",
    });
    expect(planned.operations[0]?.proposed).toMatchObject({
      postgresType: "text", required: false,
    });
    expect(plan(manifest, next).digest).toBe(planned.digest);
  });

  it("runs the standalone CRM initial and expanded-resource reference fixture", () => {
    const example = crmPlanningExample();
    expect(example.initialPlan.disposition).toBe("REVIEW_REQUIRED");
    expect(example.additivePlan.operations.map((change) =>
      [change.resourceId, change.type, change.fieldId])).toEqual([
      ["activities", "CREATE_RESOURCE", null],
      ["customers", "ADD_FIELD", "website"],
    ]);
    expect(example.additivePlan.disposition).toBe("REVIEW_REQUIRED");
  });

  it("explicitly DENIES removals, type changes and ownership changes", () => {
    const { manifest } = accepted();
    const removedField = compileResourceSchema([
      { ...crmCustomers(), fields: [{ id: "name", type: "text", required: true }] },
      crmDeals(),
    ], crmScope);
    const fieldPlan = plan(manifest, removedField);
    expect(fieldPlan.disposition).toBe("BLOCKED");
    expect(fieldPlan.operations).toContainEqual(expect.objectContaining({
      type: "REMOVE_FIELD", fieldId: "active", status: "DENIED",
      compatibility: "BREAKING",
    }));
    expect(plan(manifest, compile([crmCustomers()])).operations).toContainEqual(
      expect.objectContaining({ type: "REMOVE_RESOURCE", status: "DENIED" }),
    );
    const changedType = compileResourceSchema([
      { ...crmCustomers(), fields: [
        { id: "name", type: "number", required: true },
        { id: "active", type: "boolean", required: false },
      ] },
      crmDeals(),
    ], crmScope);
    expect(plan(manifest, changedType).operations).toContainEqual(
      expect.objectContaining({ type: "ALTER_FIELD", fieldId: "name", status: "DENIED" }),
    );
    const changedOwnership = compileResourceSchema([
      { ...crmCustomers(), ownership: "application" }, crmDeals(),
    ], crmScope);
    expect(plan(manifest, changedOwnership).operations).toContainEqual(
      expect.objectContaining({ type: "ALTER_OWNERSHIP", status: "DENIED" }),
    );
  });

  it("classifies defaults, required fields and enum constraints as requiring review", () => {
    const { manifest } = accepted();
    const proposed = compileResourceSchema([
      { ...crmCustomers(), fields: [
        ...crmCustomers().fields,
        { id: "phone", type: "text", required: true },
        { id: "timezone", type: "text", required: false, default: "UTC" },
        { id: "stage", type: "enum", required: false, values: ["lead", "won"] },
      ] },
      crmDeals(),
    ], crmScope);
    const changes = plan(manifest, proposed).operations;
    expect(changes).toHaveLength(3);
    expect(changes.every((change) => change.status === "REQUIRES_REVIEW")).toBe(true);
    expect(changes.find((change) => change.fieldId === "stage")?.proposed)
      .toMatchObject({ mappingStatus: "REQUIRES_REVIEW" });
  });

  it("blocks unknown relation storage and invalid cross-installation edges", () => {
    const { manifest } = accepted();
    const relational = compileResourceSchema([
      crmCustomers(),
      { ...crmDeals(), fields: [
        ...crmDeals().fields,
        { id: "customer", type: "relation", required: false, targetResource: "customers" },
      ] },
    ], crmScope);
    expect(plan(manifest, relational).operations).toContainEqual(
      expect.objectContaining({ type: "ADD_FIELD", fieldId: "customer", status: "UNSUPPORTED" }),
    );
    expect(() => compileResourceSchema([
      crmCustomers(), { ...crmDeals(), installationId: asInstallationId("other-install") },
    ], crmScope)).toThrow(/another application or installation/);
    try {
      parseResourceDefinition({
        ...crmDeals(),
        fields: [{
          id: "customer", type: "relation", required: false,
          targetResource: "customers", targetInstallationId: "other-install",
        }],
      });
      throw new Error("expected unsupported relation property rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceSchemaError);
      if (!(error instanceof ResourceSchemaError)) throw error;
      expect(error.code).toBe("UNSAFE_DEFINITION");
    }
    expect(() => planSchemaChanges(createSchemaManifest(relational), relational, {
      expectedCurrentDigest: createSchemaManifest(relational).digest,
      scope: crmScope,
    })).toThrow(/unmapped physical storage/);
  });

  it("rejects stale digests, absent manifest conflicts and crossed identities", () => {
    const { ir, manifest } = accepted();
    expect(() => planSchemaChanges(manifest, ir, {
      scope: crmScope, expectedCurrentDigest: "0".repeat(64),
    })).toThrow(/stale/);
    expect(() => planSchemaChanges(null, ir, {
      scope: crmScope, expectedCurrentDigest: manifest.digest,
    })).toThrow(/stale/);
    const foreignScope: SchemaCompilationScope = {
      applicationId: asApplicationId("other-app"),
      installationId: asInstallationId("other-install"),
    };
    expect(() => planSchemaChanges(manifest, ir, {
      scope: foreignScope, expectedCurrentDigest: manifest.digest,
    })).toThrow(/mismatch/);
    const foreignIr = compileResourceSchema([
      { ...crmCustomers(), ...foreignScope },
    ], foreignScope);
    expect(() => planSchemaChanges(null, foreignIr, {
      scope: crmScope, expectedCurrentDigest: null,
    })).toThrow(/mismatch/);
    expect(() => planSchemaChanges(manifest, { ...ir, schemaVersion: 99 }, {
      scope: crmScope, expectedCurrentDigest: manifest.digest,
    })).toThrow(/version/);
  });

  it("rejects SQL-like identifiers/expressions but treats bounded text literals as data", () => {
    expect(() => parseResourceDefinition({
      ...crmCustomers(), id: "customers;DROP TABLE users",
    })).toThrow();
    expect(() => parseResourceDefinition({
      ...crmCustomers(), fields: [
        { id: "created", type: "datetime", required: false, default: "now()" },
      ],
    })).toThrow();
    const safeLiteral = compileResourceSchema([
      { ...crmCustomers(), fields: [
        ...crmCustomers().fields,
        { id: "notes", type: "text", required: false, default: "'); DROP TABLE users; --" },
      ] },
    ], crmScope);
    const planForLiteral = plan(null, safeLiteral);
    expect(planForLiteral.operations[0]?.status).toBe("REQUIRES_REVIEW");
    expect(JSON.stringify(planForLiteral)).toContain("DROP TABLE users");
    expect(JSON.stringify(planForLiteral)).not.toContain("CREATE TABLE");
  });

  it("rejects malformed options with extra properties and accepts reordered own keys", () => {
    const ir = compile();
    expect(() => planSchemaChanges(null, ir, {
      scope: crmScope, expectedCurrentDigest: null,
    })).not.toThrow();
    const extraOptions = { expectedCurrentDigest: null, scope: crmScope, sql: "DROP TABLE" };
    expect(() => planSchemaChanges(null, ir, extraOptions)).toThrow(SchemaPlanningError);
    const protoOptions = JSON.parse(
      '{"expectedCurrentDigest":null,"scope":{"applicationId":"customer-crm","installationId":"crm-local"},"__proto__":{"elevated":true}}',
    );
    expect(() => planSchemaChanges(null, ir, protoOptions)).toThrow(SchemaPlanningError);
  });
});


describe("AG06-S02-02 physical name and canonical manifest compatibility", () => {
  it("retains deterministic 61-byte table hints for different 63-byte names with a shared prefix", () => {
    const first = "a" + "n".repeat(61) + "x";
    const second = "a" + "n".repeat(61) + "y";
    const resources = [
      { ...crmCustomers(), id: first },
      { ...crmDeals(), id: second },
    ];
    const ir = compileResourceSchema(resources, crmScope);
    const reversedIr = compileResourceSchema([...resources].reverse(), crmScope);
    const before = createSchemaManifest(ir);
    const again = createSchemaManifest(reversedIr);
    expect(JSON.stringify(before)).toBe(JSON.stringify(again));
    expect(before.digest).toBe(again.digest);
    expect(before.canonicalIrDigest).toBe(canonicalSchemaDigest(ir));
    expect(before.manifestVersion).toBe(1);
    expect(before.schemaVersion).toBe(1);
    expect(before.applicationId).toBe(crmScope.applicationId);
    expect(before.installationId).toBe(crmScope.installationId);
    const names = before.resources.map((resource) => resource.tableName);
    expect(new Set(names).size).toBe(2);
    for (const name of names) {
      expect(name).toMatch(/^vr_[a-z0-9_]+_[a-f0-9]{12}$/);
      expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(63);
      expect(name.length).toBe(61);
    }
    expect(JSON.stringify(parseSchemaManifest(JSON.parse(JSON.stringify(before)))))
      .toBe(JSON.stringify(before));
    const planA = planSchemaChanges(null, ir, {
      scope: crmScope, expectedCurrentDigest: null,
    });
    const planB = planSchemaChanges(null, reversedIr, {
      scope: crmScope, expectedCurrentDigest: null,
    });
    expect(planA.digest).toBe(planB.digest);
    expect(JSON.stringify(planA)).toBe(JSON.stringify(planB));
  });

  it("keeps ordinary CRM manifests deterministic without any SQL/DDL output", () => {
    const left = createSchemaManifest(compile([crmCustomers(), crmDeals()]));
    const right = createSchemaManifest(compile([crmDeals(), crmCustomers()]));
    expect(left).toEqual(right);
    expect(left.digest).toBe(right.digest);
    expect(left.resources.every((resource) =>
      !/[; "']/.test(resource.tableName) && !resource.tableName.includes("\\u0000")))
      .toBe(true);
    const plan = planSchemaChanges(null, compile(), {
      scope: crmScope, expectedCurrentDigest: null,
    });
    expect(plan.proposedManifest.digest).toBe(left.digest);
    expect(JSON.stringify(plan)).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE|GRANT /);
  });
});
