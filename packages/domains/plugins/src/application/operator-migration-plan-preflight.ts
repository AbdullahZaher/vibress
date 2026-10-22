/**
 * Read-only admission of an operator-reviewed plugin migration descriptor.
 * This never executes plugin code, runs SQL or reserves a model namespace.
 */
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PluginManifest } from "@vibress/plugin-sdk";
import {
  PluginStorageMigrationError,
  validateApprovedPhysicalMigration,
  type ApprovedPluginPhysicalMigration,
  type ApprovedPluginPhysicalModel,
} from "./plugin-storage-migrations";

const columnSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "integer", "boolean", "timestamptz"]),
  required: z.boolean(),
}).strict();
const modelSchema = z.object({
  key: z.string(),
  schemaSha256: z.string(),
  columns: z.array(columnSchema).min(1).max(24),
}).strict();
const planSchema = z.object({
  manifestId: z.string(),
  migrationId: z.string(),
  packageVersion: z.string(),
  artifactSha256: z.string(),
  migrationSha256: z.string(),
  models: z.array(modelSchema).min(1).max(16),
}).strict();

export interface OperatorApprovedMigrationRelease {
  readonly manifest: Pick<PluginManifest, "id" | "version">;
  readonly sha256: string;
  readonly storageModels: readonly ApprovedPluginPhysicalModel[];
}

/**
 * Both the operator-signed lockfile and the final artifact must be checked by
 * verifyTrustedPluginRelease() BEFORE calling this pure validator. No plan
 * field can add an approved model or override the signed release metadata.
 */
export function checkOperatorPluginMigrationPlan(
  rawPlan: unknown,
  approvedRelease: OperatorApprovedMigrationRelease,
): ApprovedPluginPhysicalMigration {
  const parsed = planSchema.safeParse(rawPlan);
  if (!parsed.success) {
    throw new PluginStorageMigrationError(
      "PLUGIN_MIGRATION_INVALID", "Invalid operator migration plan shape",
    );
  }
  const plan = validateApprovedPhysicalMigration(parsed.data);
  if (!approvedRelease ||
      plan.manifestId !== approvedRelease.manifest?.id ||
      plan.packageVersion !== approvedRelease.manifest.version ||
      plan.artifactSha256 !== approvedRelease.sha256 ||
      !Array.isArray(approvedRelease.storageModels) ||
      !isDeepStrictEqual(plan.models, approvedRelease.storageModels)) {
    throw new PluginStorageMigrationError(
      "PLUGIN_MIGRATION_RELEASE_MISMATCH",
      "Migration plan does not match the operator-approved release",
    );
  }
  return plan;
}
