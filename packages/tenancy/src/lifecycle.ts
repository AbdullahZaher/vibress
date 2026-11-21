import { createHash } from "node:crypto";
import {
  LEGACY_PUBLICATION_FALLBACK,
  type ApplicationId,
  type TenantId,
} from "@vibress/platform-kernel";
import { assertVerifiedScope, type VerifiedScope } from "./scope";

/** Storage/processing surfaces a tenant lifecycle operation may touch. */
export const LIFECYCLE_SURFACES = Object.freeze([
  "POSTGRES",
  "OBJECT_STORAGE",
  "QUEUE",
  "SEARCH_INDEX",
  "LOGS",
  "BACKUPS",
] as const);

export type LifecycleSurface = (typeof LIFECYCLE_SURFACES)[number];

/** Backup erasure is never claimed by this bounded contract. */
export type BackupErasureClaim = "NOT_CLAIMED";

export interface TenantExportManifest {
  readonly applicationId: ApplicationId;
  readonly tenantId: TenantId;
  readonly surfaces: readonly LifecycleSurface[];
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly digest: string;
}

export interface RetentionPolicy {
  readonly surface: LifecycleSurface;
  readonly maxRetentionDays: number;
  readonly legalHold: boolean;
}

export interface OffboardingPlan {
  readonly applicationId: ApplicationId;
  readonly tenantId: TenantId;
  readonly exportRequired: boolean;
  readonly surfaces: readonly LifecycleSurface[];
  readonly retention: readonly RetentionPolicy[];
  readonly backupErasureClaim: BackupErasureClaim;
}

export interface OffboardingReconciliation {
  readonly missingSurfaces: readonly LifecycleSurface[];
  readonly complete: boolean;
  readonly reasons: readonly string[];
}

export class LifecycleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleContractError";
  }
}

const SURFACE_SET = new Set<string>(LIFECYCLE_SURFACES);

function requireSurface(value: unknown): LifecycleSurface {
  if (typeof value !== "string" || !SURFACE_SET.has(value)) {
    throw new LifecycleContractError(`unsupported lifecycle surface: ${String(value)}`);
  }
  return value as LifecycleSurface;
}

function uniqueSurfaces(surfaces: readonly LifecycleSurface[]): LifecycleSurface[] {
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new LifecycleContractError("at least one lifecycle surface is required");
  }
  const seen = new Set<LifecycleSurface>();
  const result: LifecycleSurface[] = [];
  for (const raw of surfaces) {
    const surface = requireSurface(raw);
    if (seen.has(surface)) {
      throw new LifecycleContractError(`duplicate lifecycle surface: ${surface}`);
    }
    seen.add(surface);
    result.push(surface);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Reject any scope whose application/tenant does not exactly match the plan. */
export function assertLifecycleScope(
  scope: unknown,
  applicationId: ApplicationId,
  tenantId: TenantId,
): asserts scope is VerifiedScope {
  assertVerifiedScope(scope);
  if (
    (applicationId as string) === LEGACY_PUBLICATION_FALLBACK ||
    (tenantId as string) === LEGACY_PUBLICATION_FALLBACK
  ) {
    throw new LifecycleContractError("pub_default is not a lifecycle tenant identity");
  }
  if (scope.applicationId !== applicationId || scope.tenantId !== tenantId) {
    throw new LifecycleContractError("lifecycle scope does not match the requested application/tenant");
  }
}

export function validateRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  const surface = requireSurface(policy?.surface);
  if (
    !Number.isInteger(policy.maxRetentionDays) ||
    policy.maxRetentionDays < 0 ||
    policy.maxRetentionDays > 3650
  ) {
    throw new LifecycleContractError("maxRetentionDays must be an integer between 0 and 3650");
  }
  if (typeof policy.legalHold !== "boolean") {
    throw new LifecycleContractError("legalHold must be boolean");
  }
  return Object.freeze({
    surface,
    maxRetentionDays: policy.maxRetentionDays,
    legalHold: policy.legalHold,
  });
}

