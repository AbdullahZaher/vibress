import { createHash } from "node:crypto";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  CANONICAL_SCHEMA_VERSION,
  canonicalSchemaDigest,
  parseCanonicalSchemaIR,
  type CanonicalResource,
  type CanonicalSchemaIR,
  type FieldDefinition,
  type ResourceOwnership,
  type SchemaCompilationScope,
} from "./schema";

/**
 * M03-S02: a data-only PostgreSQL 16 planning contract. These values never
 * authorize DDL, establish effective RLS, or attest to live database state.
 */
export const SCHEMA_MANIFEST_VERSION = 1 as const;
export const SCHEMA_CHANGE_PLAN_VERSION = 1 as const;
export const TARGET_POSTGRES_VERSION = 16 as const;

export type PostgreSQLColumnType =
  | "text"
  | "double precision"
  | "boolean"
  | "timestamp with time zone"
  | null;

export type ColumnMappingStatus = "MAPPED" | "REQUIRES_REVIEW" | "UNSUPPORTED";

export interface ManifestField {
  readonly id: string;
  readonly logicalType: FieldDefinition["type"];
  readonly required: boolean;
  readonly postgresType: PostgreSQLColumnType;
  readonly mappingStatus: ColumnMappingStatus;
  readonly default?: string | number | boolean;
  readonly values?: readonly string[];
  readonly targetResource?: string;
}

export interface ManifestResource {
  readonly id: string;
  readonly ownership: ResourceOwnership;
  /** Compiler-owned name hint, not a reservation in the live PostgreSQL catalog. */
  readonly tableName: string;
  readonly securityPrerequisite: "TENANT_RLS_AND_ACL" | "APPLICATION_ACL";
  readonly fields: readonly ManifestField[];
}

export interface SchemaManifest {
  readonly manifestVersion: typeof SCHEMA_MANIFEST_VERSION;
  readonly schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  readonly applicationId: CanonicalSchemaIR["applicationId"];
  readonly installationId: CanonicalSchemaIR["installationId"];
  readonly canonicalIrDigest: string;
  readonly canonicalIr: CanonicalSchemaIR;
  readonly resources: readonly ManifestResource[];
  readonly digest: string;
}

export type SchemaOperationType =
  | "CREATE_RESOURCE"
  | "REMOVE_RESOURCE"
  | "ALTER_OWNERSHIP"
  | "ADD_FIELD"
  | "REMOVE_FIELD"
  | "ALTER_FIELD";

export type SchemaOperationStatus = "PLANNED" | "REQUIRES_REVIEW" | "UNSUPPORTED" | "DENIED";
export type SchemaOperationRisk = "LOW" | "REVIEW" | "BLOCKED";
export type SchemaApproval = "OPERATOR" | "INDEPENDENT_REVIEW" | "NOT_APPROVABLE";
export type SchemaCompatibility = "ADDITIVE" | "BREAKING" | "UNKNOWN";

export interface SchemaChangeOperation {
  readonly id: string;
  readonly type: SchemaOperationType;
  readonly resourceId: string;
  readonly fieldId: string | null;
  readonly expected: ManifestResource | ManifestField | null;
  readonly proposed: ManifestResource | ManifestField | null;
  readonly status: SchemaOperationStatus;
  readonly risk: SchemaOperationRisk;
  readonly approval: SchemaApproval;
  readonly compatibility: SchemaCompatibility;
  readonly reason: string;
}

export interface SchemaPlanOptions {
  /** Null means the trusted registry expects no accepted manifest. */
  readonly expectedCurrentDigest: string | null;
  /** Obtained from operator-owned installation configuration, never a request header. */
  readonly scope: SchemaCompilationScope;
}

