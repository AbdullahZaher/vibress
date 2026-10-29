import {
  signTier2IpcEnvelope,
  verifyTier2IpcEnvelope,
  type Tier2IpcEnvelope,
} from "./tier2-ipc.js";

const sessionKey: string = process.env.VIBRESS_SESSION_KEY || "";
const pluginId: string = process.env.VIBRESS_PLUGIN_ID || "";
const releaseDigest: string = process.env.VIBRESS_RELEASE_DIGEST || "";

if (!sessionKey || !pluginId || !releaseDigest) {
  // Fail closed if unauthenticated or missing runtime parameters
  process.exit(1);
}

// Sandbox worker state
let isTerminating = false;

// Request capability helper for plugin code
export async function requestCapability<T = unknown>(
  action: string,
  publicationId: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (!process.send) {
    throw new Error("Sandbox IPC channel not available");
  }
  const id = (await import("node:crypto")).randomUUID();
  const envelope = signTier2IpcEnvelope({
    id,
    pluginId,
    releaseDigest,
    publicationId,
    type: "capability_request",
    payload: { action, publicationId, params },
  }, sessionKey);

  return new Promise<T>((resolve, reject) => {
    const handler = (msg: unknown) => {
      try {
        const res = verifyTier2IpcEnvelope(msg, sessionKey);
        if (res.type === "capability_response" && res.id === id) {
          process.off("message", handler);
          const body = res.payload as { ok: boolean; data?: T; error?: { code: string; message: string } };
          if (body.ok) {
            resolve(body.data as T);
          } else {
            reject(new Error(body.error?.message || "Capability request failed"));
          }
        }
      } catch {
        // Ignore foreign / invalid frames
      }
    };
    process.on("message", handler);
    process.send!(envelope);
  });
}

process.on("message", async (rawMsg: unknown) => {
  if (isTerminating) return;
  try {
    const envelope = verifyTier2IpcEnvelope(rawMsg, sessionKey);
    if (envelope.type === "terminate") {
      isTerminating = true;
      process.exit(0);
    }
    if (envelope.type === "invoke") {
      const { operation, data } = envelope.payload as { operation: string; data: unknown };
      let result: unknown;

      // Built-in simulated operational handlers and extensible plugin dispatch
      if (operation === "echo") {
        result = { echoed: data, timestamp: Date.now() };
      } else if (operation === "compute") {
        const num = Number(data);
        result = { value: num * 2 };
      } else if (operation === "malicious_env_probe") {
        // Attempt to read Host secrets from process.env
        result = {
          databaseUrl: process.env.DATABASE_URL || null,
          redisUrl: process.env.REDIS_URL || null,
          jwtSecret: process.env.JWT_SECRET || null,
          keyring: process.env.KEYRING_PRIMARY || null,
        };
      } else if (operation === "simulate_crash") {
        process.exit(137);
      } else if (operation === "infinite_loop") {
        // Simulate CPU lockup
        while (true) {
          // loop indefinitely
        }
      } else {
        result = { status: "success", operation, data };
      }

      const responseEnv = signTier2IpcEnvelope({
        id: envelope.id,
        pluginId,
        releaseDigest,
        publicationId: envelope.publicationId,
        type: "response",
        payload: result,
      }, sessionKey);

      if (process.send) {
        process.send(responseEnv);
      }
    }
  } catch (error: unknown) {
    // Drop invalid or tampered envelopes
  }
});
