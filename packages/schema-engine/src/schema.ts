import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import {
  asApplicationId,
  asInstallationId,
  type ApplicationId,
  type InstallationId,
} from "@vibress/platform-kernel";

export const CANONICAL_SCHEMA_VERSION = 1 as const;

export type ResourceOwnership = "application" | "tenant";

interface FieldBase {
  readonly id: string;
  readonly required: boolean;
}

export type FieldDefinition =
  | (FieldBase & { readonly type: "text"; readonly default?: string })
  | (FieldBase & { readonly type: "number"; readonly default?: number })
  | (FieldBase & { readonly type: "boolean"; readonly default?: boolean })
  | (FieldBase & { readonly type: "datetime"; readonly default?: string })
  | (FieldBase & {
      readonly type: "enum";
      readonly values: readonly string[];
      readonly default?: string;
    })
  | (FieldBase & {
      readonly type: "relation";
      readonly targetResource: string;
    });

export interface ResourceDefinition {
  readonly id: string;
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly ownership: ResourceOwnership;
  readonly fields: readonly FieldDefinition[];
}

/**
 * The caller supplies these identities from trusted installation configuration,
 * NOT from a client header. Compilation validates boundaries but grants no access.
 */
export interface SchemaCompilationScope {
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
}

export interface CanonicalResource {
  readonly id: string;
  readonly ownership: ResourceOwnership;
  readonly fields: readonly FieldDefinition[];
}

export interface CanonicalSchemaIR {
  readonly schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly resources: readonly CanonicalResource[];
}

export type SchemaErrorCode =
  | "INVALID_DEFINITION"
  | "INVALID_IDENTIFIER"
  | "DUPLICATE_IDENTIFIER"
  | "UNSAFE_DEFINITION"
  | "BOUNDARY_VIOLATION"
  | "UNSUPPORTED_RELATION"
  | "UNSUPPORTED_VERSION";

export class ResourceSchemaError extends Error {
  constructor(
    readonly code: SchemaErrorCode,
    readonly path: string,
    reason: string,
  ) {
    super(path + ": " + reason);
    this.name = "ResourceSchemaError";
  }
}

function fail(code: SchemaErrorCode, path: string, reason: string): never {
  throw new ResourceSchemaError(code, path, reason);
}

function record(value: unknown, path: string): Record<string, unknown> {
  // Reject Proxy before getPrototypeOf/ownKeys; otherwise its traps are executable.
  if (value !== null && typeof value === "object" && nodeTypes.isProxy(value)) {
    return fail("UNSAFE_DEFINITION", path, "Proxy objects are not accepted");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return fail("INVALID_DEFINITION", path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      fail("UNSAFE_DEFINITION", path + "." + String(key), "unsupported property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      fail("UNSAFE_DEFINITION", path + "." + key, "hidden or accessor property");
    }
  }
}


/**
 * Parser-boundary snapshot of an ordinary, dense Array. The copy is populated
 * from own *data descriptors* and never invokes caller-supplied .map(),
 * iterators or index getters. Array subclasses, altered prototypes, holes,
 * decorated arrays, symbols and accessor entries all fail closed.
 *
 * Node util.types.isProxy rejects proxies without running their traps.
 * Global intrinsic monkey-patching and other arbitrary in-process executable
 * code remain outside this data-parser trust boundary. Prefer parsed JSON.
 */
function plainArray(value: unknown, path: string, min: number, max: number): readonly unknown[] {
  if (nodeTypes.isProxy(value)) {
    return fail("UNSAFE_DEFINITION", path, "Proxy arrays are not accepted");
  }
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail("UNSAFE_DEFINITION", path, "expected an ordinary Array prototype");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length: unknown = descriptor?.value;
  if (typeof length !== "number" || !Number.isInteger(length) ||
      length < min || length > max) {
    return fail("INVALID_DEFINITION", path, "array length is outside permitted bounds");
  }
  // A dense ordinary Array must own exactly length numeric entries and 'length'.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    return fail("UNSAFE_DEFINITION", path, "sparse or decorated array");
  }
  const copy: unknown[] = new Array<unknown>(length);
  for (let i = 0; i < length; i++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(i));
    if (!entry || !entry.enumerable || !("value" in entry)) {
      return fail("UNSAFE_DEFINITION", path + "[" + i + "]", "missing, hidden or accessor array entry");
    }
    copy[i] = entry.value;
  }
  return copy;
}

