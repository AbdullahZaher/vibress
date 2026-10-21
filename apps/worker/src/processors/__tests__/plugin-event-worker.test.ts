import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "@vibress/plugins";
import {
  PluginWorkerEventJobSchema,
  type PluginWorkerEventJob,
} from "@vibress/api-contracts";
import {
  PluginEventWorker, processTrustedPluginEvent, type PluginEventExecution,
} from "../plugin-event-worker";

const DIGEST = "a".repeat(64);
const EVENT_ID = "8aeb87e2-e61b-40e3-a201-edba8e1cd090";

function plugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "plugin-row-a",
    manifestId: "hello-public",
    name: "Hello Public",
    description: null,
    version: "1.0.0",
    vibressApiVersion: "1.0.0",
    entrypoint: "dist/index.mjs",
    capabilities: ["events.subscribe"],
    hooks: ["post.published"],
    settingsSchema: {},
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function event(overrides: Partial<PluginWorkerEventJob> = {}): PluginWorkerEventJob {
  return {
    schemaVersion: 1,
    scope: "publication",
    publicationId: "publication-a",
    pluginId: "plugin-row-a",
    manifestId: "hello-public",
    pluginVersion: "1.0.0",
    artifactSha256: DIGEST,
    eventId: EVENT_ID,
    eventName: "post.published",
    payload: { count: 1 },
    ...overrides,
  };
}

function execution(options: {
  installed?: Plugin | null;
  fingerprints?: ReadonlyMap<string, string>;
  enabled?: boolean;
  failure?: Error;
} = {}) {
  const handler: PluginEventExecution = {
    getPlugin: vi.fn(async () => options.installed === undefined ? plugin() : options.installed),
    approvedDigests: vi.fn(async () => options.fingerprints ??
      new Map([["hello-public", DIGEST]])),
    isPublicationEnabled: vi.fn(async () => options.enabled !== false),
    dispatchEvent: vi.fn(async () => {
      if (options.failure) throw options.failure;
    }),
  };
  return handler;
}

describe("EXT-401 publication-scoped durable event worker", () => {
  it("fails readiness until the trusted event consumer is started", () => {
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_LOCKFILE", "/operator/approved.json");
    try {
      expect(new PluginEventWorker().isReady()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not require a plugin consumer in bundled-only installations", () => {
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_LOCKFILE", "");
    try {
      expect(new PluginEventWorker().isReady()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects signed worker mode without a mounted trusted release", async () => {
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_LOCKFILE", "");
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE", "1");
    try {
      const worker = new PluginEventWorker();
      expect(worker.isReady()).toBe(false);
      await expect(worker.start()).rejects.toThrow(/mount required/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("executes an approved, active and explicitly enabled release with host scope", async () => {
    const h = execution();
    await expect(processTrustedPluginEvent(event(), h)).resolves.toBe("executed");
    expect(h.dispatchEvent).toHaveBeenCalledOnce();
    expect(h.dispatchEvent).toHaveBeenCalledWith(
      "plugin-row-a", "post.published",
      { count: 1, publicationId: "publication-a" }, "publication-a",
    );
  });

  it("rejects forged or oversized envelopes before any repository access", async () => {
    for (const bad of [
      { ...event(), scope: "system" },
      { ...event(), publicationId: "" },
      { ...event(), payload: { secret: { nested: true } } },
      { ...event(), payload: Object.fromEntries(Array.from({ length: 25 },
        (_, i) => ["field" + i, "value"])) },
      { ...event(), eventName: "constructor..prototype" },
      { ...event(), pluginId: "plugin-row-b" , extra: true },
    ]) {
      const h = execution();
      await expect(processTrustedPluginEvent(bad, h)).rejects.toThrow();
      expect(h.getPlugin).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["missing plugin", { installed: null }],
    ["inactive plugin", { installed: plugin({ status: "inactive" }) }],
    ["different version", { installed: plugin({ version: "2.0.0" }) }],
    ["renamed manifest", { installed: plugin({ manifestId: "other" }) }],
    ["revoked capability", { installed: plugin({ capabilities: [] }) }],
    ["undeclared hook", { installed: plugin({ hooks: [] }) }],
    ["revoked digest", { fingerprints: new Map<string, string>() }],
    ["replaced digest", { fingerprints: new Map([["hello-public", "b".repeat(64)]]) }],
    ["publication disabled", { enabled: false }],
  ] as const)("retires %s without executing old events", async (_caseName, options) => {
    const h = execution(options);
    await expect(processTrustedPluginEvent(event(), h)).resolves.toBe("retired");
    expect(h.dispatchEvent).not.toHaveBeenCalled();
  });

  it("retries genuine handler failures through BullMQ rather than swallowing them", async () => {
    const h = execution({ failure: new Error("temporary failure") });
    await expect(processTrustedPluginEvent(event(), h))
      .rejects.toThrow("temporary failure");
  });

  it("rejects malformed event IDs and unexpected payload structure", () => {
    expect(PluginWorkerEventJobSchema.safeParse(event({ eventId: "invalid" })).success).toBe(false);
    expect(PluginWorkerEventJobSchema.safeParse(event({ eventName: "onEvent" })).success).toBe(false);
    expect(PluginWorkerEventJobSchema.safeParse({
      ...event(), payload: { value: Number.POSITIVE_INFINITY },
    }).success).toBe(false);
  });
});
