import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getDb, workspaces, publications, members, products, plans,
  subscriptions, plugins, pluginPublicationStates,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import {
  createHostMemberAccessSession, type PluginMemberAccessRepository,
} from "../src/application/plugin-member-access";
import { DrizzlePluginMemberAccessRepository } from "../src/infrastructure/drizzle-plugin-member-access";

const scope = {
  pluginId: "plugin-a", publicationId: "pub-a", memberId: "member-a",
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
          status: "active", currency: "USD", amountMinor: 1000, billingInterval: "month" },
        { id: id("foreign"), memberId: memberB, productId: productB, planId: planB,
          status: "active", currency: "USD", amountMinor: 1000, billingInterval: "month" },
      ]);

      const repo = new DrizzlePluginMemberAccessRepository();
      const bound = { pluginId, publicationId: pubA, memberId: memberA };
      expect(await repo.getSelf(bound)).toEqual({ id: memberA, displayName: "الطالب" });
      expect(await repo.hasActivePlan(bound, planA)).toBe(true);
      expect(await repo.hasActivePlan(bound, planB)).toBe(false);
      await expect(repo.getSelf({ ...bound, memberId: memberB }))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });
      await expect(repo.getSelf({ ...bound, publicationId: pubB }))
        .rejects.toMatchObject({ code: "EXTENSION_MEMBER_DENIED" });

      await db.update(subscriptions).set({
        status: "past_due",
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);
      await db.update(subscriptions).set({
        status: "trialing", trialEnd: new Date(Date.now() - 1000),
      }).where(eq(subscriptions.id, id("active")));
      expect(await repo.hasActivePlan(bound, planA)).toBe(false);
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
