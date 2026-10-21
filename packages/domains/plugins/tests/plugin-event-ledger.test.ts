import { describe, expect, it } from "vitest";
import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import {
  pluginEventJobId, pluginEventEnvelopeHash,
} from "../src/application/plugin-event-ledger";

const job = PluginWorkerEventJobSchema.parse({
  schemaVersion: 1, scope: "publication",
  publicationId: "pub-a", pluginId: "plugin-id-a",
  manifestId: "hello-public", pluginVersion: "1.0.0",
  artifactSha256: "a".repeat(64),
  eventId: "b87baf96-7459-4118-bd9f-152d70eb1cb0",
  eventName: "post.published", payload: { postId: "content-a" },
});

describe("EXT-401 durable admission identity", () => {
  it("binds the event ID to publication AND installed plugin", () => {
    expect(pluginEventJobId(job)).toMatch(/^plugin-[a-f0-9]{64}$/);
    expect(pluginEventJobId(job)).toBe(pluginEventJobId({ ...job }));
    expect(pluginEventJobId(job)).not.toBe(pluginEventJobId({
      ...job, publicationId: "pub-b",
    }));
    expect(pluginEventJobId(job)).not.toBe(pluginEventJobId({
      ...job, pluginId: "plugin-id-b",
    }));
  });

  it("binds immutable payload/release while excluding tracing metadata", () => {
    const hash = pluginEventEnvelopeHash(job);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(pluginEventEnvelopeHash({ ...job, traceparent:
      "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01" })).toBe(hash);
    expect(pluginEventEnvelopeHash({ ...job, payload: { postId: "content-b" } }))
      .not.toBe(hash);
    expect(pluginEventEnvelopeHash({ ...job, artifactSha256: "b".repeat(64) }))
      .not.toBe(hash);
  });

  it("rejects forged publication fields and nested payloads before hashing", () => {
    expect(() => pluginEventEnvelopeHash({
      ...job, payload: { publicationId: "pub-b" },
    })).toThrow();
    expect(() => pluginEventEnvelopeHash({
      ...job, payload: { details: { deep: "value" } },
    })).toThrow();
  });
});
