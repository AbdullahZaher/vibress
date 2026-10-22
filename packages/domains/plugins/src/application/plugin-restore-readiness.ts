import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import type { VerifiedExternalRelease } from "./operator-release-preflight";
import { pluginEventEnvelopeHash, pluginEventJobId } from "./plugin-event-ledger";

/** Read-only DR admission: no plugin imports, event replay or DDL. */
export interface RestoreEnabledPlugin {
  readonly manifestId: string;
  readonly version: string;
}
export interface RestorePendingEvent {
  readonly id: string;
  readonly envelope: unknown;
  readonly envelopeHash: string;
}
export type RestoreReadinessResult = {
  readonly enabledPublications: number;
  readonly pendingEvents: number;
  readonly approvedReleases: number;
};

/** Compare an existing database with the exact, independently verified
 * operator-mounted releases before restoring service on any replica.
 * Unknown events and mismatched releases fail closed, without outputting
 * publication IDs, event payloads or user secrets. */
export function assertPluginRestoreReadiness(
  enabled: readonly RestoreEnabledPlugin[],
  events: readonly RestorePendingEvent[],
  releases: readonly VerifiedExternalRelease[],
): RestoreReadinessResult {
  const approvals = new Map(releases.map((r) => [r.pluginId, r]));
  if (approvals.size !== releases.length) {
    throw new Error("PLUGIN_RESTORE_DUPLICATE_APPROVAL");
  }
  for (const installed of enabled) {
    const approved = approvals.get(installed.manifestId);
    if (!approved || approved.version !== installed.version) {
      throw new Error("PLUGIN_RESTORE_ENABLED_RELEASE_UNAVAILABLE");
    }
  }

  for (const item of events) {
    const parsed = PluginWorkerEventJobSchema.safeParse(item.envelope);
    if (!parsed.success) {
      throw new Error("PLUGIN_RESTORE_INVALID_EVENT");
    }
    const event = parsed.data;
    if (pluginEventJobId(event) !== item.id ||
        pluginEventEnvelopeHash(event) !== item.envelopeHash) {
      throw new Error("PLUGIN_RESTORE_EVENT_TAMPERED");
    }
    const approved = approvals.get(event.manifestId);
    if (!approved || approved.version !== event.pluginVersion ||
        approved.sha256 !== event.artifactSha256) {
      throw new Error("PLUGIN_RESTORE_EVENT_RELEASE_UNAVAILABLE");
    }
  }
  return {
    enabledPublications: enabled.length,
    pendingEvents: events.length,
    approvedReleases: releases.length,
  };
}
