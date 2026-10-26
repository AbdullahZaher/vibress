/**
 * PLUG-UPD-01: inert, operator-only staged upgrade descriptor.
 *
 * A signed admission receipt is evidence ONLY if the caller obtained it from
 * verifyOperatorReleaseAdmission() against immutable, read-only mounts.
 * No public HTTP route or untrusted plugin can supply an admission receipt.
 * This does not quiesce a fleet, change installed metadata or run migrations.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().trim().min(1).max(128);
const pluginName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const capability = z.string().regex(/^[a-z][a-z0-9._:-]{0,127}$/);
const release = z.object({
  pluginId: pluginName,
  version,
  sha256: sha,
  adminViewCount: z.number().int().nonnegative(),
}).strict();
const receipt = z.object({
  schemaVersion: z.literal(1),
  signatureVerified: z.literal(true),
  lockfileSha256: sha,
  publicKeySha256: sha,
  releases: z.array(release).min(1).max(100),
}).strict();
const manifest = z.object({
  id: pluginName,
  version,
  capabilities: z.array(capability).max(64),
}).passthrough();
const installed = z.object({
  id: z.string().uuid(),
  manifestId: pluginName,
  version,
  capabilities: z.array(capability).max(64),
}).strict();

export interface OperatorUpgradeStageInput {
  /** Server-owned installed plugin primary key; never a tenant selector. */
  readonly pluginId: string;
  readonly sourceAdmission: unknown;
  readonly targetAdmission: unknown;
  /** The manifest parsed from the verified target lockfile, never HTTP. */
  readonly targetManifest: unknown;
}
export interface PluginUpgradeStageDetails {
  readonly pluginId: string;
  readonly manifestId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly fromArtifactSha256: string;
  readonly toArtifactSha256: string;
  readonly fromLockfileSha256: string;
  readonly toLockfileSha256: string;
  readonly fromSignerSha256: string;
  readonly toSignerSha256: string;
  readonly capabilitiesAdded: readonly string[];
  readonly capabilitiesRemoved: readonly string[];
  readonly planSha256: string;
}
/** Only the authenticated operator orchestration supplies audit identity. */
export interface OperatorUpgradeAbortInput {
  readonly pluginId: string;
  readonly planId: string;
  readonly expectedPlanSha256: string;
  readonly expectedRevision: number;
}
export interface OperatorUpgradeAuditContext {
  readonly actorUserId: string;
  readonly requestId: string;
}
const abortInputSchema = z.object({
  pluginId: z.string().uuid(),
  planId: z.string().uuid(),
  expectedPlanSha256: sha,
  expectedRevision: z.number().int().positive().max(2147483646),
}).strict();
const auditSchema = z.object({
  actorUserId: z.string().trim().min(1).max(128),
  requestId: z.string().trim().min(1).max(128),
}).strict();

export function validateOperatorUpgradeAbort(
  input: unknown, audit: unknown,
): { readonly input: OperatorUpgradeAbortInput; readonly audit: OperatorUpgradeAuditContext } {
  const parsedInput = abortInputSchema.safeParse(input);
  const parsedAudit = auditSchema.safeParse(audit);
  if (!parsedInput.success || !parsedAudit.success) {
    throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ABORT_INVALID_INPUT");
  }
  return { input: parsedInput.data, audit: parsedAudit.data };
}

export class PluginUpgradePlanError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PluginUpgradePlanError";
  }
}
function exactlyOneRelease(
  releases: readonly z.infer<typeof release>[], manifestId: string,
): z.infer<typeof release> {
  const matches = releases.filter((item) => item.pluginId === manifestId);
  if (matches.length !== 1 ||
      new Set(releases.map((item) => item.pluginId)).size !== releases.length) {
    throw new PluginUpgradePlanError("PLUGIN_UPGRADE_RELEASE_IDENTITY_INVALID");
  }
  return matches[0]!;
}
/**
 * Read-only fingerprint for a signed old/new release pair. This is NOT a
 * signature verifier or authorization decision. In particular, the old
 * receipt must match the operator's currently deployed immutable image.
 */
export function preparePluginUpgradeStage(
  input: OperatorUpgradeStageInput, current: unknown,
): PluginUpgradeStageDetails {
  const installedResult = installed.safeParse(current);
  const sourceResult = receipt.safeParse(input.sourceAdmission);
  const targetResult = receipt.safeParse(input.targetAdmission);
  const manifestResult = manifest.safeParse(input.targetManifest);
  if (!installedResult.success || !sourceResult.success ||
      !targetResult.success || !manifestResult.success) {
    throw new PluginUpgradePlanError("PLUGIN_UPGRADE_INVALID_INPUT");
  }
  const old = installedResult.data;
  const source = sourceResult.data;
  const target = targetResult.data;
  const next = manifestResult.data;
  if (old.id !== input.pluginId || old.manifestId !== next.id) {
    throw new PluginUpgradePlanError("PLUGIN_UPGRADE_WRONG_PLUGIN");
  }
  const fromRelease = exactlyOneRelease(source.releases, old.manifestId);
  const toRelease = exactlyOneRelease(target.releases, old.manifestId);
  if (fromRelease.version !== old.version ||
      toRelease.version !== next.version ||
      fromRelease.version === toRelease.version ||
      fromRelease.sha256 === toRelease.sha256 ||
      source.lockfileSha256 === target.lockfileSha256) {
    throw new PluginUpgradePlanError("PLUGIN_UPGRADE_STALE_RELEASE");
  }
  if (new Set(old.capabilities).size !== old.capabilities.length ||
      new Set(next.capabilities).size !== next.capabilities.length) {
    throw new PluginUpgradePlanError("PLUGIN_UPGRADE_CAPABILITIES_INVALID");
  }
  const capabilitiesAdded = next.capabilities.filter((item) =>
    !old.capabilities.includes(item)).sort();
  const capabilitiesRemoved = old.capabilities.filter((item) =>
    !next.capabilities.includes(item)).sort();
  const pins = [
    old.id, old.manifestId, fromRelease.version, toRelease.version,
    fromRelease.sha256, toRelease.sha256, source.lockfileSha256,
    target.lockfileSha256, source.publicKeySha256, target.publicKeySha256,
    capabilitiesAdded, capabilitiesRemoved,
  ];
  return {
    pluginId: old.id, manifestId: old.manifestId,
    fromVersion: fromRelease.version, toVersion: toRelease.version,
    fromArtifactSha256: fromRelease.sha256,
    toArtifactSha256: toRelease.sha256,
    fromLockfileSha256: source.lockfileSha256,
    toLockfileSha256: target.lockfileSha256,
    fromSignerSha256: source.publicKeySha256,
    toSignerSha256: target.publicKeySha256,
    capabilitiesAdded, capabilitiesRemoved,
    planSha256: createHash("sha256").update(JSON.stringify(pins)).digest("hex"),
  };
}
