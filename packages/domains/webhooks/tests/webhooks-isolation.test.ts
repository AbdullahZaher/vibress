import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, webhookEndpoints, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { DrizzleWebhookRepository } from "../src/infrastructure/drizzle-webhook-repositories.js";
import { WebhooksService } from "../src/application/webhooks-service.js";

describe("Webhooks Multi-Publication Isolation", () => {
  const db = getDb();
  const repo = new DrizzleWebhookRepository();
  const mockDispatcher = { enqueue: async () => {} };
  const service = new WebhooksService(repo, mockDispatcher);

  const runSuffix = Math.random().toString(36).substring(2, 8);
  let alphaEpId: string;
  let betaEpId: string;

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

    // Create endpoint in pub_alpha
    const alphaEp = await service.createEndpoint(
      {
        name: `Alpha Hook ${runSuffix}`,
        url: "https://alpha.example.com/webhook",
        eventTypes: ["post.published"],
      },
      null,
      "pub_alpha",
    );
    alphaEpId = alphaEp.id;

    // Create endpoint in pub_beta
    const betaEp = await service.createEndpoint(
      {
        name: `Beta Hook ${runSuffix}`,
        url: "https://beta.example.com/webhook",
        eventTypes: ["post.published"],
      },
      null,
      "pub_beta",
    );
    betaEpId = betaEp.id;
  });

  afterAll(async () => {
    await db
      .delete(webhookEndpoints)
      .where(inArray(webhookEndpoints.id, [alphaEpId, betaEpId]));
  });

  it("strictly scopes listEndpoints to the requested publication", async () => {
    const alphaList = await service.listEndpoints("pub_alpha");
    const betaList = await service.listEndpoints("pub_beta");

    const alphaIds = alphaList.map((e) => e.id);
    const betaIds = betaList.map((e) => e.id);

    expect(alphaIds).toContain(alphaEpId);
    expect(alphaIds).not.toContain(betaEpId);

    expect(betaIds).toContain(betaEpId);
    expect(betaIds).not.toContain(alphaEpId);
  });

  it("prevents cross-publication read via findEndpointById", async () => {
    const fromAlpha = await repo.findEndpointById(alphaEpId, "pub_alpha");
    expect(fromAlpha).not.toBeNull();
    expect(fromAlpha?.name).toBe(`Alpha Hook ${runSuffix}`);

    // Adversarial: reading alpha with pub_beta
    const crossRead = await repo.findEndpointById(alphaEpId, "pub_beta");
    expect(crossRead).toBeNull();
  });

  it("rejects cross-publication update and delete", async () => {
    // Adversarial: pub_beta tries to update pub_alpha's webhook
    await expect(
      service.updateEndpoint(
        alphaEpId,
        { name: "Hacked by Beta" },
        null,
        "pub_beta",
      ),
    ).rejects.toThrow("Webhook endpoint not found");

    // Adversarial: pub_beta tries to delete pub_alpha's webhook
    await expect(
      service.deleteEndpoint(alphaEpId, null, "pub_beta"),
    ).rejects.toThrow("Webhook endpoint not found");

    // Alpha webhook still exists intact
    const stillThere = await repo.findEndpointById(alphaEpId, "pub_alpha");
    expect(stillThere).not.toBeNull();
    expect(stillThere?.name).toBe(`Alpha Hook ${runSuffix}`);
  });

  it("scopes active endpoints for events by publication", async () => {
    const alphaActive = await repo.findActiveEndpointsForEvent("post.published", "pub_alpha");
    const betaActive = await repo.findActiveEndpointsForEvent("post.published", "pub_beta");

    expect(alphaActive.map((e) => e.id)).toContain(alphaEpId);
    expect(alphaActive.map((e) => e.id)).not.toContain(betaEpId);

    expect(betaActive.map((e) => e.id)).toContain(betaEpId);
    expect(betaActive.map((e) => e.id)).not.toContain(alphaEpId);
  });
});
