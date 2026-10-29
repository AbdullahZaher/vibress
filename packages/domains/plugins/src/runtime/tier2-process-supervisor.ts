import { fork, ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  signTier2IpcEnvelope,
  verifyTier2IpcEnvelope,
  type Tier2IpcEnvelope,
  Tier2IpcError,
} from "./tier2-ipc.js";
import {
  executeHostCapabilityRequest,
  type HostCapabilityHandlers,
  type Tier2CapabilityContext,
  type Tier2CapabilityRequest,
} from "./tier2-capability-gateway.js";

export interface Tier2SandboxOptions {
  readonly maxOldSpaceSizeMb?: number | undefined;
  readonly invocationTimeoutMs?: number | undefined;
  readonly maxCrashCount?: number | undefined;
  readonly crashWindowMs?: number | undefined;
  readonly workerScriptPath?: string | undefined;
}

export interface Tier2InvocationContext {
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly publicationId: string;
  readonly grantedCapabilities: readonly string[];
  readonly actor: {
    readonly id: string;
    readonly type: "staff" | "member" | "anonymous";
  };
}

export interface Tier2ProcessState {
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly pid: number;
  readonly isQuarantined: boolean;
  readonly crashCount: number;
}

export class Tier2SupervisorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Tier2SupervisorError";
  }
}

interface ActiveProcess {
  readonly child: ChildProcess;
  readonly sessionKey: string;
  readonly pluginId: string;
  readonly releaseDigest: string;
  pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

export class Tier2PluginSupervisor extends EventEmitter {
  private readonly processes = new Map<string, ActiveProcess>();
  private readonly crashTimestamps = new Map<string, number[]>();
  private readonly quarantinedPlugins = new Set<string>();

  private readonly maxOldSpaceSizeMb: number;
  private readonly invocationTimeoutMs: number;
  private readonly maxCrashCount: number;
  private readonly crashWindowMs: number;
  private readonly workerScriptPath?: string | undefined;

  constructor(options?: Tier2SandboxOptions) {
    super();
    this.maxOldSpaceSizeMb = options?.maxOldSpaceSizeMb ?? 64;
    this.invocationTimeoutMs = options?.invocationTimeoutMs ?? 3000;
    this.maxCrashCount = options?.maxCrashCount ?? 3;
    this.crashWindowMs = options?.crashWindowMs ?? 30_000;
    this.workerScriptPath = options?.workerScriptPath;
  }

  isQuarantined(pluginId: string): boolean {
    return this.quarantinedPlugins.has(pluginId);
  }

  resetQuarantine(pluginId: string): void {
    this.quarantinedPlugins.delete(pluginId);
    this.crashTimestamps.delete(pluginId);
  }

  getProcessState(pluginId: string): Tier2ProcessState | null {
    const active = this.processes.get(pluginId);
    const crashes = this.crashTimestamps.get(pluginId)?.length ?? 0;
    if (!active) {
      if (this.quarantinedPlugins.has(pluginId)) {
        return {
          pluginId,
          releaseDigest: "unknown",
          pid: -1,
          isQuarantined: true,
          crashCount: crashes,
        };
      }
      return null;
    }
    return {
      pluginId: active.pluginId,
      releaseDigest: active.releaseDigest,
      pid: active.child.pid ?? -1,
      isQuarantined: this.quarantinedPlugins.has(pluginId),
      crashCount: crashes,
    };
  }

  /**
   * Spawns an isolated child process with scrubbed environment and resource limits.
   */
  private spawnProcess(
    pluginId: string,
    releaseDigest: string,
    handlers: HostCapabilityHandlers,
  ): ActiveProcess {
    if (this.quarantinedPlugins.has(pluginId)) {
      throw new Tier2SupervisorError("PLUGIN_CRASH_LOOP_QUARANTINED", `Plugin '${pluginId}' is quarantined due to repeated crashes`);
    }

    const sessionKey = randomBytes(32).toString("hex");

    // Whitelist environment variables strictly. NO Host secrets, DB, or Redis credentials.
    const sanitizedEnv: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      VIBRESS_TIER2_SANDBOX: "1",
      VIBRESS_PLUGIN_ID: pluginId,
      VIBRESS_RELEASE_DIGEST: releaseDigest,
      VIBRESS_SESSION_KEY: sessionKey,
    };

    const nodeArgs = [
      `--max-old-space-size=${this.maxOldSpaceSizeMb}`,
      "--no-addons",
    ];

