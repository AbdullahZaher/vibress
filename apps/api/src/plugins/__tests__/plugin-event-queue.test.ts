import { describe, expect, it } from "vitest";
import { PluginEventEnqueueSchema, PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import { pluginEventJobId } from "../plugin-event-queue";

const base = {
  schemaVersion: 1 as const,
  scope: "publication" as const,
  publicationId: "pub-a",
  pluginId: "installed-plugin-a",
  manifestId: "example-extension",
  pluginVersion: "1.0.0",
  artifactSha256: "a".repeat(64),
  eventId: "fd1e743f-4b9d-4b45-925b-80c3765bf3e6",
  eventName: "post.published",
  payload: { key: "value" },
};

describe("EXT-401 operator event admission", () => {
  it("uses a stable BullMQ-compatible idempotency key scoped to publication and plugin", () => {
    const first = PluginWorkerEventJobSchema.parse(base);
    const same = PluginWorkerEventJobSchema.parse({ ...base });
    const differentPublication = PluginWorkerEventJobSchema.parse({
      ...base, publicationId: "pub-b",
    });
    const differentPlugin = PluginWorkerEventJobSchema.parse({
      ...base, pluginId: "installed-plugin-b",
    });
    expect(pluginEventJobId(first)).toBe(pluginEventJobId(same));
    expect(pluginEventJobId(first)).not.toBe(pluginEventJobId(differentPublication));
    expect(pluginEventJobId(first)).not.toBe(pluginEventJobId(differentPlugin));
    expect(pluginEventJobId(first)).toMatch(/^plugin-[a-f0-9]{64}$/);
  });

  it("refuses arbitrary publication selectors, unknown fields, and nested values", () => {
    expect(PluginEventEnqueueSchema.safeParse({
      eventId: base.eventId, eventName: base.eventName,
      payload: base.payload, publicationId: "pub-b",
    }).success).toBe(false);
    expect(PluginEventEnqueueSchema.safeParse({
      eventId: base.eventId, eventName: base.eventName,
      payload: { nested: { publicationId: "pub-b" } },
    }).success).toBe(false);
    expect(PluginWorkerEventJobSchema.safeParse({
      ...base, artifactSha256: "tampered",
    }).success).toBe(false);
    expect(PluginWorkerEventJobSchema.safeParse({
      ...base, scope: "system",
    }).success).toBe(false);
  });
});
