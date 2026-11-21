import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileResourceSchema,
  parseCanonicalSchemaIR,
  ResourceSchemaError,
  type ResourceDefinition,
} from "../schema";
import { createSchemaManifest, parseSchemaManifest, planSchemaChanges } from "../planning";
import {
  compileProvisioningContract,
  provisioningProfileFor,
  PROVISIONING_PROFILE_V3,
} from "../physical-contract";
import {
  DYNAMIC_RECORD_ENFORCEMENT,
  DYNAMIC_RECORD_QUERY_POLICY,
  assertDynamicRecordQuery,
  dynamicRecordRevision,
  validateDynamicRecord,
  type DynamicRecordProfile,
} from "../dynamic-record";

const scope = {
  applicationId: asApplicationId("dynamic-records"),
  installationId: asInstallationId("installation-dynamic"),
};

const profile: DynamicRecordProfile = {
  fields: [
    { id: "title", type: "text", required: true, maxLength: 120 },
    { id: "body", type: "text", required: false },
    { id: "pinned", type: "boolean", required: false },
    { id: "weight", type: "integer", required: false },
    { id: "extra", type: "json", required: false },
  ],
  maxBytes: 2048,
  maxDepth: 3,
  maxKeys: 12,
  maxRecordsPerTenant: 5,
};

const canonicalProfile: DynamicRecordProfile = {
  ...profile,
  fields: [...profile.fields].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
};

function notes(overrides: Partial<DynamicRecordProfile> = {}): ResourceDefinition {
  return { ...scope, id: "notes", ownership: "tenant", fields: [], dynamic: { ...profile, ...overrides } };
}

function manifestOf(profileOverrides: Partial<DynamicRecordProfile> = {}) {
  return createSchemaManifest(compileResourceSchema([notes(profileOverrides)], scope));
}

function refuse(action: () => unknown) {
  return expect(action).toThrow(ResourceSchemaError);
}

describe("dynamic record canonical profile", () => {
  it("round-trips deterministically and exposes only the declared profile", () => {
    const manifest = manifestOf();
    const parsed = parseSchemaManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.digest).toBe(manifest.digest);
    expect(manifestOf().digest).toBe(manifest.digest);
    expect(manifest.resources[0]).toMatchObject({ id: "notes", ownership: "tenant", fields: [] });
    expect(manifest.resources[0]!.dynamic).toEqual(canonicalProfile);
    expect(manifest.resources[0]!.dynamic!.fields.map((field) => field.id)).toEqual([
      "body", "extra", "pinned", "title", "weight",
    ]);
    const canonical = parseCanonicalSchemaIR(JSON.parse(JSON.stringify(manifest.canonicalIr)));
    expect(canonical.resources[0]!.dynamic).toEqual(canonicalProfile);
    expect(provisioningProfileFor(manifest)).toBe(PROVISIONING_PROFILE_V3);
  });

  it("refuses mixing typed columns with a dynamic profile and malformed budgets", () => {
    refuse(() => createSchemaManifest(compileResourceSchema([{ ...notes(), fields: [{ id: "code", type: "text", required: true }] }], scope)));
    refuse(() => manifestOf({ maxBytes: 0 }));
    refuse(() => manifestOf({ maxBytes: 1_000_000 }));
    refuse(() => manifestOf({ maxDepth: 0 }));
    refuse(() => manifestOf({ maxDepth: 33 }));
    refuse(() => manifestOf({ maxKeys: 0 }));
    refuse(() => manifestOf({ maxKeys: 10_001 }));
    refuse(() => manifestOf({ maxRecordsPerTenant: 0 }));
    refuse(() => manifestOf({ fields: [] }));
    refuse(() => manifestOf({ fields: [...profile.fields, profile.fields[0]!] }));
    refuse(() => manifestOf({ fields: [{ id: "title", type: "text", required: true, maxLength: 0 }] }));
    refuse(() => manifestOf({ fields: [{ id: "title", type: "relation", required: true } as never] }));
  });

  it("reaches a deterministic physical table with only database-enforceable checks", () => {
    const manifest = manifestOf();
    const physical = compileProvisioningContract(manifest, scope);
    expect(physical.profile).toBe(PROVISIONING_PROFILE_V3);
    expect(physical.resources[0]!.table).toBe(manifest.resources[0]!.tableName);
    expect(physical.resources[0]!.columns).toEqual([
      { name: "tenant_id", type: "text", required: true },
      { name: "id", type: "uuid", required: true },
      { name: "revision", type: "text", required: true },
      { name: "version_token", type: "uuid", required: true },
      { name: "payload", type: "jsonb", required: true },
      { name: "deleted_on", type: "timestamp with time zone", required: false },
    ]);
    expect(physical.resources[0]!.key).toEqual(["tenant_id", "id"]);
    expect(physical.resources[0]!.unique).toEqual([]);
    expect(physical.resources[0]!.relations).toEqual([]);
    const revision = dynamicRecordRevision(profile);
    const expressions = (physical.resources[0]!.checks ?? []).map((check) => check.normalized);
    expect(expressions).toEqual([
      "((jsonb_typeof(payload) = 'object'::text) AND (pg_column_size(payload) <= 2048))",
      "(revision = '" + revision + "'::text)",
    ]);
    expect(compileProvisioningContract(manifest, scope).digest).toBe(physical.digest);
    expect(dynamicRecordRevision({ ...profile, maxRecordsPerTenant: 6 })).not.toBe(revision);
    expect(dynamicRecordRevision(canonicalProfile)).toBe(revision);
  });

  it("refuses in-place profile evolution instead of returning a no-change plan", () => {
    const before = manifestOf();
    const after = manifestOf({ maxBytes: 4096 });
    const plan = planSchemaChanges(before, after.canonicalIr, { scope, expectedCurrentDigest: before.digest });
    expect(plan.disposition).toBe("BLOCKED");
    expect(plan.operations).toContainEqual(expect.objectContaining({
      type: "ALTER_DYNAMIC_PROFILE",
      resourceId: "notes",
      status: "DENIED",
      compatibility: "BREAKING",
    }));
  });
});