    let script = this.workerScriptPath;
    if (!script) {
      const candidates = [
        path.resolve(__dirname, "tier2-sandbox-worker.js"),
        path.resolve(__dirname, "../../dist/runtime/tier2-sandbox-worker.js"),
        path.resolve(process.cwd(), "packages/domains/plugins/dist/runtime/tier2-sandbox-worker.js"),
        path.resolve(__dirname, "dist/runtime/tier2-sandbox-worker.js"),
      ];
      script = candidates.find((p) => existsSync(p)) || candidates[0];
    }
    const child = fork(script!, [], {
      env: sanitizedEnv,
      execArgv: nodeArgs,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    const active: ActiveProcess = {
      child,
      sessionKey,
      pluginId,
      releaseDigest,
      pendingRequests: new Map(),
    };

    child.on("message", async (msg: unknown) => {
      try {
        const envelope = verifyTier2IpcEnvelope(msg, sessionKey);
        if (envelope.type === "response") {
          const pending = active.pendingRequests.get(envelope.id);
          if (pending) {
            clearTimeout(pending.timer);
            active.pendingRequests.delete(envelope.id);
            pending.resolve(envelope.payload);
          }
        } else if (envelope.type === "capability_request") {
          // Mediate capability request through Host
          const req = envelope.payload as Tier2CapabilityRequest;
          const capContext: Tier2CapabilityContext = {
            pluginId,
            publicationId: envelope.publicationId,
            releaseDigest,
            grantedCapabilities: [], // Passed dynamically in invoke or loaded from manifest
            actor: { id: "sandbox", type: "anonymous" },
          };
          const responsePayload = await executeHostCapabilityRequest(capContext, req, handlers);
          const responseEnv = signTier2IpcEnvelope({
            id: envelope.id,
            pluginId,
            releaseDigest,
            publicationId: envelope.publicationId,
            type: "capability_response",
            payload: responsePayload,
          }, sessionKey);
          if (child.connected) {
            child.send(responseEnv);
          }
        }
      } catch (err: unknown) {
        // Discard invalid / unauthentic messages silently or emit diagnostic
        this.emit("security_violation", { pluginId, error: err });
      }
    });

    child.on("exit", (code, signal) => {
      this.handleProcessExit(pluginId, code, signal);
    });

    child.on("error", (err) => {
      this.handleProcessCrash(pluginId, err);
    });

    this.processes.set(pluginId, active);
    return active;
  }

  private handleProcessCrash(pluginId: string, error: unknown): void {
    this.recordCrash(pluginId);
    this.cleanupProcess(pluginId, new Tier2SupervisorError("PLUGIN_CRASHED", "Sandbox worker process crashed"));
  }

  private handleProcessExit(pluginId: string, code: number | null, signal: NodeJS.Signals | null): void {
    if (code !== 0 && signal !== "SIGTERM") {
      this.recordCrash(pluginId);
    }
    this.cleanupProcess(pluginId, new Tier2SupervisorError("PLUGIN_PROCESS_EXITED", `Sandbox exited with code ${code ?? "null"} (${signal ?? "none"})`));
  }

  private recordCrash(pluginId: string): void {
    const now = Date.now();
    const timestamps = (this.crashTimestamps.get(pluginId) || []).filter((t) => now - t < this.crashWindowMs);
    timestamps.push(now);
    this.crashTimestamps.set(pluginId, timestamps);

    if (timestamps.length >= this.maxCrashCount) {
      this.quarantinedPlugins.add(pluginId);
      this.emit("quarantine", { pluginId, crashCount: timestamps.length });
    }
  }

  private cleanupProcess(pluginId: string, error: Error): void {
    const active = this.processes.get(pluginId);
    if (!active) return;
    this.processes.delete(pluginId);

    for (const [, pending] of active.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    active.pendingRequests.clear();

    try {
      if (active.child.connected) active.child.disconnect();
      active.child.kill("SIGKILL");
    } catch {
      // Child already terminated
    }
  }

  /**
   * Invokes an isolated plugin method with bounded timeout and authenticated IPC.
   */
  async invoke<T = unknown, R = unknown>(
    context: Tier2InvocationContext,
    operation: string,
    payload: T,
    handlers: HostCapabilityHandlers = {},
  ): Promise<R> {
    if (this.quarantinedPlugins.has(context.pluginId)) {
      throw new Tier2SupervisorError("PLUGIN_CRASH_LOOP_QUARANTINED", `Plugin '${context.pluginId}' is quarantined due to excessive crashes`);
    }

    let active = this.processes.get(context.pluginId);
    if (!active || !active.child.connected || active.releaseDigest !== context.releaseDigest) {
      if (active) this.cleanupProcess(context.pluginId, new Error("Process release rotated"));
      active = this.spawnProcess(context.pluginId, context.releaseDigest, handlers);
    }

    const requestId = randomUUID();
    const envelope = signTier2IpcEnvelope({
      id: requestId,
      pluginId: context.pluginId,
      releaseDigest: context.releaseDigest,
      publicationId: context.publicationId,
      type: "invoke",
      payload: {
        operation,
        data: payload,
      },
    }, active.sessionKey);

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        active?.pendingRequests.delete(requestId);
        // On invocation timeout, kill unresponsive child process to prevent resource leaks
        if (active) {
          this.cleanupProcess(context.pluginId, new Tier2SupervisorError("PLUGIN_TIMEOUT", `Operation '${operation}' timed out after ${this.invocationTimeoutMs}ms`));
        }
        reject(new Tier2SupervisorError("PLUGIN_TIMEOUT", `Sandbox invocation timed out after ${this.invocationTimeoutMs}ms`));
      }, this.invocationTimeoutMs);

      active!.pendingRequests.set(requestId, {
        resolve: (val) => resolve(val as R),
        reject,
        timer,
      });

      active!.child.send(envelope, (err) => {
        if (err) {
          clearTimeout(timer);
          active!.pendingRequests.delete(requestId);
          reject(new Tier2SupervisorError("IPC_SEND_FAILED", `Failed to send IPC message to sandbox: ${err.message}`));
        }
      });
    });
  }

  /**
   * Graceful or immediate termination of a sandbox worker.
   */
  async terminatePlugin(pluginId: string): Promise<void> {
    const active = this.processes.get(pluginId);
    if (!active) return;
    this.cleanupProcess(pluginId, new Tier2SupervisorError("PLUGIN_TERMINATED", "Plugin worker was terminated"));
  }

  /**
   * Terminate all managed sandbox workers.
   */
  async terminateAll(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    for (const id of ids) {
      await this.terminatePlugin(id);
    }
  }

  async shutdownAll(): Promise<void> {
    await this.terminateAll();
  }
}
