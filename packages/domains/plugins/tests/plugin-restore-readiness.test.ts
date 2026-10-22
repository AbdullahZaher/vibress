import { describe, expect, it } from "vitest";
import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import { pluginEventJobId, pluginEventEnvelopeHash } from "../src/application/plugin-event-ledger";
import { assertPluginRestoreReadiness } from "../src/application/plugin-restore-readiness";

const approved = [{ pluginId: "hello-public", version: "1.0.0",
  sha256: "a".repeat(64), adminViewCount: 0 }];
const enabled = [{ manifestId: "hello-public", version: "1.0.0" }];
const event = PluginWorkerEventJobSchema.parse({
  schemaVersion: 1, scope: "publication", publicationId: "pub-a",
  pluginId: "plugin-row-a", manifestId: "hello-public",
  pluginVersion: "1.0.0", artifactSha256: "a".repeat(64),
  eventId: "b87baf96-7459-4118-bd9f-152d70eb1cb0",
  eventName: "post.published", payload: { postId: "private-post" },
});
const pending = {
  id: pluginEventJobId(event),
  envelope: event,
  envelopeHash: pluginEventEnvelopeHash(event),
};

describe("EXT-403 operator restore release compatibility", () => {
  it("accepts a bundled-only fresh database with no approved release", () => {
    expect(assertPluginRestoreReadiness([], [], [])).toEqual({
      enabledPublications: 0, pendingEvents: 0, approvedReleases: 0,
    });
  });

  it("verifies enabled installed releases and every durable event digest", () => {
    expect(assertPluginRestoreReadiness(enabled, [pending], approved)).toEqual({
      enabledPublications: 1, pendingEvents: 1, approvedReleases: 1,
    });
  });

  it("fails when a previously enabled release is missing or changed", () => {
    expect(() => assertPluginRestoreReadiness(enabled, [], []))
      .toThrow("PLUGIN_RESTORE_ENABLED_RELEASE_UNAVAILABLE");
    expect(() => assertPluginRestoreReadiness(
      enabled, [], [{ ...approved[0]!, version: "2.0.0" }],
    )).toThrow("PLUGIN_RESTORE_ENABLED_RELEASE_UNAVAILABLE");
  });

  it("rejects pending old-digest events even if metadata version is reused", () => {
    expect(() => assertPluginRestoreReadiness(enabled, [pending], [
      { ...approved[0]!, sha256: "b".repeat(64) },
    ])).toThrow("PLUGIN_RESTORE_EVENT_RELEASE_UNAVAILABLE");
  });

  it("rejects forged event IDs, ciphertext-hash changes and invalid envelopes", () => {
    expect(() => assertPluginRestoreReadiness(enabled, [
      { ...pending, id: "plugin-" + "c".repeat(64) },
    ], approved)).toThrow("PLUGIN_RESTORE_EVENT_TAMPERED");
    expect(() => assertPluginRestoreReadiness(enabled, [
      { ...pending, envelopeHash: "b".repeat(64) },
    ], approved)).toThrow("PLUGIN_RESTORE_EVENT_TAMPERED");
    expect(() => assertPluginRestoreReadiness(enabled, [
      { ...pending, envelope: { ...event, publicationId: "" } },
    ], approved)).toThrow("PLUGIN_RESTORE_INVALID_EVENT");
  });

  it("does not accept duplicate operator approvals for the same plugin ID", () => {
    expect(() => assertPluginRestoreReadiness(enabled, [], [
      approved[0]!, approved[0]!,
    ])).toThrow("PLUGIN_RESTORE_DUPLICATE_APPROVAL");
  });
});
