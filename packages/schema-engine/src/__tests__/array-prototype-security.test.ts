import { describe, expect, it } from "vitest";
import {
  canonicalSchemaDigest, compileResourceSchema, parseCanonicalSchemaIR,
  parseResourceDefinition, ResourceSchemaError,
} from "../schema";
import { createSchemaManifest, planSchemaChanges, SchemaPlanningError } from "../planning";
import { crmCustomers, crmScope } from "../fixtures/crm";

// AG06-S02-01: hostile in-process JS objects; JSON does not encode custom prototypes.
describe("AG06-S02-01: untrusted arrays never dispatch caller collection methods", () => {
  it("rejects an overridden resource-array map before any invocation", () => {
    let invoked = 0;
    class HostileArray<T> extends Array<T> {
      override map<U>(
        fn: (value: T, index: number, array: T[]) => U, thisArg?: unknown,
      ): U[] {
        invoked++;
        return super.map(fn, thisArg);
      }
    }
    const resources = new HostileArray(crmCustomers());
    expect(() => compileResourceSchema(resources, crmScope)).toThrow(ResourceSchemaError);
    expect(invoked).toBe(0);
    const ir = compileResourceSchema([crmCustomers()], crmScope);
    const hostile = { ...ir, resources: new HostileArray(...ir.resources) };
    expect(() => parseCanonicalSchemaIR(hostile)).toThrow(ResourceSchemaError);
    expect(() => createSchemaManifest(hostile)).toThrow(SchemaPlanningError);
    expect(() => planSchemaChanges(null, hostile, {
      scope: crmScope, expectedCurrentDigest: null,
    })).toThrow(SchemaPlanningError);
    expect(invoked).toBe(0);
  });

  it("rejects nested subclass fields and enum values without calling map", () => {
    let called = 0;
    class HostileArray<T> extends Array<T> {
      override map<U>(
        fn: (value: T, index: number, array: T[]) => U, thisArg?: unknown,
      ): U[] {
        called++;
        return super.map(fn, thisArg);
      }
    }
    const resource = crmCustomers();
    expect(() => parseResourceDefinition({
      ...resource, fields: new HostileArray(...resource.fields),
    })).toThrow(ResourceSchemaError);
    expect(() => parseResourceDefinition({
      ...resource,
      fields: [{ id: "stage", type: "enum", required: false,
        values: new HostileArray("lead", "won") }],
    })).toThrow(ResourceSchemaError);
    expect(called).toBe(0);
  });

  it("denies altered Array prototype chains, own map overrides and prototype gadgets", () => {
    const modified = [crmCustomers()];
    Object.setPrototypeOf(modified, {
      map() { throw new Error("attacker map invoked"); },
    });
    expect(() => compileResourceSchema(modified, crmScope)).toThrow(ResourceSchemaError);

    const own = [crmCustomers()];
    Object.defineProperty(own, "map", {
      enumerable: false, value: () => { throw new Error("attacker map invoked"); },
    });
    expect(() => compileResourceSchema(own, crmScope)).toThrow(ResourceSchemaError);

    const inherited = [crmCustomers()];
    const shadow = Object.create(Array.prototype) as object;
    Object.defineProperty(shadow, "map", { value: () => {
      throw new Error("attacker inherited map invoked");
    } });
    Object.setPrototypeOf(inherited, shadow);
    expect(() => compileResourceSchema(inherited, crmScope)).toThrow(ResourceSchemaError);
  });

  it("accepts regular nested arrays without changing canonical serialization", () => {
    const resource = crmCustomers();
    const a = compileResourceSchema([resource], crmScope);
    const b = compileResourceSchema([{
      ...resource, fields: [...resource.fields].reverse(),
    }], crmScope);
    expect(canonicalSchemaDigest(a)).toBe(canonicalSchemaDigest(b));
    expect(createSchemaManifest(a).digest).toBe(createSchemaManifest(b).digest);
    expect(parseResourceDefinition({ ...resource, fields: [...resource.fields] }))
      .toEqual(resource);
    expect(parseCanonicalSchemaIR(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("rejects non-enumerable, sparse, accessor and symbol array entries without getters", () => {
    const resource = crmCustomers();
    let reads = 0;
    const hidden = [resource];
    Object.defineProperty(hidden, "notes", { value: "shadow", enumerable: false });
    const accessor = [resource];
    Object.defineProperty(accessor, "0", {
      enumerable: true, configurable: true,
      get() { reads++; return resource; },
    });
    const symbol = [resource];
    Object.defineProperty(symbol, Symbol("payload"), { value: "shadow" });
    const sparse = new Array(1);
    for (const input of [hidden, accessor, symbol, sparse]) {
      expect(() => compileResourceSchema(input, crmScope)).toThrow(ResourceSchemaError);
    }
    expect(reads).toBe(0);
  });

  it("keeps own-key, descriptor, symbol and targetInstallationId negatives fail-closed", () => {
    const resource = crmCustomers();
    let getterCalls = 0;
    const hidden = { id: "name", type: "text", required: true };
    Object.defineProperty(hidden, "required", { value: true, enumerable: false });
    const accessor = { id: "name", type: "text", required: true };
    Object.defineProperty(accessor, "required", {
      enumerable: true, get() { getterCalls++; return true; },
    });
    const crossInstallation = {
      id: "customer", type: "relation", required: false,
      targetResource: "customers", targetInstallationId: "foreign-install",
    };
    const symbol = { id: "name", type: "text", required: true,
      [Symbol("inject")]: "unknown" };
    for (const field of [hidden, accessor, crossInstallation, symbol]) {
      try {
        parseResourceDefinition({ ...resource, fields: [field] });
        throw new Error("expected schema rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceSchemaError);
        if (!(error instanceof ResourceSchemaError)) throw error;
        expect(error.code).toBe("UNSAFE_DEFINITION");
      }
    }
    expect(getterCalls).toBe(0);
  });

  it("denies nested holes and changed canonical array prototypes", () => {
    const resource = crmCustomers();
    expect(() => parseResourceDefinition({
      ...resource, fields: [{
        id: "stage", type: "enum", required: false,
        values: ["lead", , "won"],
      }],
    })).toThrow(ResourceSchemaError);
    const ir = compileResourceSchema([resource], crmScope);
    const altered = { ...ir, resources: [...ir.resources] };
    Object.setPrototypeOf(altered.resources, {
      map() { throw new Error("inherited malicious method"); },
    });
    expect(() => parseCanonicalSchemaIR(altered)).toThrow(ResourceSchemaError);
    expect(() => createSchemaManifest(altered)).toThrow(SchemaPlanningError);
  });
});
