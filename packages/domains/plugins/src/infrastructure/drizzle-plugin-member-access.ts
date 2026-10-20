import {
  getDb, members, plans, products, subscriptions, plugins,
  pluginPublicationStates,
} from "@vibress/database";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PluginMemberSelf } from "@vibress/plugin-sdk";
import { PluginDomainError } from "../application/plugins-service";
import type {
  HostBoundMemberScope, PluginMemberAccessRepository,
} from "../application/plugin-member-access";

type ReadCapability =
  | "extension.members.self.read"
  | "extension.entitlements.plan.read";

type PluginReadTransaction =
  Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * All data and authority checks occur in the SAME transaction. The Host
 * supplies the member/tenant/plugin scope; an extension only selects an
 * opaque plan ID, never a member or publication ID. Each invocation checks
 * live capability + active plugin + publication enablement + member status.
 */
export class DrizzlePluginMemberAccessRepository implements PluginMemberAccessRepository {
  private async read<T>(
    scope: HostBoundMemberScope,
    capability: ReadCapability,
    fn: (db: PluginReadTransaction) => Promise<T>,
  ): Promise<T> {
    if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE === "1") {
      throw new PluginDomainError("EXTENSION_MEMBER_DENIED", "Member bridge unavailable");
    }
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      const [plugin] = await tx.select({
        capabilities: plugins.capabilities,
        status: plugins.status,
      }).from(plugins).where(eq(plugins.id, scope.pluginId)).for("share").limit(1);
      if (!plugin || plugin.status !== "active" ||
          !Array.isArray(plugin.capabilities) || !plugin.capabilities.includes(capability)) {
        throw new PluginDomainError("EXTENSION_MEMBER_DENIED", "Extension capability unavailable");
      }
      const [enabled] = await tx.select({
        enabled: pluginPublicationStates.enabled,
      }).from(pluginPublicationStates).where(and(
        eq(pluginPublicationStates.pluginId, scope.pluginId),
        eq(pluginPublicationStates.publicationId, scope.publicationId),
        eq(pluginPublicationStates.enabled, true),
      )).for("share").limit(1);
      if (!enabled?.enabled) {
        throw new PluginDomainError("EXTENSION_MEMBER_DENIED", "Extension disabled in publication");
      }
      // Recheck on every call, including a session that became stale while
      // the HTTP extension handler awaited another operation.
      const [member] = await tx.select({
        id: members.id, name: members.name,
      }).from(members).where(and(
        eq(members.id, scope.memberId),
        eq(members.publicationId, scope.publicationId),
        eq(members.status, "active"),
      )).for("share").limit(1);
      if (!member) {
        throw new PluginDomainError("EXTENSION_MEMBER_DENIED", "Member unavailable");
      }
      return fn(tx);
    });
  }

  async getSelf(scope: HostBoundMemberScope): Promise<PluginMemberSelf | null> {
    return this.read(scope, "extension.members.self.read", async (db) => {
      const [member] = await db.select({
        id: members.id, displayName: members.name,
      }).from(members).where(and(
        eq(members.id, scope.memberId),
        eq(members.publicationId, scope.publicationId),
        eq(members.status, "active"),
      )).limit(1);
      return member ?? null;
    });
  }

  async hasActivePlan(scope: HostBoundMemberScope, planId: string): Promise<boolean> {
    return this.read(scope, "extension.entitlements.plan.read", async (db) => {
      const [record] = await db.select({ id: subscriptions.id })
        .from(subscriptions)
        .innerJoin(plans, and(
          eq(subscriptions.planId, plans.id),
          eq(plans.publicationId, scope.publicationId),
        ))
        .innerJoin(products, and(
          eq(subscriptions.productId, products.id),
          eq(plans.productId, products.id),
          eq(products.publicationId, scope.publicationId),
        ))
        .where(and(
          eq(subscriptions.memberId, scope.memberId),
          eq(subscriptions.planId, planId),
          eq(plans.status, "active"),
          eq(products.status, "active"),
          isNull(plans.archivedAt),
          isNull(products.archivedAt),
          inArray(subscriptions.status, ["active", "trialing"]),
          sql`(${subscriptions.currentPeriodStart} IS NULL OR ${subscriptions.currentPeriodStart} <= now())`,
          sql`(${subscriptions.currentPeriodEnd} IS NULL OR ${subscriptions.currentPeriodEnd} > now())`,
          // A trial with NO end date is not evidence of an ongoing
          // entitlement. Require a future trial or billing period end.
          sql`(${subscriptions.status} <> 'trialing' OR
            ${subscriptions.trialEnd} > now() OR
            ${subscriptions.currentPeriodEnd} > now())`,
          sql`${subscriptions.endedAt} IS NULL`,
        )).limit(1);
      return Boolean(record);
    });
  }
}
