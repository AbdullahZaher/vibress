import * as util from "node:util";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  signTier2IpcEnvelope,
  verifyTier2IpcEnvelope,
  encodeTier2IpcFrame,
  StreamIpcReader,
  type Tier2IpcEnvelope,
} from "./tier2-ipc.js";

const sessionKey: string = process.env.VIBRESS_SESSION_KEY || "";
const pluginId: string = process.env.VIBRESS_PLUGIN_ID || "";
const releaseDigest: string = process.env.VIBRESS_RELEASE_DIGEST || "";
const isStdioTransport = Boolean(process.env.VIBRESS_IPC_TRANSPORT === "stdio" || !process.send);

if (!sessionKey || !pluginId || !releaseDigest) {
  // Fail closed if unauthenticated or missing runtime parameters
  process.exit(1);
}

// In stdio transport, redirect all standard console logging to stderr so stdout is 100% clean for binary IPC frames
if (isStdioTransport) {
  console.log = (...args: unknown[]) => {
    process.stderr.write(util.format(...args) + "\n");
  };
  console.info = console.log;
  console.warn = console.log;
  console.error = console.log;
  console.debug = console.log;
}

function sendEnvelope(envelope: Tier2IpcEnvelope): void {
  if (isStdioTransport) {
    const frame = encodeTier2IpcFrame(envelope);
    process.stdout.write(frame);
  } else if (process.send) {
    process.send(envelope);
  }
}

import * as net from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";

// Prevent concurrent invocations from exchanging network grants through shared state.
// This is defense-in-depth for trusted plugins, reinforced by kernel namespaces in Bubblewrap.
const invocationGrants = new AsyncLocalStorage<readonly string[]>();

// Intercept outbound direct network sockets: disallow unless granted "extension.network"
const originalSocketConnect = net.Socket.prototype.connect;
(net.Socket.prototype as any).connect = function (this: net.Socket, ...args: any[]) {
  if (!invocationGrants.getStore()?.includes("extension.network")) {
    const err = new Error("DIRECT_NETWORK_ACCESS_DENIED: Outbound network connections are forbidden without Host-granted 'extension.network' capability");
    (err as any).code = "ECONNREFUSED";
    process.nextTick(() => {
      this.emit("error", err);
    });
    return this;
  }
  return (originalSocketConnect as any).apply(this, args);
};

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (!invocationGrants.getStore()?.includes("extension.network")) {
      return Promise.reject(new Error("DIRECT_NETWORK_ACCESS_DENIED: Outbound fetch is forbidden without Host-granted 'extension.network' capability"));
    }
    return originalFetch(input, init);
  };
}

// Sandbox worker state
let isTerminating = false;
let loadedPluginModule: any = null;
let loadModulePromise: Promise<void> | null = null;
let loadError: Error | null = null;
const pendingCapabilities = new Map<string, { resolve: (val: any) => void; reject: (err: Error) => void }>();

async function ensurePluginLoaded(): Promise<void> {
  if (loadedPluginModule || loadError) return;
  if (loadModulePromise) return loadModulePromise;
  loadModulePromise = (async () => {
    const entrypoint = process.env.VIBRESS_PLUGIN_ENTRYPOINT || "";
    if (!entrypoint) return;
    try {
      const fileUrl = path.isAbsolute(entrypoint)
        ? pathToFileURL(entrypoint).href
        : pathToFileURL(path.resolve(process.cwd(), entrypoint)).href;
      const mod = await import(fileUrl);
      loadedPluginModule = mod.default || mod;
    } catch (err: unknown) {
      loadError = err instanceof Error ? err : new Error(String(err));
    }
  })();
  return loadModulePromise;
}