export interface SchemaChangePlan {
  readonly planVersion: typeof SCHEMA_CHANGE_PLAN_VERSION;
  readonly postgresVersion: typeof TARGET_POSTGRES_VERSION;
  readonly applicationId: CanonicalSchemaIR["applicationId"];
  readonly installationId: CanonicalSchemaIR["installationId"];
  readonly preconditions: {
    readonly manifestVersion: typeof SCHEMA_MANIFEST_VERSION;
    readonly schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
    readonly expectedCurrentDigest: string | null;
    readonly proposedManifestDigest: string;
    readonly proposedCanonicalIrDigest: string;
    readonly verifyLiveDatabaseDrift: true;
    readonly verifyInstallationAndPrivileges: true;
    readonly requireOperatorAuthorization: true;
  };
  readonly proposedManifest: SchemaManifest;
  readonly operations: readonly SchemaChangeOperation[];
  readonly disposition: "NO_CHANGES" | "PLANNED" | "REVIEW_REQUIRED" | "BLOCKED";
  readonly digest: string;
}

export type SchemaPlanningErrorCode =
  | "INVALID_INPUT"
  | "INVALID_MANIFEST"
  | "CHECKSUM_MISMATCH"
  | "UNSUPPORTED_VERSION"
  | "BOUNDARY_VIOLATION"
  | "DRIFT_DETECTED";

export class SchemaPlanningError extends Error {
  constructor(
    readonly code: SchemaPlanningErrorCode,
    readonly path: string,
    reason: string,
  ) {
    super(path + ": " + reason);
    this.name = "SchemaPlanningError";
  }
}

function fail(code: SchemaPlanningErrorCode, path: string, reason: string): never {
  throw new SchemaPlanningError(code, path, reason);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Check own keys, descriptors, prototypes and a strict size/depth budget
 * BEFORE JSON serialization. In particular do not trust JSON.stringify to
 * detect accessors, Symbols, sparse arrays, non-enumerables or __proto__ keys.
 */
function assertSerializable(value: unknown, path: string): void {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path, depth: 0 },
  ];
  const visited = new Set<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    if (++nodes > 60000 || item.depth > 20) {
      fail("INVALID_INPUT", item.path, "input exceeds size or nesting budget");
    }
    const node = item.value;
    if (node === null || typeof node === "boolean") continue;
    if (typeof node === "string") {
      if (node.length > 8192) fail("INVALID_INPUT", item.path, "string exceeds budget");
      continue;
    }
    if (typeof node === "number") {
      if (!Number.isFinite(node)) fail("INVALID_INPUT", item.path, "number is not finite");
      continue;
    }
    if (typeof node !== "object") {
      fail("INVALID_INPUT", item.path, "only JSON data values are supported");
    }
    if (visited.has(node)) fail("INVALID_INPUT", item.path, "shared/cyclic objects are not accepted");
    visited.add(node);
    const isArray = Array.isArray(node);
    if (!isArray && Object.getPrototypeOf(node) !== Object.prototype &&
      Object.getPrototypeOf(node) !== null) {
      fail("INVALID_INPUT", item.path, "expected plain objects");
    }
    if (isArray && node.length > 128) {
      fail("INVALID_INPUT", item.path, "array exceeds budget");
    }
    const keys = Reflect.ownKeys(node);
    if (isArray && keys.length !== node.length + 1) {
      fail("INVALID_INPUT", item.path, "sparse or decorated arrays are not accepted");
    }
    for (const key of keys) {
      if (isArray && key === "length") continue;
      if (typeof key !== "string" || key === "__proto__" ||
        key === "constructor" || key === "prototype" ||
        (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= node.length))) {
        fail("INVALID_INPUT", item.path, "unexpected own property");
      }
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        fail("INVALID_INPUT", item.path + "." + key, "accessor or hidden property");
      }
      stack.push({ value: descriptor.value, path: item.path + "." + key, depth: item.depth + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 1024 * 1024) {
    fail("INVALID_INPUT", path, "document exceeds 1 MiB");
  }
}

