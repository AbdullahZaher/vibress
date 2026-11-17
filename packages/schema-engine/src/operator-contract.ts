import { types as nodeTypes } from "node:util";
import {
  parseSchemaManifest,
  planSchemaChanges,
  type ManifestField,
  type SchemaChangePlan,
  type SchemaManifest,
} from "./planning";
import type { SchemaCompilationScope } from "./schema";

/**
 * M03-S03: pure, non-authorizing validation of persisted plans and a single
 * bounded PG16 additive column. This module never opens a database.
 *
 * Approval and installation identity MUST come from operator-owned records.
 * No caller-provided status, hash or raw SQL is treated as authority.
 */
export class SchemaExecutionContractError extends Error {
  constructor(
    readonly code: "UNTRUSTED_PLAN" | "OPERATION_BLOCKED" | "UNSUPPORTED_OPERATION",
    reason: string,
  ) {
    super(reason);
    this.name = "SchemaExecutionContractError";
  }
}

function reject(code: SchemaExecutionContractError["code"], reason: string): never {
  throw new SchemaExecutionContractError(code, reason);
}

/** Reject executable JS objects and unusual array members before reading them. */
function assertPureJson(input: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (++count > 60000 || entry.depth > 24) reject("UNTRUSTED_PLAN", "plan exceeds structural budget");
    const value = entry.value;
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > 8192) reject("UNTRUSTED_PLAN", "oversized string");
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) continue;
    if (typeof value !== "object" || value === null || nodeTypes.isProxy(value)) {
      reject("UNTRUSTED_PLAN", "plan contains a non-JSON value or Proxy");
    }
    if (seen.has(value)) reject("UNTRUSTED_PLAN", "plan contains shared or cyclic objects");
    seen.add(value);
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) {
      reject("UNTRUSTED_PLAN", "plan has a non-standard prototype");
    }
    const keys = Reflect.ownKeys(value);
    const length = isArray ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
    if (isArray && (typeof length !== "number" || length > 128 ||
      keys.length !== length + 1)) {
      reject("UNTRUSTED_PLAN", "plan has a sparse or decorated array");
    }
    for (const key of keys) {
      if (isArray && key === "length") continue;
      if (typeof key !== "string" || key === "__proto__" ||
        key === "constructor" || key === "prototype" ||
        (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) {
        reject("UNTRUSTED_PLAN", "plan contains an unexpected property");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        reject("UNTRUSTED_PLAN", "plan has a hidden or accessor property");
      }
      stack.push({ value: descriptor.value, depth: entry.depth + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 1024 * 1024) {
    reject("UNTRUSTED_PLAN", "plan exceeds 1MiB");
  }
}

/**
 * Reconstruct the exact operation set/status/digest from independently stored
 * canonical manifests and trusted installation identity. Stored plan JSON is
 * NOT trusted, even if its own digest matches.
 */
export function rehydrateSchemaChangePlan(
  persisted: unknown,
  acceptedManifest: unknown,
  scope: SchemaCompilationScope,
): SchemaChangePlan {
  assertPureJson(persisted);
  if (typeof persisted !== "object" || persisted === null || Array.isArray(persisted)) {
    return reject("UNTRUSTED_PLAN", "expected a persisted plan object");
  }
  const proposedValue = (persisted as Record<string, unknown>).proposedManifest;
  const accepted = acceptedManifest === null ? null : parseSchemaManifest(acceptedManifest);
  const proposed = parseSchemaManifest(proposedValue);
  const reconstructed = planSchemaChanges(accepted, proposed.canonicalIr, {
    scope: { applicationId: scope.applicationId, installationId: scope.installationId },
    expectedCurrentDigest: accepted?.digest ?? null,
  });
  if (JSON.stringify(persisted) !== JSON.stringify(reconstructed)) {
    return reject("UNTRUSTED_PLAN", "persisted plan differs from independently recomputed operation set");
  }
  return reconstructed;
}

export interface RenderedAddColumn {
  readonly operationId: string;
  readonly planDigest: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly columnType: "text" | "double precision" | "boolean" | "timestamp with time zone";
  /** Bound to the validated PG16 identifier grammar. Never accepts SQL fragments. */
  readonly sql: string;
}

const TABLE_PATTERN = /^vr_[a-z][a-z0-9_]*_[0-9a-f]{12}$/;
const COLUMN_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function assertSupportedFields(fields: readonly ManifestField[]): void {
  for (const field of fields) {
    if (field.mappingStatus !== "MAPPED" || field.postgresType === null ||
      Object.prototype.hasOwnProperty.call(field, "default")) {
      reject("UNSUPPORTED_OPERATION", "existing table has unsupported field mapping or default");
    }
  }
}

/**
 * Candidate A only. Existing application-owned table; one PLANNED optional
 * scalar addition without default. CREATE_RESOURCE, tenant-owned resources,
 * destructive/review operations, and multi-operation plans are denied.
 */
export function renderAdditiveColumn(
  plan: SchemaChangePlan,
  accepted: SchemaManifest,
): RenderedAddColumn {
  if (plan.operations.length !== 1 || plan.disposition !== "PLANNED") {
    return reject("OPERATION_BLOCKED", "only a one-operation PLANNED plan is supported");
  }
  const operation = plan.operations[0];
  if (!operation || operation.type !== "ADD_FIELD" || operation.status !== "PLANNED" ||
    operation.risk !== "LOW" || operation.approval !== "OPERATOR" ||
    operation.compatibility !== "ADDITIVE" || operation.expected !== null ||
    operation.fieldId === null) {
    return reject("OPERATION_BLOCKED", "operation is not an approved additive field candidate");
  }
  if (plan.preconditions.expectedCurrentDigest !== accepted.digest ||
    plan.applicationId !== accepted.applicationId ||
    plan.installationId !== accepted.installationId) {
    return reject("UNTRUSTED_PLAN", "plan is not bound to accepted schema");
  }
  const before = accepted.resources.find(resource => resource.id === operation.resourceId);
  const after = plan.proposedManifest.resources.find(resource => resource.id === operation.resourceId);
  if (!before || !after || before.ownership !== "application" ||
    after.ownership !== "application" || before.tableName !== after.tableName ||
    before.securityPrerequisite !== "APPLICATION_ACL") {
    return reject("OPERATION_BLOCKED", "only existing application-owned tables are supported");
  }
  assertSupportedFields(before.fields);
  const field = after.fields.find(candidate => candidate.id === operation.fieldId);
  if (!field || field.mappingStatus !== "MAPPED" || field.postgresType === null ||
    field.required || Object.prototype.hasOwnProperty.call(field, "default") ||
    field.id !== operation.fieldId) {
    return reject("OPERATION_BLOCKED", "field must be optional mapped scalar with no default");
  }
  if (!TABLE_PATTERN.test(before.tableName) ||
    Buffer.byteLength(before.tableName, "utf8") > 63 ||
    !COLUMN_PATTERN.test(field.id)) {
    return reject("UNTRUSTED_PLAN", "compiler-owned identifiers failed PG16 policy");
  }
  const sql = 'ALTER TABLE "public"."' + before.tableName +
    '" ADD COLUMN "' + field.id + '" ' + field.postgresType;
  return Object.freeze({
    operationId: operation.id,
    planDigest: plan.digest,
    tableName: before.tableName,
    columnName: field.id,
    columnType: field.postgresType,
    sql,
  });
}

/** Safe boundary for an operator: rehydration must precede SQL rendering. */
export function renderTrustedAdditiveColumn(
  storedPlan: unknown,
  acceptedManifest: unknown,
  scope: SchemaCompilationScope,
): { readonly plan: SchemaChangePlan; readonly current: SchemaManifest; readonly ddl: RenderedAddColumn } {
  if (acceptedManifest === null) {
    return reject("OPERATION_BLOCKED", "initial table creation is not supported");
  }
  const current = parseSchemaManifest(acceptedManifest);
  const plan = rehydrateSchemaChangePlan(storedPlan, current, scope);
  const ddl = renderAdditiveColumn(plan, current);
  return Object.freeze({ plan, current, ddl });
}
