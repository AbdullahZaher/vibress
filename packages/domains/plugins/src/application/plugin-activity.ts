import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, auditEvents, pluginEventReceipts } from "@vibress/database";

/**
 * PLUG-OPS-06. Curated, publication-scoped historical actions backed by the
 * existing append-only audit table. No payloads, metadata, identities, IPs,
 * request IDs, secret setting keys or actor IDs are selected or serialized.
 *
 * Replays are joined to their authoritative publication/plugin receipt,
 * never authorized by editable audit metadata or caller-supplied tenant IDs.
 */
export type PluginActivityAction =
  | "plugin.publication_settings_updated"
  | "plugin.publication_secret_revoked"
  | "plugin.event_replay_requested";

const settingActions = [
  "plugin.publication_settings_updated",
  "plugin.publication_secret_revoked",
] as const;

export interface PluginActivityRow {
  readonly action: PluginActivityAction;
  readonly createdAt: string;
}
export interface PluginActivityResult {
  readonly items: PluginActivityRow[];
  readonly nextOffset: number | null;
}

function parseAction(action: string): PluginActivityAction {
  if (action === "plugin.publication_settings_updated" ||
      action === "plugin.publication_secret_revoked" ||
      action === "plugin.event_replay_requested") return action;
  throw new Error("PLUGIN_ACTIVITY_INVALID_ACTION");
}

/**
 * The caller MUST first authorize the staff session, plugins.manage,
 * platform operator and authoritative publication owner/admin context.
 * Never accept tenant ID as an HTTP parameter.
 */
export async function listPluginActivity(
  publicationId: string, pluginId: string, offset: number, limit: number,
): Promise<PluginActivityResult> {
  if (!publicationId || publicationId.length > 200 ||
      !pluginId || pluginId.length > 200 ||
      !Number.isInteger(offset) || offset < 0 || offset > 10000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("PLUGIN_ACTIVITY_INVALID_QUERY");
  }
  const rows = await getDb().select({
    action: auditEvents.action,
    createdAt: auditEvents.createdAt,
  }).from(auditEvents).where(and(
    eq(auditEvents.publicationId, publicationId),
    or(
      and(
        inArray(auditEvents.action, [...settingActions]),
        eq(auditEvents.targetType, "plugin"),
        eq(auditEvents.targetId, pluginId),
      ),
      and(
        eq(auditEvents.action, "plugin.event_replay_requested"),
        eq(auditEvents.targetType, "plugin_event"),
        sql`EXISTS (
          SELECT 1 FROM ${pluginEventReceipts}
          WHERE ${pluginEventReceipts.id} = ${auditEvents.targetId}
            AND ${pluginEventReceipts.pluginId} = ${pluginId}
            AND ${pluginEventReceipts.publicationId} = ${publicationId}
        )`,
      ),
    ),
  )).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1).offset(offset);
  return {
    items: rows.slice(0, limit).map(row => ({
      action: parseAction(row.action),
      createdAt: row.createdAt.toISOString(),
    })),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}