function fieldManifest(field: FieldDefinition): ManifestField {
  const common = {
    id: field.id,
    logicalType: field.type,
    required: field.required,
    ...("default" in field ? { default: field.default } : {}),
  };
  switch (field.type) {
    case "text":
      return Object.freeze({ ...common, postgresType: "text", mappingStatus: "MAPPED" });
    case "number":
      return Object.freeze({ ...common, postgresType: "double precision", mappingStatus: "MAPPED" });
    case "boolean":
      return Object.freeze({ ...common, postgresType: "boolean", mappingStatus: "MAPPED" });
    case "datetime":
      return Object.freeze({
        ...common, postgresType: "timestamp with time zone", mappingStatus: "MAPPED",
      });
    case "enum":
      return Object.freeze({
        ...common, postgresType: "text", mappingStatus: "REQUIRES_REVIEW",
        values: Object.freeze([...field.values]),
      });
    case "relation":
      return Object.freeze({
        ...common, postgresType: null, mappingStatus: "UNSUPPORTED",
        targetResource: field.targetResource,
      });
  }
}

function resourceManifest(resource: CanonicalResource): ManifestResource {
  // Hash prevents PostgreSQL's 63-byte truncation even for maximum-size DSL IDs.
  // A future installer MUST still verify actual catalog collisions/namespace ownership.
  const tableName = "vr_" + resource.id.slice(0, 45) + "_" + digest(resource.id).slice(0, 12);
  return Object.freeze({
    id: resource.id,
    ownership: resource.ownership,
    tableName,
    securityPrerequisite: resource.ownership === "tenant"
      ? "TENANT_RLS_AND_ACL" : "APPLICATION_ACL",
    fields: Object.freeze(resource.fields.map(fieldManifest)),
  });
}

export function createSchemaManifest(input: CanonicalSchemaIR): SchemaManifest {
  assertSerializable(input, "canonicalIr");
  const ir = parseCanonicalSchemaIR(input);
  const resources = Object.freeze(ir.resources.map(resourceManifest));
  const tableNames = new Set(resources.map((resource) => resource.tableName));
  if (tableNames.size !== resources.length) {
    fail("INVALID_MANIFEST", "manifest.resources", "physical table-name collision");
  }
  const body = {
    manifestVersion: SCHEMA_MANIFEST_VERSION,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    applicationId: ir.applicationId,
    installationId: ir.installationId,
    canonicalIrDigest: canonicalSchemaDigest(ir),
    canonicalIr: ir,
    resources,
  };
  return Object.freeze({ ...body, digest: digest(body) });
}

/** Strictly reconstruct from Canonical IR and reject every altered or reordered byte. */
export function parseSchemaManifest(value: unknown): SchemaManifest {
  assertSerializable(value, "manifest");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_MANIFEST", "manifest", "expected an object");
  }
  const source: Record<string, unknown> = value as Record<string, unknown>;
  if (source.manifestVersion !== SCHEMA_MANIFEST_VERSION ||
    source.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
    fail("UNSUPPORTED_VERSION", "manifest", "incompatible manifest or canonical IR version");
  }
  const expected = createSchemaManifest(parseCanonicalSchemaIR(source.canonicalIr));
  if (source.digest !== expected.digest || source.canonicalIrDigest !== expected.canonicalIrDigest) {
    fail("CHECKSUM_MISMATCH", "manifest.digest", "manifest/IR checksum does not match");
  }
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    fail("INVALID_MANIFEST", "manifest", "noncanonical or inconsistent physical mapping");
  }
  return expected;
}

function operation(
  type: SchemaOperationType,
  resourceId: string,
  fieldId: string | null,
  expected: ManifestResource | ManifestField | null,
  proposed: ManifestResource | ManifestField | null,
  status: SchemaOperationStatus,
  compatibility: SchemaCompatibility,
  reason: string,
): SchemaChangeOperation {
  const base = { type, resourceId, fieldId, expected, proposed, status };
  return Object.freeze({
    id: "op_" + digest(base).slice(0, 24),
    ...base,
    risk: status === "PLANNED" ? "LOW" : status === "REQUIRES_REVIEW" ? "REVIEW" : "BLOCKED",
    approval: status === "PLANNED" ? "OPERATOR"
      : status === "REQUIRES_REVIEW" ? "INDEPENDENT_REVIEW" : "NOT_APPROVABLE",
    compatibility,
    reason,
  });
}

