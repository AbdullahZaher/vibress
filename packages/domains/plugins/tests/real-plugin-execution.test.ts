import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import {
  Tier2PluginSupervisor,
  Tier2SupervisorError,
  verifyPlatformIsolationSupport,
  type Tier2InvocationContext,
} from "../src/runtime/tier2-process-supervisor.js";
import type { HostCapabilityHandlers } from "../src/runtime/tier2-capability-gateway.js";

describe("Real Plugin Execution & Production Security Integration (M7.2, M7.3, M7.4, M7.7)", () => {
  const supervisorsToClean: Tier2PluginSupervisor[] = [];
  const fixtureEntrypoint = path.resolve(
    __dirname,
    "fixtures/real-standalone-plugin/dist/index.js",
  );

  afterEach(async () => {
    for (const sup of supervisorsToClean) {
      await sup.shutdownAll();
    }
    supervisorsToClean.length = 0;
  });

  describe("Real Plugin Execution Integration (M7.3)", () => {
    it("dynamically loads real plugin artifact and executes activate hook", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: ["extension.storage.read", "extension.storage.write"],
        actor: { id: "user_owner", type: "staff" },
        entrypointPath: fixtureEntrypoint,
      };

      const result = await supervisor.invoke<{ activated: boolean }>(
        context,
        "activate",
        {},
      );

      expect(result).toEqual({ activated: true });
    });

    it("executes real plugin invoke method with user payload inside isolated runtime", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: ["extension.storage.read", "extension.storage.write"],
        actor: { id: "user_owner", type: "staff" },
        entrypointPath: fixtureEntrypoint,
      };

      const response = await supervisor.invoke<{
        status: string;
        operation: string;
        received: { op: string; testVal: number };
        publicationId: string;
      }>(context, "invoke", { op: "calculate", testVal: 42 });

      expect(response.status).toBe("success");
      expect(response.received).toEqual({ op: "calculate", testVal: 42 });
      expect(response.publicationId).toBe("pub_tenant_primary");
    });

    it("executes onEvent hook and dispatches lifecycle events", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: ["extension.storage.read"],
        actor: { id: "system", type: "anonymous" },
        entrypointPath: fixtureEntrypoint,
      };

      const response = await supervisor.invoke<{
        handled: boolean;
      }>(context, "onEvent", { eventName: "post.published", payload: { postId: "post_123" } });

      expect(response.handled).toBe(true);
    });
  });

  describe("Host Capability Gateway & Multi-Tenant Authorization (M7.4)", () => {
    it("mediates storage.create and storage.get through Host using Host-derived publication scope", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const storageDb = new Map<string, unknown>();

      const handlers: HostCapabilityHandlers = {
        storageCreate: async (modelKey, id, fields) => {
          const record = { id, modelKey, version: 1, fields };
          storageDb.set(`${modelKey}:${id}`, record);
          return record;
        },
        storageGet: async (modelKey, id) => {
          return storageDb.get(`${modelKey}:${id}`) ?? null;
        },
      };

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_alpha",
        grantedCapabilities: ["extension.storage.read", "extension.storage.write"],
        actor: { id: "staff_1", type: "staff" },
        entrypointPath: fixtureEntrypoint,
      };

      // 1. Write via real plugin storage API
      const writeResult = await supervisor.invoke<{
        ok: boolean;
        created: { id: string; version: number; fields: Record<string, unknown> };
      }>(
        context,
        "invoke",
        {
          op: "write_storage",
          modelKey: "plugin_settings",
          id: "cfg_01",
          fields: { themeColor: "emerald", notificationsEnabled: true },
        },
        handlers,
      );

      expect(writeResult.ok).toBe(true);
      expect(writeResult.created.id).toBe("cfg_01");

      // 2. Read back via real plugin storage API
      const readResult = await supervisor.invoke<{
        ok: boolean;
        item: { id: string; fields: Record<string, unknown> };
      }>(
        context,
        "invoke",
        {
          op: "read_storage",
          modelKey: "plugin_settings",
          id: "cfg_01",
        },
        handlers,
      );

      expect(readResult.ok).toBe(true);
      expect(readResult.item.id).toBe("cfg_01");
      expect(readResult.item.fields).toEqual({ themeColor: "emerald", notificationsEnabled: true });
    });

    it("mediates secret retrieval when authorized by manifest capability", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const handlers: HostCapabilityHandlers = {
        secretGet: async (key) => {
          if (key === "STRIPE_WEBHOOK_SECRET") return "whsec_live_masked_secret_value_123";
          return null;
        },
      };

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_alpha",
        grantedCapabilities: ["extension.secrets.read"],
        actor: { id: "staff_1", type: "staff" },
        entrypointPath: fixtureEntrypoint,
      };

      const result = await supervisor.invoke<{
        ok: boolean;
        secret: string;
      }>(
        context,
        "invoke",
        {
          op: "read_secret",
          key: "STRIPE_WEBHOOK_SECRET",
        },
        handlers,
      );

      expect(result.ok).toBe(true);
      expect(result.secret).toBe("whsec_live_masked_secret_value_123");
    });

    it("denies ungranted capability requests fail-closed", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const handlers: HostCapabilityHandlers = {
        memberHasActivePlan: async () => true,
      };

      // Manifest grants storage only; entitlements.plan.read is omitted!
      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_alpha",
        grantedCapabilities: ["extension.storage.read"],
        actor: { id: "member_1", type: "member" },
        entrypointPath: fixtureEntrypoint,
      };

      // Real plugin attempts to call memberAccess.hasActivePlan
      const result = await supervisor.invoke<{
        error?: { code: string; message: string };
      }>(
        context,
        "invoke",
        {
          op: "unauthorized_capability_attempt",
          planId: "plan_enterprise",
        },
        handlers,
      );

      expect(result.error).toBeDefined();
      expect(result.error?.message).toMatch(/Plugin lacks required capability/i);
    });

    it("prevents cross-publication capability requests fail-closed", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const handlers: HostCapabilityHandlers = {
        storageGet: async () => ({ leaked: "attacker-read-foreign-data" }),
      };

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_legitimate_tenant",
        grantedCapabilities: ["extension.storage.read"],
        actor: { id: "staff_1", type: "staff" },
      };

      // Directly test capability with foreign publication ID attempt
      const result = await supervisor.invoke<{
        error?: { code: string; message: string };
      }>(
        context,
        "test_capability",
        {
          action: "storage.get",
          publicationId: "pub_VICTIM_TENANT", // Attacker attempts to target victim publication!
          params: { modelKey: "config", id: "keys" },
        },
        handlers,
      );

      expect(result.error).toBeDefined();
      expect(result.error?.message).toMatch(/Plugin is forbidden from requesting capabilities across publication boundaries/i);
    });
  });

  describe("Tier 2 OS-Enforced Runtime Isolation & Hardening (M7.2)", () => {
    it("fails closed when platform isolation is unavailable for untrusted execution", async () => {
      // Set operational policy forcing unsupported isolation
      process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION = "1";
      try {
        const supervisor = new Tier2PluginSupervisor({
          invocationTimeoutMs: 3000,
        });
        supervisorsToClean.push(supervisor);

        const context: Tier2InvocationContext = {
          pluginId: "com.vibress.untrusted-plugin",
          releaseDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          publicationId: "pub_test",
          grantedCapabilities: [],
          actor: { id: "test", type: "anonymous" },
          trustTier: "untrusted_marketplace",
        };

        await expect(supervisor.invoke(context, "echo", "test")).rejects.toThrowError(
          Tier2SupervisorError,
        );
      } finally {
        delete process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION;
      }
    });

    it("strictly denies child process access to Host environment secrets", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_alpha",
        grantedCapabilities: [],
        actor: { id: "test", type: "anonymous" },
        entrypointPath: fixtureEntrypoint,
      };

      const probed = await supervisor.invoke<{
        databaseUrl: string | null;
        redisUrl: string | null;
        jwtSecret: string | null;
        keyring: string | null;
      }>(context, "malicious_env_probe", {});

      expect(probed.databaseUrl).toBeNull();
      expect(probed.redisUrl).toBeNull();
      expect(probed.jwtSecret).toBeNull();
      expect(probed.keyring).toBeNull();
    });

    it("safely terminates unresponsive plugin execution and cleans up worker", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 300, // Short timeout
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_alpha",
        grantedCapabilities: [],
        actor: { id: "test", type: "anonymous" },
        entrypointPath: fixtureEntrypoint,
      };

      await expect(
        supervisor.invoke(context, "infinite_loop", {}),
      ).rejects.toThrowError(/timed out/i);

      // Verify the process was cleaned up
      const state = supervisor.getProcessState(context.pluginId);
      expect(state).toBeNull();
    });
  });
});
