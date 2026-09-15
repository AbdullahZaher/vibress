import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, automations } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { DrizzleAutomationRepository } from "../infrastructure/drizzle-automation-repositories.js";
import { AutomationsService } from "../application/automations-service.js";

describe("Automations Multi-Publication Isolation", () => {
  const db = getDb();
  const repo = new DrizzleAutomationRepository();
  const mockDispatcher = {
    enqueueRun: async () => {},
    enqueueDelayedStep: async () => {},
  };
  const mockExecutor = {
    execute: async () => ({ result: { ok: true } }),
  };
  const service = new AutomationsService(repo, mockDispatcher as any, mockExecutor as any);

  const runSuffix = Math.random().toString(36).substring(2, 8);
  const sharedKey = `welcome-sequence-${runSuffix}`;
  let alphaAutoId: string;
  let betaAutoId: string;

  beforeAll(async () => {
    // Create automation in pub_alpha
    const alphaAuto = await service.createAutomation(
      {
        key: sharedKey,
        name: `Alpha Welcome Flow ${runSuffix}`,
        triggerEvent: "member.created",
        actions: [{ type: "webhook", config: { url: "https://alpha.example.com/hook" } }],
      },
      null,
      "pub_alpha",
    );
    alphaAutoId = alphaAuto.id;

    // Create automation in pub_beta with IDENTICAL key
    const betaAuto = await service.createAutomation(
      {
        key: sharedKey,
        name: `Beta Welcome Flow ${runSuffix}`,
        triggerEvent: "member.created",
        actions: [{ type: "webhook", config: { url: "https://beta.example.com/hook" } }],
      },
      null,
      "pub_beta",
    );
    betaAutoId = betaAuto.id;
  });

  afterAll(async () => {
    await db
      .delete(automations)
      .where(inArray(automations.id, [alphaAutoId, betaAutoId]));
  });

  it("coexists with identical automation key across pub_alpha and pub_beta", () => {
    expect(alphaAutoId).toBeDefined();
    expect(betaAutoId).toBeDefined();
    expect(alphaAutoId).not.toBe(betaAutoId);
  });

  it("prevents cross-publication read via findById and findByKey", async () => {
    // Query alpha with pub_alpha
    const foundAlpha = await repo.findById(alphaAutoId, "pub_alpha");
    expect(foundAlpha).not.toBeNull();
    expect(foundAlpha?.name).toBe(`Alpha Welcome Flow ${runSuffix}`);

    // Adversarial: query alpha with pub_beta returns null
    const crossId = await repo.findById(alphaAutoId, "pub_beta");
    expect(crossId).toBeNull();

    // Query by shared key returns publication-specific instance
    const keyAlpha = await repo.findByKey(sharedKey, "pub_alpha");
    expect(keyAlpha?.id).toBe(alphaAutoId);

    const keyBeta = await repo.findByKey(sharedKey, "pub_beta");
    expect(keyBeta?.id).toBe(betaAutoId);
  });

  it("strictly scopes list queries to the requested publication", async () => {
    const alphaList = await repo.list("pub_alpha");
    const betaList = await repo.list("pub_beta");

    const alphaIds = alphaList.map((a) => a.id);
    const betaIds = betaList.map((a) => a.id);

    expect(alphaIds).toContain(alphaAutoId);
    expect(alphaIds).not.toContain(betaAutoId);

    expect(betaIds).toContain(betaAutoId);
    expect(betaIds).not.toContain(alphaAutoId);
  });

  it("rejects cross-publication mutation and status changes", async () => {
    // Adversarial: pub_beta attempts to update pub_alpha's automation
    await expect(
      service.updateAutomation(
        alphaAutoId,
        { name: "Hacked by Beta" },
        null,
        "pub_beta",
      ),
    ).rejects.toThrow("Automation not found");

    // Verify alpha name unchanged
    const alphaCheck = await repo.findById(alphaAutoId, "pub_alpha");
    expect(alphaCheck?.name).toBe(`Alpha Welcome Flow ${runSuffix}`);

    // Adversarial: pub_beta attempts to activate pub_alpha's automation
    await expect(
      service.activateAutomation(alphaAutoId, null, "pub_beta"),
    ).rejects.toThrow("Automation not found");
  });

  it("scopes event triggers to the active publication", async () => {
    // Activate both
    await service.activateAutomation(alphaAutoId, null, "pub_alpha");
    await service.activateAutomation(betaAutoId, null, "pub_beta");

    // Active triggers for alpha
    const activeAlpha = await repo.listActiveByTrigger("member.created", "pub_alpha");
    expect(activeAlpha.map((a) => a.id)).toContain(alphaAutoId);
    expect(activeAlpha.map((a) => a.id)).not.toContain(betaAutoId);

    // Active triggers for beta
    const activeBeta = await repo.listActiveByTrigger("member.created", "pub_beta");
    expect(activeBeta.map((a) => a.id)).toContain(betaAutoId);
    expect(activeBeta.map((a) => a.id)).not.toContain(alphaAutoId);
  });
});