// Request capability helper for plugin code with invocation correlation (M7.4 / M8.3)
export async function requestCapability<T = unknown>(
  action: string,
  publicationId: string,
  params: Record<string, unknown>,
  invocationId?: string,
): Promise<T> {
  const targetPublicationId = publicationId || "untrusted";
  const id = (await import("node:crypto")).randomUUID();
  const envelope = signTier2IpcEnvelope({
    id,
    ...(invocationId ? { correlationId: invocationId } : {}),
    pluginId,
    releaseDigest,
    publicationId: targetPublicationId,
    type: "capability_request",
    payload: { action, publicationId: targetPublicationId, params, invocationId },
  }, sessionKey);

  return new Promise<T>((resolve, reject) => {
    pendingCapabilities.set(id, { resolve: resolve as (val: any) => void, reject });
    try {
      sendEnvelope(envelope);
    } catch (err: unknown) {
      pendingCapabilities.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}


function createPluginContext(
  publicationId: string,
  invocationId: string,
  grantedCapabilities: readonly string[] = [],
) {
  return {
    manifestId: pluginId,
    name: pluginId,
    version: "1.0.0",
    publicationId,
    settings: {},
    async getSecret(key: string): Promise<string | null> {
      return requestCapability<string | null>("secret.get", publicationId, { key }, invocationId);
    },
    log(message: string, _level: "info" | "warn" | "error" = "info"): void {
      // Diagnostic logging within isolated sandbox
    },
    hasCapability(capability: string): boolean {
      return Array.isArray(grantedCapabilities) && grantedCapabilities.includes(capability);
    },
    storage: {
      get: (modelKey: string, id: string) =>
        requestCapability("storage.get", publicationId, { modelKey, id }, invocationId),
      list: (modelKey: string, limit?: number, cursor?: string) =>
        requestCapability("storage.list", publicationId, { modelKey, limit, cursor }, invocationId),
      create: (modelKey: string, id: string, fields: Record<string, unknown>) =>
        requestCapability("storage.create", publicationId, { modelKey, id, fields }, invocationId),
      update: (modelKey: string, id: string, expectedVersion: number, fields: Record<string, unknown>) =>
        requestCapability("storage.update", publicationId, { modelKey, id, expectedVersion, fields }, invocationId),
    },
    memberAccess: {
      getSelf: () => requestCapability("member.getSelf", publicationId, {}, invocationId),
      hasActivePlan: (planId: string) =>
        requestCapability("member.hasActivePlan", publicationId, { planId }, invocationId),
    },
  };
}

async function processEnvelope(envelope: Tier2IpcEnvelope): Promise<void> {
  if (isTerminating) return;
  if (envelope.type === "terminate") {
    isTerminating = true;
    process.exit(0);
  }
  if (envelope.type === "capability_response") {
    const pending = pendingCapabilities.get(envelope.id);
    if (pending) {
      pendingCapabilities.delete(envelope.id);
      const body = envelope.payload as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
      if (body.ok) {
        pending.resolve(body.data);
      } else {
        pending.reject(new Error(body.error?.message || "Capability request failed"));
      }
    }
    return;
  }
  if (envelope.type === "invoke") {
    const { operation, data, grantedCapabilities = [] } = envelope.payload as {
      operation: string;
      data: unknown;
      grantedCapabilities?: string[];
    };
    try {
      await invocationGrants.run(grantedCapabilities, async () => {
        let result: unknown;
        await ensurePluginLoaded();

        // Diagnostic and built-in operations
        if (operation === "echo") {
          result = { echoed: data, timestamp: Date.now() };
        } else if (operation === "compute") {
          const num = Number(data);
          result = { value: num * 2 };
        } else if (operation === "malicious_env_probe") {
          result = {
            databaseUrl: process.env.DATABASE_URL || null,
            redisUrl: process.env.REDIS_URL || null,
            jwtSecret: process.env.JWT_SECRET || null,
            keyring: process.env.KEYRING_PRIMARY || null,
          };
        } else if (operation === "malicious_fs_probe") {
          const probeTarget = (data as { targetPath?: string })?.targetPath || "/etc/hosts";
          try {
            const fs = await import("node:fs/promises");
            const content = await fs.readFile(probeTarget, "utf8");
            result = { readSuccess: true, bytesRead: content.length };
          } catch (err: unknown) {
            result = { readSuccess: false, error: (err as Error).message };
          }
        } else if (operation === "malicious_net_probe") {
          try {
            const net = await import("node:net");
            const sock = net.createConnection({ host: "127.0.0.1", port: 5433, timeout: 500 });
            await new Promise((resolve, reject) => {
              sock.on("connect", () => { sock.destroy(); resolve(true); });
              sock.on("error", reject);
              sock.on("timeout", () => { sock.destroy(); reject(new Error("ETIMEDOUT")); });
            });
            result = { connected: true };
          } catch (err: unknown) {
            result = { connected: false, error: (err as Error).message };
          }
        } else if (operation === "malicious_process_probe") {
          try {
            const cp = await import("node:child_process");
            const output = cp.execSync("whoami", { timeout: 1000 }).toString().trim();
            result = { spawned: true, user: output };
          } catch (err: unknown) {
            result = { spawned: false, error: (err as Error).message };
          }
        } else if (operation === "simulate_crash") {
          process.exit(137);
        } else if (operation === "infinite_loop") {
          while (true) {
            // loop indefinitely
          }
        } else if (operation === "test_capability") {
          const testReq = (data as { action: string; publicationId?: string; params?: Record<string, unknown> }) || {};
          const targetPubId = testReq.publicationId || envelope.publicationId || "untrusted";
          result = await requestCapability(testReq.action, targetPubId, testReq.params || {}, envelope.id);
        } else if (loadedPluginModule) {
          const ctx = createPluginContext(envelope.publicationId, envelope.id, grantedCapabilities);
          if (operation === "activate" && typeof loadedPluginModule.activate === "function") {
            await loadedPluginModule.activate(ctx);
            result = { activated: true };
          } else if (operation === "deactivate" && typeof loadedPluginModule.deactivate === "function") {
            await loadedPluginModule.deactivate(ctx);
            result = { deactivated: true };
          } else if (operation === "onEvent" && typeof loadedPluginModule.onEvent === "function") {
            const eventData = (data as { eventName: string; payload: unknown }) || { eventName: "custom", payload: data };
            await loadedPluginModule.onEvent(eventData.eventName, eventData.payload, ctx);
            result = { handled: true };
          } else if (operation === "invoke" && typeof loadedPluginModule.invoke === "function") {
            result = await loadedPluginModule.invoke(data, ctx);
          } else if (typeof loadedPluginModule[operation] === "function") {
            result = await loadedPluginModule[operation](data, ctx);
          } else if (typeof loadedPluginModule === "function") {
            result = await loadedPluginModule(data, ctx);
          } else {
            throw new Error(`UNSUPPORTED_OPERATION: Operation '${operation}' is not supported by plugin '${pluginId}'`);
          }
        } else if (loadError) {
          throw new Error(`Failed to load plugin entrypoint: ${loadError.message}`);
        } else {
          throw new Error(`UNSUPPORTED_OPERATION: Unknown operation '${operation}' in unconfigured plugin '${pluginId}'`);
        }

        const responseEnv = signTier2IpcEnvelope({
          id: envelope.id,
          correlationId: envelope.correlationId,
          pluginId,
          releaseDigest,
          publicationId: envelope.publicationId,
          type: "response",
          payload: {
            ok: true,
            data: result,
          },
        }, sessionKey);

        sendEnvelope(responseEnv);
      });
    } catch (error: unknown) {
      const errEnv = signTier2IpcEnvelope({
        id: envelope.id,
        correlationId: envelope.correlationId,
        pluginId,
        releaseDigest,
        publicationId: envelope.publicationId,
        type: "response",
        payload: {
          ok: false,
          error: {
            code: (error as any)?.code || "INVOCATION_FAILED",
            message: error instanceof Error ? error.message : "Plugin execution failed",
          },
        },
      }, sessionKey);
      sendEnvelope(errEnv);
    }
  }
}

// Wire IPC transports
if (isStdioTransport) {
  const streamReader = new StreamIpcReader(sessionKey);
  streamReader.onEnvelope((env) => {
    processEnvelope(env).catch(() => {});
  });
  streamReader.onError((err) => {
    process.stderr.write(`[tier2-worker] IPC stream error: ${err.message}\n`);
  });
  process.stdin.on("data", (chunk: Buffer) => {
    streamReader.feed(chunk);
  });
}

if (process.send) {
  process.on("message", async (rawMsg: unknown) => {
    try {
      const envelope = verifyTier2IpcEnvelope(rawMsg, sessionKey);
      await processEnvelope(envelope);
    } catch {
      // Drop tampered envelopes
    }
  });
}

