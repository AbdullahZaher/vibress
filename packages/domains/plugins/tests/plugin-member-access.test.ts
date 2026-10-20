import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getDb, getDbPool, schema, workspaces, publications, members, products, plans,
  subscriptions, plugins, pluginPublicationStates, auditEvents,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  createHostMemberAccessSession, type PluginMemberAccessRepository,
} from "../src/application/plugin-member-access";
import { DrizzlePluginMemberAccessRepository } from "../src/infrastructure/drizzle-plugin-member-access";

const scope = {
  pluginId: "plugin-a", publicationId: "pub-a", memberId: "member-a",
  requestId: "req-member-test",
};

describe("EXT-204 Host member bridge", () => {
  it("keeps tenant/member selectors inside the Host and drains reads before closure", async () => {
    let release: ((v: { id: string; displayName: string | null }) => void) | undefined;
    const getSelf = vi.fn<PluginMemberAccessRepository["getSelf"]>(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const hasActivePlan = vi.fn<PluginMemberAccessRepository["hasActivePlan"]>(
      async () => false,
    );
    const session = createHostMemberAccessSession(scope, { getSelf, hasActivePlan });
    expect(Object.isFrozen(session.memberAccess)).toBe(true);
    const read = session.memberAccess.getSelf();
    const closed = session.close();
    expect(release).toBeDefined();
    await expect(session.memberAccess.hasActivePlan("plan-a"))
      .rejects.toMatchObject({ code: "EXTENSION_MEMBER_SESSION_CLOSED" });
    release?.({ id: "member-a", displayName: "طالب" });
    expect(await read).toEqual({ id: "member-a", displayName: "طالب" });
    await closed;
    expect(getSelf).toHaveBeenCalledWith(scope);
    expect(hasActivePlan).not.toHaveBeenCalled();
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("rejects forged selectors and invalid plan IDs", async () => {
    const repo: PluginMemberAccessRepository = {
      getSelf: async () => null, hasActivePlan: async () => false,
    };
    expect(() => createHostMemberAccessSession({
      ...scope, memberId: "../fake",
    }, repo)).toThrow();
    const s = createHostMemberAccessSession(scope, repo);
    await expect(s.memberAccess.hasActivePlan("../fake"))
      .rejects.toMatchObject({ code: "EXTENSION_PLAN_INVALID" });
    await s.close();
  });

  it("fails closed across publications, status, capability and expired billing", async () => {
    const db = getDb();
    const suffix = randomUUID().replaceAll("-", "");
    const wsId = "ws-ext204-" + suffix;
    const pubA = "pub-ext204-a-" + suffix;
    const pubB = "pub-ext204-b-" + suffix;
    const pluginId = "plugin-ext204-" + suffix;
    const memberA = "member-ext204-a-" + suffix;
    const memberB = "member-ext204-b-" + suffix;
    const productA = "product-ext204-a-" + suffix;
    const productB = "product-ext204-b-" + suffix;
    const planA = "plan-ext204-a-" + suffix;
    const planB = "plan-ext204-b-" + suffix;
    const id = (value: string) => value + "-" + suffix;
    try {
      await db.insert(workspaces).values({
        id: wsId, slug: wsId, name: "EXT204 test workspace",
      });
      await db.insert(publications).values([
        { id: pubA, workspaceId: wsId, slug: "a", name: "A" },
        { id: pubB, workspaceId: wsId, slug: "b", name: "B" },
      ]);
      await db.insert(members).values([
        { id: memberA, publicationId: pubA, email: id("a") + "@example.test",
          emailNormalized: id("a") + "@example.test", name: "الطالب", status: "active" },
        { id: memberB, publicationId: pubB, email: id("b") + "@example.test",
          emailNormalized: id("b") + "@example.test", name: "Other", status: "active" },
      ]);
      await db.insert(plugins).values({
        id: pluginId, manifestId: "ext204-" + suffix, name: "EXT204",
        version: "1.0.0", vibressApiVersion: "1.0.0", entrypoint: "index.mjs",
        capabilities: ["extension.members.self.read", "extension.entitlements.plan.read"],
        status: "active",
      });
      await db.insert(pluginPublicationStates).values([
        { pluginId, publicationId: pubA, enabled: true },
        { pluginId, publicationId: pubB, enabled: true },
      ]);
      await db.insert(products).values([
        { id: productA, publicationId: pubA, key: "courses", name: "Courses" },
        { id: productB, publicationId: pubB, key: "courses", name: "Courses B" },
      ]);
      await db.insert(plans).values([
        { id: planA, publicationId: pubA, productId: productA,
          key: "monthly", name: "Monthly", currency: "USD", amountMinor: 1000 },
        { id: planB, publicationId: pubB, productId: productB,
          key: "monthly", name: "Monthly B", currency: "USD", amountMinor: 1000 },
      ]);
      await db.insert(subscriptions).values([
        { id: id("active"), memberId: memberA, productId: productA, planId: planA,
          status: "active", currency: "USD", amountMinor: 1000,
          billingInterval: "month", currentPeriodEnd: new Date(Date.now() + 3600_000) },
        { id: id("foreign"), memberId: memberB, productId: productB, planId: planB,
          status: "active", currency: "USD", amountMinor: 1000,
          billingInterval: "month", currentPeriodEnd: new Date(Date.now() + 3600_000) },
      ]);

      const repo = new DrizzlePluginMemberAccessRepository();
      const bound = {
        pluginId, publicationId: pubA, memberId: memberA,
        requestId: "req-ext204-" + suffix,
      };
      expect(await repo.getSelf(bound)).toEqual({ id: memberA, displayName: "الطالب" });
      expect(await repo.hasActivePlan(bound, planA)).toBe(true);
      expect(await repo.hasActivePlan(bound, planB)).toBe(false);
      const auditRows = await db.select().from(auditEvents)
        .where(eq(auditEvents.requestId, bound.requestId));
      expect(auditRows).toHaveLength(2);
      const decisions = auditRows.map((entry) =>
        (entry.metadata as { granted?: boolean } | null)?.granted,
      ).sort();
      expect(decisions).toEqual([false, true]);
      for (const entry of auditRows) {
        expect(entry).toMatchObject({
          action: "plugin.member.plan_checked", publicationId: pubA,
          requestId: bound.requestId, actorUserId: null,
          targetType: "member.plan",
        });
        expect(entry.targetId).toMatch(/^[a-f0-9]{64}$/);
      }
      const auditText = JSON.stringify(auditRows);
      expect(auditText).not.toContain(memberA);
      expect(auditText).not.toContain("الطالب");
      expect(auditText).not.toContain(id("a") + "@example.test");

      // An unavailable audit sink must FAIL CLOSED rather than returning
      // true without creating an audit record. Use one dedicated PG session
      // with a transaction-local temporary shadow of the audit table.
      const client = await getDbPool().connect();
      try {
        await client.query(`
          CREATE TEMP TABLE audit_events (
            LIKE public.audit_events INCLUDING DEFAULTS,
            CONSTRAINT reject_plan_audits CHECK (false)
          )
        `);
        const withFailedAudit = new DrizzlePluginMemberAccessRepository(
          () => drizzle(client, { schema }),
        );
        await expect(withFailedAudit.hasActivePlan(bound, planA)).rejects.toThrow();
        expect((await db.select({ id: auditEvents.id }).from(auditEvents)
          .where(eq(auditEvents.requestId, bound.requestId)))).toHaveLength(2);
      } finally {
        await client.query("DROP TABLE IF EXISTS pg_temp.audit_events");
        client.release();
      }
      await expect(repo.getSelf({ ...bound, memberId: memberB }))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });
      await expect(repo.getSelf({ ...bound, publicationId: pubB }))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });

      await db.update(subscriptions).set({ currentPeriodEnd: null })
        .where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);
      await db.update(subscriptions).set({
        status: "past_due", currentPeriodEnd: new Date(Date.now() + 3600_000),
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);
      await db.update(subscriptions).set({
        status: "trialing", trialEnd: new Date(Date.now() - 1000),
      }).where(eq(subscriptions.id, id("active")));
      // A past authoritative trial end defeats a future billing period end.
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);
      await db.update(subscriptions).set({
        trialEnd: null, currentPeriodEnd: new Date(Date.now() + 3600_000),
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(true);
      await db.update(subscriptions).set({
        status: "trialing", trialEnd: null, currentPeriodEnd: null,
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);
      await db.update(subscriptions).set({
        status: "trialing", trialEnd: new Date(Date.now() + 3600_000),
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(true);
      await db.update(subscriptions).set({
        status: "active", trialEnd: null,
        currentPeriodEnd: new Date(Date.now() - 1000),
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);

      // Free checkout persists an active subscription with no period end.
      // Only that specific free/no-provider/zero-cost combination persists.
      await db.update(plans).set({ billingType: "free", amountMinor: 0 })
        .where(eq(plans.id, planA));
      await db.update(subscriptions).set({
        amountMinor: 0, provider: null, currentPeriodEnd: null,
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(true);
      await db.update(subscriptions).set({ provider: "stripe" })
        .where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);

      await db.update(plugins).set({
        capabilities: ["extension.members.self.read"],
      }).where(eq(plugins.id, pluginId));
      await expect(repo.hasActivePlan(bound, planA))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });
      expect(await repo.getSelf(bound)).toMatchObject({ id: memberA });
      await db.update(members).set({ status: "disabled" })
        .where(eq(members.id, memberA));
      await expect(repo.getSelf(bound))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });
      await db.update(pluginPublicationStates).set({ enabled: false })
        .where(eq(pluginPublicationStates.publicationId, pubA));
      await expect(repo.getSelf(bound))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });
    } finally {
      await db.delete(auditEvents).where(eq(auditEvents.requestId, "req-ext204-" + suffix));
      await db.delete(subscriptions).where(eq(subscriptions.memberId, memberA));
      await db.delete(subscriptions).where(eq(subscriptions.memberId, memberB));
      await db.delete(plans).where(eq(plans.publicationId, pubA));
      await db.delete(plans).where(eq(plans.publicationId, pubB));
      await db.delete(products).where(eq(products.publicationId, pubA));
      await db.delete(products).where(eq(products.publicationId, pubB));
      await db.delete(members).where(eq(members.id, memberA));
      await db.delete(members).where(eq(members.id, memberB));
      await db.delete(pluginPublicationStates).where(eq(pluginPublicationStates.pluginId, pluginId));
      await db.delete(plugins).where(eq(plugins.id, pluginId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
  });
});