// PostgreSQL 16 parser RESERVED_KEYWORD entries (catcode 'R'), derived from
// PostgreSQL's upstream src/include/parser/kwlist.h (REL_16_STABLE).
// Do not classify all PostgreSQL keywords as reserved: e.g. UPDATE and INDEX
// are non-reserved in PG16, although the schema-engine policy separately bans them.
// https://www.postgresql.org/docs/16/sql-keywords-appendix.html
const POSTGRESQL16_RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any",
  "array", "as", "asc", "asymmetric", "both",
  "case", "cast", "check", "collate", "column",
  "constraint", "create", "current_catalog", "current_date", "current_role",
  "current_time", "current_timestamp", "current_user", "default", "deferrable",
  "desc", "distinct", "do", "else", "end",
  "except", "false", "fetch", "for", "foreign",
  "from", "grant", "group", "having", "in",
  "initially", "intersect", "into", "lateral", "leading",
  "limit", "localtime", "localtimestamp", "not", "null",
  "offset", "on", "only", "or", "order",
  "placing", "primary", "references", "returning", "select",
  "session_user", "some", "symmetric", "system_user", "table",
  "then", "to", "trailing", "true", "union",
  "unique", "user", "using", "variadic", "when",
  "where", "window", "with",
]);

// Existing Canonical IR v1 restrictions: protected columns, namespaces and
// intentionally stricter engine policy. Keep these separate from parser classes.
const ENGINE_RESERVED = new Set([
  "id", "application_id", "installation_id", "tenant_id", "created_at",
  "updated_at", "join", "drop", "alter", "delete",
  "insert", "update", "revoke", "index", "schema",
  "public", "information_schema",
]);

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function identifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !NAME_PATTERN.test(value) ||
    Buffer.byteLength(value, "utf8") > 63 ||
    value.includes("__") ||
    value.startsWith("pg_") ||
    value.startsWith("vibress_") ||
    POSTGRESQL16_RESERVED.has(value) ||
    ENGINE_RESERVED.has(value)
  ) {
    return fail(
      "INVALID_IDENTIFIER",
      path,
      "expected a lowercase ASCII unquoted PostgreSQL 16 identifier (1-63 bytes), not a reserved keyword or protected name",
    );
  }
  return value;
}

function applicationId(value: unknown, path: string): ApplicationId {
  try {
    return asApplicationId(value);
  } catch {
    return fail("INVALID_IDENTIFIER", path, "invalid platform application id");
  }
}

function installationId(value: unknown, path: string): InstallationId {
  try {
    return asInstallationId(value);
  } catch {
    return fail("INVALID_IDENTIFIER", path, "invalid platform installation id");
  }
}

function requiredFlag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return fail("INVALID_DEFINITION", path, "required must be a boolean");
  }
  return value;
}

function literalString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 4096) {
    return fail("UNSAFE_DEFINITION", path, "expected a bounded string literal");
  }
  return value;
}

function literalNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("UNSAFE_DEFINITION", path, "expected a finite number literal");
  }
  return Object.is(value, -0) ? 0 : value;
}

function timestampLiteral(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return fail("UNSAFE_DEFINITION", path, "expected a fixed UTC ISO timestamp, not an expression");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fail("UNSAFE_DEFINITION", path, "invalid UTC timestamp");
  }
  const canonical = date.toISOString();
  if (canonical.slice(0, 19) !== value.slice(0, 19)) {
    return fail("UNSAFE_DEFINITION", path, "invalid calendar timestamp");
  }
  return canonical;
}

