import { describe, expect, it } from "vitest";
import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import { pluginEventJobId, pluginEventEnvelopeHash } from "../src/application/plugin-event-ledger";
import { assessQueueRecovery } from "../src/application/plugin-queue-recovery";

const job = PluginWorkerEventJobSchema.parse({
  schemaVersion: 1, scope: "publication",
  publicationId: "pub-a", pluginId: "plugin-a", manifestId: "trusted-plugin",
  pluginVersion: "1.0.0", artifactSha256: "a".repeat(64),
  eventId: "2fb98489-8536-4a0b-b87e-4b09b6d3887d",
  eventName: "post.published", payload: { postId: "secret-post" },
});
const receipt = {
  id: pluginEventJobId(job), envelope: job,
  envelopeHash: pluginEventEnvelopeHash(job),
};
const redis = { id: receipt.id, data: job, state: "waiting" };

describe("EXT-403 read-only PostgreSQL/Redis restore reconciliation", () => {
  it("admits only matching persisted envelope and running queue states", () => {
    for (const state of [
      "waiting", "active", "delayed", "paused", "prioritized", "waiting-children",
    ]) {
      expect(assessQueueRecovery(receipt, { ...redis, state })).toBe("admitted");
    }
  });

  it("identifies operator-replay-required failures and missing Redis jobs", () => {
    expect(assessQueueRecovery(receipt, { ...redis, state: "failed" })).toBe("failed");
    expect(assessQueueRecovery(receipt, null)).toBe("missing");
    expect(assessQueueRecovery(receipt, { ...redis, state: "unknown" })).toBe("missing");
    expect(assessQueueRecovery(receipt, { ...redis, state: "completed" })).toBe("terminal");
  });

  it("rejects forged Redis job identity, payload and tenant scope", () => {
    expect(assessQueueRecovery(receipt, {
      ...redis, id: "plugin-" + "b".repeat(64),
    })).toBe("invalid");
    expect(assessQueueRecovery(receipt, {
      ...redis, data: { ...job, payload: { postId: "forged" } },
    })).toBe("invalid");
    expect(assessQueueRecovery(receipt, {
      ...redis, data: { ...job, publicationId: "pub-b" },
    })).toBe("invalid");
    expect(assessQueueRecovery(receipt, {
      ...redis, data: { ...job, eventId: "bad" },
    })).toBe("invalid");
  });

  it("detects tampered database receipts before inspecting Redis", () => {
    expect(assessQueueRecovery({
      ...receipt, envelopeHash: "c".repeat(64),
    }, redis)).toBe("invalid");
    expect(assessQueueRecovery({
      ...receipt, id: "plugin-" + "d".repeat(64),
    }, redis)).toBe("invalid");
    expect(assessQueueRecovery({
      ...receipt, envelope: { ...job, scope: "platform" },
    }, redis)).toBe("invalid");
  });

  it("excludes ephemeral distributed traceparent from durable event hashing", () => {
    expect(assessQueueRecovery(receipt, {
      ...redis, data: { ...job, traceparent: "00-a-1-01" },
    })).toBe("admitted");
  });
});
