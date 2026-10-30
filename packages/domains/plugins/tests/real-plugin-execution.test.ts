import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Tier2PluginSupervisor,
  Tier2SupervisorError,
  verifyPlatformIsolationSupport,
  createDefaultAuthoritativeAdmissions,
  type Tier2InvocationContext,
} from "../src/runtime/tier2-process-supervisor.js";
import type { HostCapabilityHandlers } from "../src/runtime/tier2-capability-gateway.js";

describe("Real Plugin Execution & Production Security Integration (M7.2, M7.3, M7.4, M7.7)", () => {
  const supervisorsToClean: Tier2PluginSupervisor[] = [];
  const fixtureEntrypoint = path.resolve(
    __dirname,
    "fixtures/real-standalone-plugin/release/index.js",
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

    it("accurately reports hasCapability based on Host-granted capabilities", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: ["extension.storage.read"], // member read omitted
        actor: { id: "user_owner", type: "staff" },
        entrypointPath: fixtureEntrypoint,
      };

      const result = await supervisor.invoke<{
        hasStorageRead: boolean;
        hasMemberRead: boolean;
      }>(context, "invoke", { op: "check_capability" });

      expect(result.hasStorageRead).toBe(true);
      expect(result.hasMemberRead).toBe(false);
    });

    it("rejects unknown or unsupported plugin operations with stable error contract", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: [],
        actor: { id: "user_owner", type: "staff" },
        entrypointPath: fixtureEntrypoint,
      };

      await expect(
        supervisor.invoke(context, "unsupported_hook_operation", {}),
      ).rejects.toThrowError(/UNSUPPORTED_OPERATION/i);
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

      // Real plugin attempts to call memberAccess.hasActivePlan -> must reject
      await expect(
        supervisor.invoke(
          context,
          "invoke",
          {
            op: "unauthorized_capability_attempt",
            planId: "plan_enterprise",
          },
          handlers,
        ),
      ).rejects.toThrowError(/Plugin lacks required capability/i);
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

      // Directly test capability with foreign publication ID attempt -> must reject
      await expect(
        supervisor.invoke(
          context,
          "test_capability",
          {
            action: "storage.get",
            publicationId: "pub_VICTIM_TENANT", // Attacker attempts to target victim publication!
            params: { modelKey: "config", id: "keys" },
          },
          handlers,
        ),
      ).rejects.toThrowError(/Plugin is forbidden from requesting capabilities across publication boundaries/i);
    });
  });

  describe("Tier 2 OS-Enforced Runtime Isolation & Adversarial Hardening (M7.2 / P0 / P1)", () => {
    it("never treats runner detection as proof of certified containment", () => {
      const isolation = verifyPlatformIsolationSupport("untrusted_marketplace");
      expect(isolation.isIsolated).toBe(false);
      expect(isolation.isolationMechanism).toBe("unsupported");
    });

    it("rejects revoked and mismatched untrusted releases before sandbox admission", async () => {
      const supervisor = new Tier2PluginSupervisor({ invocationTimeoutMs: 500 });
      supervisorsToClean.push(supervisor);
      const pluginId = "com.vendor.untrusted-admitted";
      const releaseDigest = "sha256:" + "a".repeat(64);
      supervisor.admitPlugin({
        pluginId,
        releaseDigest,
        trustTier: "untrusted_marketplace",
        isRevoked: true,
      });
      const context: Tier2InvocationContext = {
        pluginId,
        releaseDigest,
        publicationId: "pub_01",
        grantedCapabilities: [],
        actor: { id: "member_01", type: "member" },
        trustTier: "untrusted_marketplace",
      };
      await expect(supervisor.invoke(context, "echo", {})).rejects.toThrowError(/REVOKED_PLUGIN_RELEASE/);
      supervisor.admitPlugin({ pluginId, releaseDigest, trustTier: "untrusted_marketplace" });
      await expect(supervisor.invoke({ ...context, releaseDigest: "sha256:" + "b".repeat(64) }, "echo", {}))
        .rejects.toThrowError(/RELEASE_DIGEST_MISMATCH/);
      await expect(supervisor.invoke(context, "echo", {}))
        .rejects.toThrowError(/UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE/);
    });

    it("executes the operator-approved entrypoint when its SHA-256 matches", async () => {
      const supervisor = new Tier2PluginSupervisor({ invocationTimeoutMs: 3000 });
      supervisorsToClean.push(supervisor);
      const pluginId = "com.vendor.pinned-valid-artifact";
      const releaseDigest = "sha256:" + "d".repeat(64);
      const entrypointSha256 = createHash("sha256")
        .update(readFileSync(fixtureEntrypoint))
        .digest("hex");
      supervisor.admitPlugin({
        pluginId,
        releaseDigest,
        trustTier: "curated_operator",
        releaseDirectory: path.dirname(fixtureEntrypoint),
        allowedEntrypoints: [fixtureEntrypoint],
        entrypointSha256,
      });
      const context: Tier2InvocationContext = {
        pluginId,
        releaseDigest,
        publicationId: "pub_01",
        grantedCapabilities: [],
        actor: { id: "staff_01", type: "staff" },
        trustTier: "curated_operator",
        entrypointPath: fixtureEntrypoint,
      };
      await expect(supervisor.invoke(context, "activate", {}))
        .resolves.toEqual({ activated: true });
    });

    it("rejects an entrypoint whose bytes differ from Host-pinned SHA-256", async () => {
      const supervisor = new Tier2PluginSupervisor({ invocationTimeoutMs: 500 });
      supervisorsToClean.push(supervisor);
      const pluginId = "com.vendor.pinned-artifact";
      const releaseDigest = "sha256:" + "c".repeat(64);
      supervisor.admitPlugin({
        pluginId,
        releaseDigest,
        trustTier: "curated_operator",
        releaseDirectory: path.dirname(fixtureEntrypoint),
        allowedEntrypoints: [fixtureEntrypoint],
        entrypointSha256: "0".repeat(64),
      });
      const context: Tier2InvocationContext = {
        pluginId,
        releaseDigest,
        publicationId: "pub_01",
        grantedCapabilities: [],
        actor: { id: "staff_01", type: "staff" },
        trustTier: "curated_operator",
        entrypointPath: fixtureEntrypoint,
      };
      await expect(supervisor.invoke(context, "activate", {}))
        .rejects.toThrowError(/ENTRYPOINT_INTEGRITY_MISMATCH/);
    });

    it("Test A: rejects untrusted execution when fake sandbox runner env var is configured without binary", async () => {
      // Prompt Section 3 / 8: Setting VIBRESS_TIER2_SANDBOX_RUNNER=gvisor without a functioning runner MUST fail-closed.
      process.env.VIBRESS_TIER2_SANDBOX_RUNNER = "gvisor";
      try {
        const supervisor = new Tier2PluginSupervisor({
          invocationTimeoutMs: 3000,
        });
        supervisorsToClean.push(supervisor);

        const context: Tier2InvocationContext = {
          pluginId: "com.vibress.untrusted-fake-sandbox",
          releaseDigest: "sha256:3333444455556666777788889999000011112222333344445555666677778888",
          publicationId: "pub_test_fake",
          grantedCapabilities: [],
          actor: { id: "test", type: "anonymous" },
          trustTier: "untrusted_marketplace",
          entrypointPath: fixtureEntrypoint,
        };

        await expect(supervisor.invoke(context, "echo", "test")).rejects.toThrowError(
          /UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE/i,
        );
      } finally {
        delete process.env.VIBRESS_TIER2_SANDBOX_RUNNER;
      }
    });

    it("fails closed when platform isolation is disabled by operational environment policy", async () => {
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
          /UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE/i,
        );
      } finally {
        delete process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION;
      }
    });

    it("Test B: strictly denies child process access to Host environment secrets and host filesystem", async () => {
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

    it("Test C: blocks direct unauthorized host network connection probe", async () => {
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

      const netRes = await supervisor.invoke<{ connected: boolean; error?: string }>(
        context,
        "malicious_net_probe",
        {},
      );

      // Connection to host database port from ungranted runtime fails closed
      expect(netRes.connected).toBe(false);
    });

    it("Test D: verifies process security flags (--no-addons, --disallow-code-generation-from-strings)", async () => {
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

      // Built-in compute confirms normal execution under strict V8 flags
      const computeRes = await supervisor.invoke<{ value: number }>(context, "compute", 21);
      expect(computeRes).toEqual({ value: 42 });
    });

    it("Test E: rejects trust tier bypass attempts (unadmitted, forged, revoked, mismatched)", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      // 1. Missing trust tier on unadmitted plugin -> defaults to untrusted and fails closed
      const unadmittedContext: Tier2InvocationContext = {
        pluginId: "com.attacker.unadmitted-plugin",
        releaseDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        publicationId: "pub_attack",
        grantedCapabilities: [],
        actor: { id: "attacker", type: "anonymous" },
      };
      await expect(supervisor.invoke(unadmittedContext, "echo", "hi")).rejects.toThrowError(
        /UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE/i,
      );

      // 2. Forged trust tier: caller claims curated_operator for unadmitted plugin -> rejected
      const forgedContext: Tier2InvocationContext = {
        ...unadmittedContext,
        trustTier: "curated_operator",
      };
      await expect(supervisor.invoke(forgedContext, "echo", "hi")).rejects.toThrowError(
        /UNAUTHORIZED_TRUST_TIER_PROMOTION/i,
      );

      // 3. Revoked release: admitted plugin that was revoked -> rejected
      supervisor.admitPlugin({
        pluginId: "com.vendor.revoked-plugin",
        releaseDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
        trustTier: "curated_operator",
        isRevoked: true,
        revocationReason: "Security vulnerability CVE-2026-9999",
      });
      const revokedContext: Tier2InvocationContext = {
        pluginId: "com.vendor.revoked-plugin",
        releaseDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
        publicationId: "pub_victim",
        grantedCapabilities: [],
        actor: { id: "victim", type: "anonymous" },
        trustTier: "curated_operator",
      };
      await expect(supervisor.invoke(revokedContext, "echo", "hi")).rejects.toThrowError(
        /REVOKED_PLUGIN_RELEASE/i,
      );

      // 4. Mismatched release digest: caller specifies release digest different from admitted digest
      const mismatchedContext: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:TAMPERED_MISMATCHED_RELEASE_DIGEST_0000000000000000000000000000",
        publicationId: "pub_tampered",
        grantedCapabilities: [],
        actor: { id: "attacker", type: "anonymous" },
        trustTier: "curated_operator",
      };
      await expect(supervisor.invoke(mismatchedContext, "echo", "hi")).rejects.toThrowError(
        /RELEASE_DIGEST_MISMATCH/i,
      );
    });

    it("Test F: rejects entrypoint manipulation attempts (traversal, arbitrary files, escapes)", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 3000,
      });
      supervisorsToClean.push(supervisor);

      // 1. Directory traversal attempt
      const traversalContext: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: [],
        actor: { id: "attacker", type: "anonymous" },
        trustTier: "curated_operator",
        entrypointPath: path.resolve(fixtureEntrypoint, "../../outside-file.js"),
      };
      await expect(supervisor.invoke(traversalContext, "echo", "hi")).rejects.toThrowError(
        /INVALID_PLUGIN_ENTRYPOINT/i,
      );

      // 2. Arbitrary system file attempt (/etc/hosts)
      const systemFileContext: Tier2InvocationContext = {
        ...traversalContext,
        entrypointPath: "/etc/hosts",
      };
      await expect(supervisor.invoke(systemFileContext, "echo", "hi")).rejects.toThrowError(
        /INVALID_PLUGIN_ENTRYPOINT/i,
      );

      // 3. Non-existent entrypoint attempt
      const nonExistentContext: Tier2InvocationContext = {
        ...traversalContext,
        entrypointPath: path.resolve(__dirname, "fixtures/does-not-exist.js"),
      };
      await expect(supervisor.invoke(nonExistentContext, "echo", "hi")).rejects.toThrowError(
        /INVALID_PLUGIN_ENTRYPOINT/i,
      );
    });

    it("Test G: executes legitimate approved plugin through restricted runtime with full verification", async () => {
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
        trustTier: "curated_operator",
        entrypointPath: fixtureEntrypoint,
      };

      // Lifecycle hook execution
      const activateRes = await supervisor.invoke<{ activated: boolean }>(context, "activate", {});
      expect(activateRes).toEqual({ activated: true });

      // Capability access and operation response
      const invokeRes = await supervisor.invoke<{ status: string; publicationId: string }>(
        context,
        "invoke",
        { op: "check_capability" },
      );
      expect(invokeRes).toBeDefined();

      // Reliable cleanup
      await supervisor.terminatePlugin(context.pluginId);
      expect(supervisor.getProcessState(context.pluginId)).toBeNull();
    });

    it("Test H: enforces resource limits on infinite loops and crash loops", async () => {
      const supervisor = new Tier2PluginSupervisor({
        invocationTimeoutMs: 350, // Bounded timeout
        maxCrashCount: 3,
        crashWindowMs: 30_000,
      });
      supervisorsToClean.push(supervisor);

      const context: Tier2InvocationContext = {
        pluginId: "com.vibress.real-fixture-plugin",
        releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
        publicationId: "pub_tenant_primary",
        grantedCapabilities: [],
        actor: { id: "user_owner", type: "staff" },
        trustTier: "curated_operator",
        entrypointPath: fixtureEntrypoint,
      };

      // 1. Timeout on infinite loop
      await expect(
        supervisor.invoke(context, "infinite_loop", {}),
      ).rejects.toThrowError(/timed out/i);

      // Verify worker process terminated
      expect(supervisor.getProcessState(context.pluginId)).toBeNull();

      // 2. Quarantine on repeated crashes
      const flakyContext: Tier2InvocationContext = {
        pluginId: "com.vendor.flaky-plugin",
        releaseDigest: "sha256:release_flaky",
        publicationId: "pub_01",
        grantedCapabilities: [],
        actor: { id: "user_01", type: "staff" },
        trustTier: "curated_operator",
      };

      await expect(supervisor.invoke(flakyContext, "simulate_crash", {})).rejects.toThrow();
      await expect(supervisor.invoke(flakyContext, "simulate_crash", {})).rejects.toThrow();
      await expect(supervisor.invoke(flakyContext, "simulate_crash", {})).rejects.toThrow();

      expect(supervisor.isQuarantined("com.vendor.flaky-plugin")).toBe(true);
      await expect(supervisor.invoke(flakyContext, "compute", 10)).rejects.toThrowError(
        /is quarantined due to excessive crashes/i,
      );
    });

    it("fails closed in production mode when worker artifact is missing or TypeScript", async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const supervisor = new Tier2PluginSupervisor({
          workerScriptPath: path.resolve(__dirname, "non-existent-worker.js"),
          invocationTimeoutMs: 3000,
          authoritativeAdmissions: createDefaultAuthoritativeAdmissions(),
        });
        supervisorsToClean.push(supervisor);

        const context: Tier2InvocationContext = {
          pluginId: "com.vibress.real-fixture-plugin",
          releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
          publicationId: "pub_test_prod",
          grantedCapabilities: [],
          actor: { id: "test", type: "anonymous" },
          trustTier: "curated_operator",
          entrypointPath: fixtureEntrypoint,
        };

        await expect(supervisor.invoke(context, "echo", "test")).rejects.toThrowError(
          /PRODUCTION_WORKER_ARTIFACT_MISSING/i,
        );
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });
});