function compareResourceIds(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function normalizeField(value: unknown, path: string): FieldDefinition {
  const input = record(value, path);
  // Reject accessors and hidden properties before reading any field values.
  onlyKeys(input, ["id", "type", "required", "default", "values", "targetResource"], path);
  const id = identifier(input.id, path + ".id");
  const required = requiredFlag(input.required, path + ".required");
  const hasDefault = Object.prototype.hasOwnProperty.call(input, "default");
  switch (input.type) {
    case "text":
      onlyKeys(input, ["id", "type", "required", "default"], path);
      return Object.freeze({
        id, type: "text", required,
        ...(hasDefault ? { default: literalString(input.default, path + ".default") } : {}),
      });
    case "number":
      onlyKeys(input, ["id", "type", "required", "default"], path);
      return Object.freeze({
        id, type: "number", required,
        ...(hasDefault ? { default: literalNumber(input.default, path + ".default") } : {}),
      });
    case "boolean":
      onlyKeys(input, ["id", "type", "required", "default"], path);
      if (hasDefault && typeof input.default !== "boolean") {
        fail("UNSAFE_DEFINITION", path + ".default", "expected a boolean literal");
      }
      return Object.freeze({
        id, type: "boolean", required,
        ...(hasDefault ? { default: input.default as boolean } : {}),
      });
    case "datetime":
      onlyKeys(input, ["id", "type", "required", "default"], path);
      return Object.freeze({
        id, type: "datetime", required,
        ...(hasDefault ? { default: timestampLiteral(input.default, path + ".default") } : {}),
      });
    case "enum": {
      onlyKeys(input, ["id", "type", "required", "values", "default"], path);
      const rawValues = plainArray(input.values, path + ".values", 1, 64);
      const values: string[] = [];
      for (let i = 0; i < rawValues.length; i++) {
        values[i] = identifier(rawValues[i], path + ".values[" + i + "]");
      }
      if (new Set(values).size !== values.length) {
        fail("DUPLICATE_IDENTIFIER", path + ".values", "duplicate enum value");
      }
      values.sort();
      if (hasDefault && (typeof input.default !== "string" || !values.includes(input.default))) {
        fail("UNSAFE_DEFINITION", path + ".default", "default must be a declared enum value");
      }
      return Object.freeze({
        id, type: "enum", required, values: Object.freeze(values),
        ...(hasDefault ? { default: input.default as string } : {}),
      });
    }
    case "relation":
      onlyKeys(input, ["id", "type", "required", "targetResource"], path);
      return Object.freeze({
        id, type: "relation", required,
        targetResource: identifier(input.targetResource, path + ".targetResource"),
      });
    default:
      return fail("INVALID_DEFINITION", path + ".type", "unsupported field type");
  }
}

export function parseResourceDefinition(value: unknown): ResourceDefinition {
  const source = record(value, "resource");
  onlyKeys(
    source,
    ["id", "applicationId", "installationId", "ownership", "fields"],
    "resource",
  );
  const id = identifier(source.id, "resource.id");
  const appId = applicationId(source.applicationId, "resource.applicationId");
  const installId = installationId(source.installationId, "resource.installationId");
  if (source.ownership !== "tenant" && source.ownership !== "application") {
    fail("INVALID_DEFINITION", "resource.ownership", "expected tenant or application");
  }
  const rawFields = plainArray(source.fields, "resource.fields", 1, 128);
  const fields: FieldDefinition[] = [];
  for (let i = 0; i < rawFields.length; i++) {
    fields[i] = normalizeField(rawFields[i], "resource.fields[" + i + "]");
  }
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) {
      fail("DUPLICATE_IDENTIFIER", "resource.fields." + field.id, "duplicate field id");
    }
    ids.add(field.id);
  }
  fields.sort(compareResourceIds);
  return Object.freeze({
    id, applicationId: appId, installationId: installId,
    ownership: source.ownership,
    fields: Object.freeze(fields),
  });
}

