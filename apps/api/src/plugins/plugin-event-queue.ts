import {
  PluginWorkerEventJobSchema, type PluginWorkerEventJob,
} from "@vibress/api-contracts";
import {
  pluginEventLedger, pluginEventJobId, PluginEventConflictError,
} from "@vibress/plugins";
import { closePluginEventRecoveryQueue } from "./plugin-event-recovery";

// Preserve the existing public/internal module exports. The API now commits
// admission in PostgreSQL; a verified worker subsequently enqueues to BullMQ.
export { pluginEventJobId, PluginEventConflictError };

export async function enqueueTrustedPluginEvent(input: PluginWorkerEventJob): Promise<string> {
  return pluginEventLedger.admit(PluginWorkerEventJobSchema.parse(input));
}

/** Legacy queue close hook retained for API shutdown compatibility.
 * The queue owner is now the trusted Worker. */
export async function closePluginEventQueue(): Promise<void> {
  await closePluginEventRecoveryQueue();
}