function classifyNewField(field: ManifestField): {
  status: SchemaOperationStatus;
  reason: string;
} {
  if (field.mappingStatus === "UNSUPPORTED") {
    return { status: "UNSUPPORTED", reason: "relation storage and scoped foreign keys are not implemented" };
  }
  if (field.mappingStatus === "REQUIRES_REVIEW") {
    return { status: "REQUIRES_REVIEW", reason: "enum value enforcement needs reviewed constraints" };
  }
  if (field.required || Object.prototype.hasOwnProperty.call(field, "default")) {
    return { status: "REQUIRES_REVIEW", reason: "required columns or defaults need reviewed backfill/lock policy" };
  }
  return { status: "PLANNED", reason: "optional scalar with no database default (operator approval still required)" };
}

/**
 * Pure expected-manifest diff. A PLANNED operation is NOT an approved migration.
 * Caller and future installer must independently verify registry provenance,
 * live drift, physical namespace, DB role/ACL and tenant RLS before any DDL.
 */
export function planSchemaChanges(
  current: unknown | null,
  proposed: unknown,
  options: SchemaPlanOptions,
): SchemaChangePlan {
  assertSerializable(options, "options");
  if (typeof options !== "object" || options === null ||
    Reflect.ownKeys(options).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(options, "expectedCurrentDigest") ||
    !Object.prototype.hasOwnProperty.call(options, "scope") {
    fail("INVALID_INPUT", "options", "expected current digest and trusted scope");
  }
  const rawScope = options.scope;
  assertSerializable(rawScope, "options.scope");
  if (!rawScope || typeof rawScope !== "object" ||
    Reflect.ownKeys(rawScope).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(rawScope, "applicationId") ||
    !Object.prototype.hasOwnProperty.call(rawScope, "installationId")) {
    fail("INVALID_INPUT", "options.scope", "expected application and installation identifiers");
  }
  let applicationId: CanonicalSchemaIR["applicationId"];
  let installationId: CanonicalSchemaIR["installationId"];
  try {
    applicationId = asApplicationId(rawScope.applicationId);
    installationId = asInstallationId(rawScope.installationId);
  } catch {
    return fail("INVALID_INPUT", "options.scope", "invalid trusted installation identity");
  }
  const expectedDigest = options.expectedCurrentDigest;
  if (expectedDigest !== null &&
    (typeof expectedDigest !== "string" || !SHA256_PATTERN.test(expectedDigest))) {
    fail("INVALID_INPUT", "options.expectedCurrentDigest", "expected SHA-256 digest or null");
  }
  const before = current === null ? null : parseSchemaManifest(current);
  if (before?.resources.some((resource) =>
    resource.fields.some((field) => field.mappingStatus === "UNSUPPORTED"))) {
    fail("INVALID_MANIFEST", "current.resources",
      "accepted manifest contains unmapped physical storage");
  }
  if ((before?.digest ?? null) !== expectedDigest) {
    fail("DRIFT_DETECTED", "options.expectedCurrentDigest", "stale or unexpected accepted manifest");
  }
  assertSerializable(proposed, "proposed");
  const after = createSchemaManifest(parseCanonicalSchemaIR(proposed));
  if (after.applicationId !== applicationId || after.installationId !== installationId ||
    (before !== null &&
      (before.applicationId !== applicationId || before.installationId !== installationId))) {
    fail("BOUNDARY_VIOLATION", "options.scope", "application or installation mismatch");
  }

  const operations: SchemaChangeOperation[] = [];
  const oldResources = new Map((before?.resources ?? []).map((resource) => [resource.id, resource]));
  const newResources = new Map(after.resources.map((resource) => [resource.id, resource]));
  for (const oldResource of before?.resources ?? []) {
    if (!newResources.has(oldResource.id)) {
      operations.push(operation("REMOVE_RESOURCE", oldResource.id, null, oldResource,
        null, "DENIED", "BREAKING", "DROP TABLE is forbidden"));
    }
  }
  for (const newResource of after.resources) {
    const oldResource = oldResources.get(newResource.id);
    if (!oldResource) {
      const status: SchemaOperationStatus =
        newResource.fields.some((field) => field.mappingStatus === "UNSUPPORTED")
          ? "UNSUPPORTED" : "REQUIRES_REVIEW";
      operations.push(operation("CREATE_RESOURCE", newResource.id, null, null,
        newResource, status, status === "UNSUPPORTED" ? "UNKNOWN" : "ADDITIVE",
        status === "UNSUPPORTED"
          ? "resource has unmapped relation storage"
          : "table namespace, ownership, required columns, privileges and RLS require review"));
      continue;
    }
    if (newResource.ownership !== oldResource.ownership ||
      newResource.tableName !== oldResource.tableName ||
      newResource.securityPrerequisite !== oldResource.securityPrerequisite) {
      operations.push(operation("ALTER_OWNERSHIP", newResource.id, null,
        oldResource, newResource, "DENIED", "BREAKING",
        "ownership/security/table identity changes are forbidden"));
      // Do not present column alterations as independently safe once ownership differs.
      continue;
    }
    const beforeFields = new Map(oldResource.fields.map((field) => [field.id, field]));
    const afterFields = new Map(newResource.fields.map((field) => [field.id, field]));
    for (const oldField of oldResource.fields) {
      if (!afterFields.has(oldField.id)) {
        operations.push(operation("REMOVE_FIELD", newResource.id, oldField.id,
          oldField, null, "DENIED", "BREAKING", "DROP COLUMN is forbidden"));
      }
    }
    for (const newField of newResource.fields) {
      const oldField = beforeFields.get(newField.id);
      if (!oldField) {
        const classification = classifyNewField(newField);
        operations.push(operation("ADD_FIELD", newResource.id, newField.id,
          null, newField, classification.status,
          classification.status === "UNSUPPORTED" ? "UNKNOWN" : "ADDITIVE",
          classification.reason));
      } else if (JSON.stringify(oldField) !== JSON.stringify(newField)) {
        const typeChanged = oldField.logicalType !== newField.logicalType ||
          oldField.postgresType !== newField.postgresType ||
          oldField.targetResource !== newField.targetResource;
        operations.push(operation("ALTER_FIELD", newResource.id, newField.id,
          oldField, newField, typeChanged ? "DENIED" : "REQUIRES_REVIEW",
          typeChanged ? "BREAKING" : "UNKNOWN",
          typeChanged
            ? "unreviewed type/reference rewrites are forbidden"
            : "existing field constraints, nullability, enum values or defaults changed"));
      }
    }
  }
  const lex = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  operations.sort((a, b) =>
    lex(a.resourceId, b.resourceId) ||
    lex(a.fieldId ?? "", b.fieldId ?? "") ||
    lex(a.type, b.type));
  const disposition: SchemaChangePlan["disposition"] =
    operations.some((change) => change.status === "DENIED" || change.status === "UNSUPPORTED")
      ? "BLOCKED"
      : operations.some((change) => change.status === "REQUIRES_REVIEW")
        ? "REVIEW_REQUIRED" : operations.length === 0 ? "NO_CHANGES" : "PLANNED";
  const body = {
    planVersion: SCHEMA_CHANGE_PLAN_VERSION,
    postgresVersion: TARGET_POSTGRES_VERSION,
    applicationId,
    installationId,
    preconditions: Object.freeze({
      manifestVersion: SCHEMA_MANIFEST_VERSION,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      expectedCurrentDigest: expectedDigest,
      proposedManifestDigest: after.digest,
      proposedCanonicalIrDigest: after.canonicalIrDigest,
      verifyLiveDatabaseDrift: true as const,
      verifyInstallationAndPrivileges: true as const,
      requireOperatorAuthorization: true as const,
    }),
    proposedManifest: after,
    operations: Object.freeze(operations),
    disposition,
  };
  return Object.freeze({ ...body, digest: digest(body) });
}