/** Typed authoring entrypoint; also checks dynamically supplied values at runtime. */
export function defineResource(definition: ResourceDefinition): ResourceDefinition {
  return parseResourceDefinition(definition);
}

/**
 * Pure compiler: no database connections, SQL generation, registration or
 * privileged execution. Every resource must belong to the trusted scope.
 */
export function compileResourceSchema(
  resources: readonly ResourceDefinition[],
  scope: SchemaCompilationScope,
): CanonicalSchemaIR {
  const context = record(scope, "scope");
  onlyKeys(context, ["applicationId", "installationId"], "scope");
  const appId = applicationId(context.applicationId, "scope.applicationId");
  const installId = installationId(context.installationId, "scope.installationId");
  const rawResources = plainArray(resources, "resources", 1, 128);
  const normalized: ResourceDefinition[] = [];
  for (let i = 0; i < rawResources.length; i++) {
    normalized[i] = parseResourceDefinition(rawResources[i]);
  }
  const byId = new Map<string, ResourceDefinition>();
  for (const resource of normalized) {
    if (resource.applicationId !== appId || resource.installationId !== installId) {
      fail("BOUNDARY_VIOLATION", "resources." + resource.id, "resource belongs to another application or installation");
    }
    if (byId.has(resource.id)) {
      fail("DUPLICATE_IDENTIFIER", "resources." + resource.id, "duplicate resource id");
    }
    byId.set(resource.id, resource);
  }

  for (const resource of normalized) {
    for (const field of resource.fields) {
      if (field.type !== "relation") continue;
      const target = byId.get(field.targetResource);
      if (!target || target.id === resource.id || target.ownership !== resource.ownership) {
        fail(
          "UNSUPPORTED_RELATION",
          "resources." + resource.id + ".fields." + field.id,
          "relation must target a distinct declared resource with identical ownership",
        );
      }
    }
  }
  const ordered = normalized
    .sort(compareResourceIds)
    .map((resource): CanonicalResource => Object.freeze({
      id: resource.id, ownership: resource.ownership, fields: resource.fields,
    }));
  return Object.freeze({
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    applicationId: appId,
    installationId: installId,
    resources: Object.freeze(ordered),
  });
}

/**
 * Persisted IR is untrusted. Revalidate by recompiling under the declared
 * identity and reject non-canonical keys, order, defaults or relations.
 * Authenticity and authorization are responsibilities of the future registry.
 */
export function parseCanonicalSchemaIR(value: unknown): CanonicalSchemaIR {
  const source = record(value, "ir");
  onlyKeys(source, ["schemaVersion", "applicationId", "installationId", "resources"], "ir");
  if (source.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
    fail("UNSUPPORTED_VERSION", "ir.schemaVersion", "unsupported schema version");
  }
  const appId = applicationId(source.applicationId, "ir.applicationId");
  const installId = installationId(source.installationId, "ir.installationId");
  const rawResources = plainArray(source.resources, "ir.resources", 0, 128);
  const resources: ResourceDefinition[] = [];
  for (let i = 0; i < rawResources.length; i++) {
    const entry = record(rawResources[i], "ir.resources[" + i + "]");
    onlyKeys(entry, ["id", "ownership", "fields"], "ir.resources[" + i + "]");
    resources[i] = parseResourceDefinition({
      ...entry,
      applicationId: appId,
      installationId: installId,
    });
  }
  const compiled = compileResourceSchema(resources, {
    applicationId: appId, installationId: installId,
  });
  if (JSON.stringify(compiled) !== JSON.stringify(source)) {
    fail("INVALID_DEFINITION", "ir", "not in canonical field/key order or normalized form");
  }
  return compiled;
}

export function serializeCanonicalSchemaIR(ir: CanonicalSchemaIR): string {
  return JSON.stringify(parseCanonicalSchemaIR(ir));
}

export function canonicalSchemaDigest(ir: CanonicalSchemaIR): string {
  return createHash("sha256")
    .update(serializeCanonicalSchemaIR(ir), "utf8")
    .digest("hex");
}
