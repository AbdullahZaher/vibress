import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  compileProvisioningContract,
  compileResourceSchema,
  createSchemaManifest,
  enforceBoundedJson,
  JSON_BOUND_ENFORCEMENT,
  measureBoundedJson,
  type SchemaCompilationScope,
} from "..";

const scope: SchemaCompilationScope = {
  applicationId: asApplicationId("app-json"),
  installationId: asInstallationId("installation-json"),
};

function field(overrides: Partial<{ maxBytes: number; maxDepth: number; maxKeys: number }> = {}) {
  return { maxBytes: 1024, maxDepth: 8, maxKeys: 1000, ...overrides };
}

describe("bounded JSON trusted-write guard", () => {
  it("measures serialized bytes, container depth and total object keys", () => {
    const value = { url: "https://example.test/x.png", meta: { alt: "A", size: [1, 2] } };
    expect(measureBoundedJson(value)).toEqual({
      bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
      depth: 3,
      keys: 4,
    });
    expect(measureBoundedJson(null)).toEqual({ bytes: 4, depth: 0, keys: 0 });
  });

  it("accepts a value exactly at each bound and refuses one unit beyond", () => {
    const value = { a: 1 };
    const { bytes, depth, keys } = measureBoundedJson(value);
    expect(enforceBoundedJson(field({ maxBytes: bytes, maxDepth: depth, maxKeys: keys }), value)).toEqual({ bytes, depth, keys });
    expect(() => enforceBoundedJson(field({ maxBytes: bytes - 1 }), value)).toThrow("JSON_BOUND_REFUSED:BYTES");
    const nested = { a: { b: 1 } };
    expect(measureBoundedJson(nested).depth).toBe(2);
    expect(() => enforceBoundedJson(field({ maxDepth: 1 }), nested)).toThrow("JSON_BOUND_REFUSED:DEPTH");
    expect(() => enforceBoundedJson(field({ maxKeys: 1 }), { a: 1, b: 2 })).toThrow("JSON_BOUND_REFUSED:KEYS");
  });

  it("refuses values that JSON cannot represent faithfully", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const holey = Array(3);
    holey[0] = 1;
    holey[2] = 3;
    const withAccessor = Object.defineProperty({}, "x", { enumerable: true, get: () => 1 });
    for (const value of [
      undefined,
      () => 1,
      Symbol("s"),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(0),
      new Map(),
      new (class Point { x = 1 })(),
      cyclic,
      holey,
      withAccessor,
      { [Symbol("k")]: 1 },
    ]) {
      expect(() => measureBoundedJson(value), String(typeof value)).toThrow("JSON_BOUND_REFUSED:VALUE");
    }
  });

  it("refuses an invalid bound configuration", () => {
    for (const bad of [
      { maxBytes: 0 },
      { maxBytes: 1.5 },
      { maxBytes: 1024, maxDepth: 0 },
      { maxBytes: 1024, maxDepth: 33 },
      { maxBytes: 1024, maxKeys: 0 },
      { maxBytes: 1024, maxKeys: 10001 },
    ]) {
      expect(() => enforceBoundedJson(bad, {}), JSON.stringify(bad)).toThrow("JSON_BOUND_REFUSED:CONFIG");
    }
  });

  it("distinguishes PostgreSQL-enforced storage bytes from application-enforced depth and keys", () => {
    expect(JSON_BOUND_ENFORCEMENT).toEqual({
      bytes: "POSTGRES_CHECK_AND_APPLICATION",
      depth: "APPLICATION",
      keys: "APPLICATION",
    });
    const manifest = createSchemaManifest(
      compileResourceSchema(
        [{ ...scope, id: "documents", ownership: "tenant", fields: [{ id: "payload", type: "json", required: true, maxBytes: 512, maxDepth: 4, maxKeys: 16 }] }],
        scope,
      ),
    );
    const resource = compileProvisioningContract(manifest, scope).resources.find((r) => r.id === "documents");
    expect(resource?.columns).toContainEqual({ name: "payload", type: "jsonb", required: true });
    // Only the byte bound reaches PostgreSQL; depth/keys have no predicate and
    // no privileged validation routine exists.
    expect(resource?.checks).toHaveLength(1);
    expect(resource?.checks?.[0]?.expression).toContain("pg_column_size");
    expect(JSON.stringify(resource?.checks)).not.toMatch(/maxDepth|maxKeys|jsonb_path|depth/);
  });
});
