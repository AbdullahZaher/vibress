import { describe, it, expect, afterEach } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  signTier2IpcEnvelope,
  verifyTier2IpcEnvelope,
  encodeTier2IpcFrame,
  Tier2IpcError,
} from "../src/runtime/tier2-ipc";
import {
  executeHostCapabilityRequest,
  type HostCapabilityHandlers,
  type Tier2CapabilityContext,
} from "../src/runtime/tier2-capability-gateway";
import {
  Tier2PluginSupervisor,
  Tier2SupervisorError,
} from "../src/runtime/tier2-process-supervisor";

describe("Tier 2 Independently Isolated Plugin Runtime (M4)", () => {
  const supervisorsToClean: Tier2PluginSupervisor[] = [];

  afterEach(async () => {
    for (const sup of supervisorsToClean) {
      await sup.shutdownAll();
    }
    supervisorsToClean.length = 0;
  });

  describe("Tier 2 Authenticated IPC Transport (RT-01)", () => {
    const sessionKey = randomBytes(32).toString("hex");

    it("successfully creates and verifies a signed IPC envelope", () => {
      const envelope = signTier2IpcEnvelope({
        id: randomUUID(),
        pluginId: "com.vendor.payment-gateway",
        releaseDigest: "sha256:abc1234567890",
        publicationId: "pub_01",
        type: "invoke",
        payload: { operation: "calculateTax", amount: 100 },
      }, sessionKey);

      expect(envelope.id).toBeDefined();
      expect(envelope.hmacSha256).toBeDefined();

      const verified = verifyTier2IpcEnvelope(envelope, sessionKey);
      expect(verified.pluginId).toBe("com.vendor.payment-gateway");
      expect(verified.publicationId).toBe("pub_01");
      expect(verified.payload).toEqual({ operation: "calculateTax", amount: 100 });
    });

    it("rejects an envelope with a tampered signature", () => {
      const envelope = signTier2IpcEnvelope({
        id: randomUUID(),
        pluginId: "com.vendor.payment-gateway",
        releaseDigest: "sha256:abc1234567890",
        publicationId: "pub_01",
        type: "invoke",
        payload: { operation: "calculateTax", amount: 100 },
      }, sessionKey);

      const tampered = { ...envelope, hmacSha256: envelope.hmacSha256.replace(/^[a-f0-9]/, "0") };

      expect(() => verifyTier2IpcEnvelope(tampered, sessionKey)).toThrowError(
        Tier2IpcError,
      );
    });

    it("rejects an envelope when the payload was tampered in-transit", () => {
      const envelope = signTier2IpcEnvelope({
        id: randomUUID(),
        pluginId: "com.vendor.payment-gateway",
        releaseDigest: "sha256:abc1234567890",
        publicationId: "pub_01",
        type: "invoke",
        payload: { operation: "calculateTax", amount: 100 },
      }, sessionKey);

      const tampered = { ...envelope, payload: { operation: "calculateTax", amount: 99999 } };

      expect(() => verifyTier2IpcEnvelope(tampered, sessionKey)).toThrowError(
        Tier2IpcError,
      );
    });

    it("rejects an envelope with an expired timestamp (> 10s skew)", () => {
      const oldTimestamp = Date.now() - 45_000;
      const envelope = signTier2IpcEnvelope({
        id: randomUUID(),
        pluginId: "com.vendor.payment-gateway",
        releaseDigest: "sha256:abc1234567890",
        publicationId: "pub_01",
        type: "invoke",
        timestamp: oldTimestamp,
        payload: {},
      }, sessionKey);

      expect(() => verifyTier2IpcEnvelope(envelope, sessionKey)).toThrowError(
        /timestamp is outside permitted skew window/i,
      );
    });

    it("rejects an envelope exceeding the 64 KiB framing limit", () => {
      const oversizedPayload = { bigData: "A".repeat(70_000) };

      const envelope = signTier2IpcEnvelope({
        id: randomUUID(),
        pluginId: "com.vendor.payment-gateway",
        releaseDigest: "sha256:abc1234567890",
        publicationId: "pub_01",
        type: "invoke",
        payload: oversizedPayload,
      }, sessionKey);

      expect(() => encodeTier2IpcFrame(envelope)).toThrowError(/exceeds limit of 65536/i);
    });
  });

  describe("Tier 2 Host Capability Gateway (RT-03)", () => {
    const dummyHandlers: HostCapabilityHandlers = {
      storageGet: async (modelKey, id) => ({ modelKey, id, value: "mock_value" }),
      secretGet: async (key) => `secret_for_${key}`,
    };

    const context: Tier2CapabilityContext = {
      pluginId: "com.vendor.payment-gateway",
      publicationId: "pub_tenant_primary",
      releaseDigest: "sha256:digest123",
      grantedCapabilities: ["extension.storage.read"],
      actor: { id: "user_01", type: "staff" },
    };

    it("executes an authorized host capability", async () => {
      const result = await executeHostCapabilityRequest(
        context,
        {
          action: "storage.get",
          publicationId: "pub_tenant_primary",
          params: { modelKey: "config", id: "1" },
        },
        dummyHandlers,
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ modelKey: "config", id: "1", value: "mock_value" });
    });

    it("denies access to an ungranted capability fail-closed", async () => {
      const result = await executeHostCapabilityRequest(
        context,
        {
          action: "secret.get",
          publicationId: "pub_tenant_primary",
          params: { key: "private_key" },
        },
        dummyHandlers,
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("CAPABILITY_NOT_GRANTED");
    });

    it("prevents cross-publication capability requests fail-closed", async () => {
      const result = await executeHostCapabilityRequest(
        context,
        {
          action: "storage.get",
          publicationId: "pub_tenant_ATTACKER_TARGET",
          params: { modelKey: "config", id: "1" },
        },
        dummyHandlers,
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("CROSS_PUBLICATION_DENIED");
    });
  });

  describe("Tier 2 Process Isolation and Adversarial Hardening (RT-02, RT-04, RT-05)", () => {
    const compiledWorkerPath = path.resolve(
      __dirname,
      "../dist/runtime/tier2-sandbox-worker.js",
    );

    it("proves the child process cannot read Host environment secrets (Scrubbed Environment)", async () => {
      // Set host secrets in current process
      process.env.DATABASE_URL = "postgres://admin:secret_pass@localhost:5432/vibress";
      process.env.REDIS_URL = "redis://:secret_redis@localhost:6379";
      process.env.JWT_SECRET = "ultra-secret-jwt-signing-key";
      process.env.KEYRING_PRIMARY = "primary-keyring-hex";

      const supervisor = new Tier2PluginSupervisor({
        workerScriptPath: compiledWorkerPath,
        invocationTimeoutMs: 2500,
      });
      supervisorsToClean.push(supervisor);

      const result = await supervisor.invoke(
        {
          pluginId: "com.vendor.env-probe",
          releaseDigest: "sha256:release_probe",
          publicationId: "pub_01",
          grantedCapabilities: [],
          actor: { id: "user_01", type: "staff" },
        },
        "malicious_env_probe",
        {},
      ) as Record<string, unknown>;

      // Verify that all host secrets are null inside the isolated sandbox process
      expect(result.databaseUrl).toBeNull();
      expect(result.redisUrl).toBeNull();
      expect(result.jwtSecret).toBeNull();
      expect(result.keyring).toBeNull();
    });

    it("successfully performs isolated compute and echo operations over authenticated IPC", async () => {
      const supervisor = new Tier2PluginSupervisor({
        workerScriptPath: compiledWorkerPath,
        invocationTimeoutMs: 2500,
      });
      supervisorsToClean.push(supervisor);

      const computeRes = await supervisor.invoke(
        {
          pluginId: "com.vendor.math",
          releaseDigest: "sha256:release_math",
          publicationId: "pub_01",
          grantedCapabilities: [],
          actor: { id: "user_01", type: "staff" },
        },
        "compute",
        21,
      );

      expect(computeRes).toEqual({ value: 42 });

      const echoRes = await supervisor.invoke(
        {
          pluginId: "com.vendor.math",
          releaseDigest: "sha256:release_math",
          publicationId: "pub_01",
          grantedCapabilities: [],
          actor: { id: "user_01", type: "staff" },
        },
        "echo",
        "Hello from host",
      ) as { echoed: string; timestamp: number };

      expect(echoRes.echoed).toBe("Hello from host");
      expect(echoRes.timestamp).toBeGreaterThan(0);
    });

    it("terminates child process on timeout without hanging host (Resource Ceiling)", async () => {
      const supervisor = new Tier2PluginSupervisor({
        workerScriptPath: compiledWorkerPath,
        invocationTimeoutMs: 400, // Short timeout
      });
      supervisorsToClean.push(supervisor);

      await expect(
        supervisor.invoke(
          {
            pluginId: "com.vendor.infinite-loop",
            releaseDigest: "sha256:release_loop",
            publicationId: "pub_01",
            grantedCapabilities: [],
            actor: { id: "user_01", type: "staff" },
          },
          "infinite_loop",
          {},
        )
      ).rejects.toThrowError(Tier2SupervisorError);
    });

    it("survives child process crashes and enforces crash-loop quarantine (Resilience)", async () => {
      const supervisor = new Tier2PluginSupervisor({
        workerScriptPath: compiledWorkerPath,
        invocationTimeoutMs: 1500,
        maxCrashCount: 3,
        crashWindowMs: 30_000,
      });
      supervisorsToClean.push(supervisor);

      const pluginContext = {
        pluginId: "com.vendor.flaky-plugin",
        releaseDigest: "sha256:release_flaky",
        publicationId: "pub_01",
        grantedCapabilities: [],
        actor: { id: "user_01", type: "staff" } as const,
      };

      // Trigger Crash 1
      await expect(
        supervisor.invoke(pluginContext, "simulate_crash", {})
      ).rejects.toThrowError(/Sandbox exited with code 137/i);

      // Trigger Crash 2
      await expect(
        supervisor.invoke(pluginContext, "simulate_crash", {})
      ).rejects.toThrowError(/Sandbox exited with code 137/i);

      // Trigger Crash 3
      await expect(
        supervisor.invoke(pluginContext, "simulate_crash", {})
      ).rejects.toThrowError(/Sandbox exited with code 137/i);

      // Verify Quarantine
      expect(supervisor.isQuarantined("com.vendor.flaky-plugin")).toBe(true);

      // Attempting further invocations must immediately fail-closed
      await expect(
        supervisor.invoke(pluginContext, "compute", 10)
      ).rejects.toThrowError(/is quarantined due to excessive crashes/i);
    });
  });
});