export function buildExportManifest(
  scope: VerifiedScope,
  input: {
    readonly applicationId: ApplicationId;
    readonly tenantId: TenantId;
    readonly surfaces: readonly LifecycleSurface[];
    readonly recordCounts: Readonly<Record<string, number>>;
  },
): TenantExportManifest {
  assertLifecycleScope(scope, input.applicationId, input.tenantId);
  const surfaces = uniqueSurfaces(input.surfaces);
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.recordCounts ?? {})) {
    if (key.trim() === "" || !Number.isInteger(value) || value < 0) {
      throw new LifecycleContractError(`invalid record count for ${key}`);
    }
    counts[key] = value;
  }
  const orderedCounts = Object.fromEntries(
    Object.keys(counts).sort((a, b) => a.localeCompare(b)).map((key) => [key, counts[key]!]),
  );
  const digest = createHash("sha256")
    .update(
      stableStringify({
        applicationId: input.applicationId,
        tenantId: input.tenantId,
        surfaces,
        recordCounts: orderedCounts,
      }),
    )
    .digest("hex");
  return Object.freeze({
    applicationId: input.applicationId,
    tenantId: input.tenantId,
    surfaces,
    recordCounts: Object.freeze(orderedCounts),
    digest,
  });
}

export function buildOffboardingPlan(
  scope: VerifiedScope,
  input: {
    readonly applicationId: ApplicationId;
    readonly tenantId: TenantId;
    readonly exportRequired: boolean;
    readonly surfaces: readonly LifecycleSurface[];
    readonly retention: readonly RetentionPolicy[];
    readonly backupErasureClaim?: BackupErasureClaim;
  },
): OffboardingPlan {
  assertLifecycleScope(scope, input.applicationId, input.tenantId);
  const surfaces = uniqueSurfaces(input.surfaces);
  const retention = (input.retention ?? []).map(validateRetentionPolicy);
  const retentionSurfaces = new Set(retention.map((policy) => policy.surface));
  for (const surface of surfaces) {
    if (!retentionSurfaces.has(surface)) {
      throw new LifecycleContractError(`missing retention policy for ${surface}`);
    }
  }
  if (typeof input.exportRequired !== "boolean") {
    throw new LifecycleContractError("exportRequired must be boolean");
  }
  if (!input.exportRequired && surfaces.some((s) => s === "POSTGRES" || s === "OBJECT_STORAGE")) {
    throw new LifecycleContractError("export is required before data-bearing surfaces are offboarded");
  }
  const claim = input.backupErasureClaim ?? "NOT_CLAIMED";
  if (claim !== "NOT_CLAIMED") {
    throw new LifecycleContractError("backup erasure must never be claimed");
  }
  return Object.freeze({
    applicationId: input.applicationId,
    tenantId: input.tenantId,
    exportRequired: input.exportRequired,
    surfaces,
    retention: Object.freeze(retention),
    backupErasureClaim: "NOT_CLAIMED" as const,
  });
}

export function reconcileOffboarding(
  plan: OffboardingPlan,
  executedSurfaces: readonly LifecycleSurface[],
): OffboardingReconciliation {
  const executed = new Set(executedSurfaces.map(requireSurface));
  const missingSurfaces = plan.surfaces.filter((surface) => !executed.has(surface));
  const reasons: string[] = [];
  if (missingSurfaces.length > 0) {
    reasons.push(`unexecuted surfaces: ${missingSurfaces.join(", ")}`);
  }
  if (plan.surfaces.includes("BACKUPS")) {
    reasons.push("backup erasure is not claimable by this contract");
  }
  if (plan.retention.some((policy) => policy.legalHold)) {
    reasons.push("legal hold prevents completion");
  }
  return Object.freeze({
    missingSurfaces: Object.freeze(missingSurfaces),
    complete: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}