describe("dynamic record trusted-write validation", () => {
  it("returns canonical bytes and revision evidence for a valid record", () => {
    expect(DYNAMIC_RECORD_ENFORCEMENT).toEqual({
      shape: "POSTGRES_CHECK",
      bytes: "POSTGRES_CHECK_AND_APPLICATION",
      fields: "APPLICATION",
      types: "APPLICATION",
      depth: "APPLICATION",
      keys: "APPLICATION",
      recordCount: "APPLICATION_TRANSACTION",
    });
    const result = validateDynamicRecord(profile, {
      weight: 4,
      title: "Note",
      extra: { b: [true, null, "x"], a: 1 },
    });
    expect(result.canonical).toBe('{"extra":{"a":1,"b":[true,null,"x"]},"title":"Note","weight":4}');
    expect(result.revision).toBe(dynamicRecordRevision(profile));
    expect(result.bytes).toBe(Buffer.byteLength(result.canonical, "utf8"));
    expect(result.keys).toBe(5);
  });

  it("refuses unknown, mistyped, missing, deep and oversized payloads", () => {
    const bad = (value: unknown) => expect(() => validateDynamicRecord(profile, value)).toThrow(/DYNAMIC_RECORD_REFUSED/);
    bad({ title: "ok", undeclared: 1 });
    bad({ title: "ok", weight: 1.5 });
    bad({ title: "ok", weight: 2 ** 31 });
    bad({ title: "ok", pinned: "true" });
    bad({ title: "ok", extra: Number.NaN });
    bad({ title: "ok", body: "nul\u0000byte" });
    bad({ title: "x".repeat(121) });
    bad({ weight: 1 });
    bad({ title: "ok", extra: { a: { b: { c: { d: 1 } } } } });
    bad({ title: "ok", extra: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11 } });
    bad({ title: "ok", extra: new Date() });
    bad({ title: "ok", extra: { a: undefined } });
    bad({ title: "x".repeat(2048), extra: { a: "y".repeat(1024) } });
    const ok = validateDynamicRecord(profile, { title: "ok", extra: { a: { b: 1 } } });
    expect(ok.keys).toBe(4);
  });

  it("declares only primary-key access and refuses unsupported queries", () => {
    expect(DYNAMIC_RECORD_QUERY_POLICY).toEqual({
      getById: true,
      orderBy: ["id"],
      filters: [],
      indexes: "PRIMARY_KEY_ONLY",
      maxLimit: 100,
    });
    expect(() => assertDynamicRecordQuery({ limit: 10, order: "id" })).not.toThrow();
    expect(() => assertDynamicRecordQuery({ limit: 10 })).not.toThrow();
    for (const query of [
      { limit: 10, order: "payload" },
      { limit: 10, filter: { title: "x" } },
      { limit: 0 },
      { limit: 101 },
      { limit: 10, offset: 5 },
    ]) {
      expect(() => assertDynamicRecordQuery(query as never)).toThrow(/DYNAMIC_RECORD_QUERY_REFUSED/);
    }
  });
});
