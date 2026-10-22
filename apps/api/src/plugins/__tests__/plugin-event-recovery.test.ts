import { describe, it, expect, vi } from "vitest";
import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import { pluginEventJobId } from "@vibress/plugins";
import type { Plugin } from "@vibress/plugins";
import {
  PluginEventRecoveryService, PluginEventRecoveryError,
  type FailedEventQueue, type FailedEventLedger, type FailedEventAuthority,
} from "../plugin-event-recovery";

const event = PluginWorkerEventJobSchema.parse({
  schemaVersion: 1, scope: "publication",
  publicationId: "pub-a", pluginId: "row-a", manifestId: "hello-public",
  pluginVersion: "1.0.0", artifactSha256: "a".repeat(64),
  eventId: "b87baf96-7459-4118-bd9f-152d70eb1cb0",
  eventName: "post.published", payload: { postId: "post-a" },
});
const id = pluginEventJobId(event);
const plugin: Plugin = {
  id: "row-a", manifestId: "hello-public",
  name: "Hello Public", description: null, version: "1.0.0",
  vibressApiVersion: "1.0.0", entrypoint: "dist/index.mjs",
  capabilities: ["events.subscribe"], hooks: ["post.published"],
  settingsSchema: {}, status: "active",
  createdAt: new Date(), updatedAt: new Date(),
};

function fixture(options: {
  receipt?: boolean;
  state?: "failed" | "waiting" | "completed";
  receiptStatus?: "queued" | "executed" | "pending";
  changedPayload?: boolean;
  digest?: string;
  plugin?: Plugin | null;
  enabled?: boolean;
  auditAllowed?: boolean;
  retryFails?: boolean;
} = {}) {
  const job = {
    id, data: options.changedPayload
      ? { ...event, payload: { postId: "forged" } } : event,
    attemptsMade: 5,
    getState: vi.fn(async () => options.state ?? "failed"),
    retry: vi.fn(async () => {
      if (options.retryFails) throw new Error("private Redis URL");
    }),
  };
  const receipt = {
    id, status: options.receiptStatus ?? "queued" as const, job: event,
  };
  const ledger: FailedEventLedger = {
    listQueuedEventIds: vi.fn(async (pub, pluginId) =>
      pub === "pub-a" && pluginId === "row-a" && options.receipt !== false
        ? [event.eventId] : []),
    getReceipt: vi.fn(async (pub, pluginId, eventId) =>
      options.receipt === false || pub !== "pub-a" ||
      pluginId !== "row-a" || eventId !== event.eventId ? null : receipt),
    recordReplayRequest: vi.fn(async () => options.auditAllowed !== false),
  };
  const authority: FailedEventAuthority = {
    getPlugin: vi.fn(async () => options.plugin === undefined ? plugin : options.plugin),
    isPublicationEnabled: vi.fn(async () => options.enabled !== false),
    listOperatorAdminFingerprints: vi.fn(async () =>
      new Map([["hello-public", options.digest ?? "a".repeat(64)]])),
  };
  const queue: FailedEventQueue = {
    getJob: vi.fn(async () => job),
    close: vi.fn(async () => undefined),
  };
  return { service: new PluginEventRecoveryService(ledger, authority, queue),
    job, ledger, authority, queue };
}
const audit = { actorUserId: "owner", requestId: "req-a" };

describe("EXT-401 operator failed-event recovery", () => {
  it("shows only non-sensitive failed status and bounded attempt count", async () => {
    const f = fixture();
    expect(await f.service.getFailed("pub-a", "row-a", event.eventId)).toEqual({
      eventId: event.eventId, jobId: id, attemptsMade: 5, status: "failed",
    });
    expect(JSON.stringify(await f.service.getFailed("pub-a", "row-a", event.eventId)))
      .not.toContain("post-a");
  });

  it("never reveals a different publication or missing receipt", async () => {
    for (const f of [fixture(), fixture({ receipt: false })]) {
      await expect(f.service.getFailed("pub-b", "row-a", event.eventId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(f.service.getFailed("pub-a", "row-b", event.eventId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(f.authority.getPlugin).not.toHaveBeenCalled();
    }
  });

  it("rejects tampered Redis data and receipts that already terminated", async () => {
    for (const opt of [
      { changedPayload: true },
      { receiptStatus: "executed" as const },
      { state: "waiting" as const },
    ]) {
      const f = fixture(opt);
      await expect(f.service.replay("pub-a", "row-a", event.eventId, audit))
        .rejects.toBeInstanceOf(PluginEventRecoveryError);
      expect(f.ledger.recordReplayRequest).not.toHaveBeenCalled();
      expect(f.job.retry).not.toHaveBeenCalled();
    }
  });

  it("requires current active plugin, hook, capability, signature and publication enablement", async () => {
    const scenarios = [
      { plugin: { ...plugin, status: "inactive" as const } },
      { plugin: { ...plugin, version: "2.0.0" } },
      { plugin: { ...plugin, capabilities: [] } },
      { plugin: { ...plugin, hooks: [] } },
      { digest: "b".repeat(64) },
      { enabled: false },
    ];
    for (const options of scenarios) {
      const f = fixture(options);
      await expect(f.service.replay("pub-a", "row-a", event.eventId, audit))
        .rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.ledger.recordReplayRequest).not.toHaveBeenCalled();
      expect(f.job.retry).not.toHaveBeenCalled();
    }
  });

  it("writes the scoped replay-request audit before asking BullMQ to retry", async () => {
    const f = fixture();
    await f.service.replay("pub-a", "row-a", event.eventId, audit);
    expect(f.ledger.recordReplayRequest).toHaveBeenCalledWith(
      "pub-a", "row-a", event.eventId, expect.stringMatching(/^[a-f0-9]{64}$/), audit,
    );
    expect(f.job.retry).toHaveBeenCalledWith("failed");
    const audited = vi.mocked(f.ledger.recordReplayRequest).mock.invocationCallOrder[0];
    const retried = f.job.retry.mock.invocationCallOrder[0];
    if (audited === undefined || retried === undefined) {
      throw new Error("Missing replay audit or retry in test");
    }
    expect(audited).toBeLessThan(retried);
  });

  it("does not retry on denied audit; failed Redis retry remains an audited request", async () => {
    const denied = fixture({ auditAllowed: false });
    await expect(denied.service.replay("pub-a", "row-a", event.eventId, audit))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(denied.job.retry).not.toHaveBeenCalled();
    const redis = fixture({ retryFails: true });
    await expect(redis.service.replay("pub-a", "row-a", event.eventId, audit))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(redis.ledger.recordReplayRequest).toHaveBeenCalledOnce();
  });

  it("filters the failed queue by authoritative publication receipt", async () => {
    const f = fixture();
    const result = await f.service.listFailed("pub-a", "row-a", 20, 10);
    expect(result.items).toHaveLength(1);
    expect(result.nextOffset).toBe(21);
    expect(f.ledger.listQueuedEventIds).toHaveBeenCalledWith(
      "pub-a", "row-a", 20, 10,
    );
    const foreign = await f.service.listFailed("pub-b", "row-a", 0, 5);
    expect(foreign.items).toEqual([]);
    // No Redis job from another publication is ever fetched.
    expect(f.queue.getJob).toHaveBeenCalledTimes(1);
    expect(f.ledger.listQueuedEventIds).toHaveBeenCalledWith(
      "pub-b", "row-a", 0, 5,
    );
  });
});
