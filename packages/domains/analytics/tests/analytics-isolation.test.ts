import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, analyticsEvents, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleAnalyticsRepository } from "../src/infrastructure/drizzle-analytics-repositories.js";

describe("Analytics Multi-Publication Isolation", () => {
  const db = getDb();
  const repo = new DrizzleAnalyticsRepository();

  const runSuffix = Math.random().toString(36).substring(2, 8);
  const alphaEventId = `alpha-event-${runSuffix}`;
  const betaEventId = `beta-event-${runSuffix}`;
  const now = new Date();
  const from = new Date(now.getTime() - 3600 * 1000);
  const to = new Date(now.getTime() + 3600 * 1000);

  beforeAll(async () => {
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();

    // Ingest event for pub_alpha
    await repo.ingest(
      {
        eventId: alphaEventId,
        eventName: "post.view",
        occurredAt: now,
        path: `/posts/alpha-${runSuffix}`,
        visitorHash: `visitor-alpha-${runSuffix}`,
        referrerDomain: "alpha-referrer.com",
        isBot: false,
      },
      "pub_alpha",
    );

    // Ingest event for pub_beta
    await repo.ingest(
      {
        eventId: betaEventId,
        eventName: "post.view",
        occurredAt: now,
        path: `/posts/beta-${runSuffix}`,
        visitorHash: `visitor-beta-${runSuffix}`,
        referrerDomain: "beta-referrer.com",
        isBot: false,
      },
      "pub_beta",
    );
  });

  afterAll(async () => {
    await db
      .delete(analyticsEvents)
      .where(inArray(analyticsEvents.eventId, [alphaEventId, betaEventId]));
  });

  it("prevents cross-publication event lookup via findEvent", async () => {
    const alphaFoundInAlpha = await repo.findEvent(alphaEventId, "pub_alpha");
    expect(alphaFoundInAlpha).toBe(true);

    // Adversarial: looking up alpha event using pub_beta
    const alphaFoundInBeta = await repo.findEvent(alphaEventId, "pub_beta");
    expect(alphaFoundInBeta).toBe(false);
  });

  it("strictly scopes distinct visitors to the requested publication", async () => {
    const alphaVisitors = await repo.countDistinctVisitors(from, to, "pub_alpha");
    const betaVisitors = await repo.countDistinctVisitors(from, to, "pub_beta");

    expect(alphaVisitors).toBeGreaterThanOrEqual(1);
    expect(betaVisitors).toBeGreaterThanOrEqual(1);
  });

  it("strictly scopes top traffic paths to the requested publication", async () => {
    const alphaPaths = await repo.getTopTrafficPaths(from, to, null, 10, "pub_alpha");
    const betaPaths = await repo.getTopTrafficPaths(from, to, null, 10, "pub_beta");

    const alphaKeys = alphaPaths.map((p) => p.key);
    const betaKeys = betaPaths.map((p) => p.key);

    expect(alphaKeys).toContain(`/posts/alpha-${runSuffix}`);
    expect(alphaKeys).not.toContain(`/posts/beta-${runSuffix}`);

    expect(betaKeys).toContain(`/posts/beta-${runSuffix}`);
    expect(betaKeys).not.toContain(`/posts/alpha-${runSuffix}`);
  });

  it("strictly scopes top referrers to the requested publication", async () => {
    const alphaRefs = await repo.getTopTrafficReferrers(from, to, 10, "pub_alpha");
    const betaRefs = await repo.getTopTrafficReferrers(from, to, 10, "pub_beta");

    const alphaRefKeys = alphaRefs.map((r) => r.key);
    const betaRefKeys = betaRefs.map((r) => r.key);

    expect(alphaRefKeys).toContain("alpha-referrer.com");
    expect(alphaRefKeys).not.toContain("beta-referrer.com");

    expect(betaRefKeys).toContain("beta-referrer.com");
    expect(betaRefKeys).not.toContain("alpha-referrer.com");
  });
});
