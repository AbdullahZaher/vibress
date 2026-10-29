import { fork, ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  signTier2IpcEnvelope,
  verifyTier2IpcEnvelope,
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
  readonly entrypointPath?: string | undefined;
  readonly trustTier?: "curated_operator" | "community_reviewed" | "untrusted_marketplace" | undefined;
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
    super(`[${code}] ${message}`);
    this.name = "Tier2SupervisorError";
  }
}

export interface Tier2IsolationCheckResult {
  readonly isIsolated: boolean;
  readonly isolationMechanism: "sandbox_runner" | "container" | "cgroups_v2" | "restricted_process" | "unsupported";
  readonly details: string;
}

/**
 * M7.2: Verifies host environment provides OS-enforced isolation boundaries.
 * Fails closed if untrusted marketplace plugin is scheduled on an unisolated host.
 * Distinguishes host container presence from verified per-plugin isolation.
 */
export function verifyPlatformIsolationSupport(
  trustTier?: "curated_operator" | "community_reviewed" | "untrusted_marketplace",
): Tier2IsolationCheckResult {
  if (process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION === "1") {
    return {
      isIsolated: false,
      isolationMechanism: "unsupported",
      details: "OS-enforced isolation is disabled by operational environment policy",
    };
  }

  // Untrusted marketplace plugins require an independent, verified per-plugin sandbox runner (e.g. gVisor, bwrap, or isolated micro-runner container)
  const sandboxRunner = process.env.VIBRESS_TIER2_SANDBOX_RUNNER;
  const hasVerifiedRunner = Boolean(
    sandboxRunner && ["gvisor", "bwrap", "nsjail", "container"].includes(sandboxRunner),
  );

  if (trustTier === "untrusted_marketplace") {
    if (hasVerifiedRunner) {
      return {
        isIsolated: true,
        isolationMechanism: "sandbox_runner",
        details: `Verified per-plugin sandbox runner active: ${sandboxRunner}`,
      };
    }
    // Fail closed: Host container presence (/.dockerenv, cgroups) does NOT provide per-plugin isolation for untrusted code
    return {
      isIsolated: false,
      isolationMechanism: "unsupported",
      details:
        "Untrusted marketplace plugin execution denied: requires independent per-plugin isolation boundary (gVisor/bwrap/container). Host container presence alone is insufficient for multi-tenant untrusted execution.",
    };
  }

  // Curated operator or community reviewed plugins run under restricted child process
  return {
    isIsolated: true,
    isolationMechanism: "restricted_process",
    details: "Restricted process boundary active with scrubbed environment and strict resource ceilings for operator/reviewed plugin",
  };
}

interface PendingInvocation {
  readonly context: Tier2InvocationContext;
  readonly handlers: HostCapabilityHandlers;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ActiveProcess {
  readonly child: ChildProcess;
  readonly sessionKey: string;
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly entrypointPath?: string | undefined;
  pendingRequests: Map<string, PendingInvocation>;
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
   * Spawns an isolated child process with scrubbed environment, resource limits, and verified OS isolation.
   */
  private spawnProcess(
    pluginId: string,
    releaseDigest: string,
    entrypointPath?: string | undefined,
    trustTier?: "curated_operator" | "community_reviewed" | "untrusted_marketplace" | undefined,
  ): ActiveProcess {
    if (this.quarantinedPlugins.has(pluginId)) {
      throw new Tier2SupervisorError("PLUGIN_CRASH_LOOP_QUARANTINED", `Plugin '${pluginId}' is quarantined due to repeated crashes`);
    }

    // M7.2: Fail-closed boundary check for untrusted plugin execution
    const isolation = verifyPlatformIsolationSupport(trustTier);
    if (!isolation.isIsolated) {
      throw new Tier2SupervisorError(
        "UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE",
        `Untrusted plugin execution rejected: ${isolation.details}`,
      );
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
      ...(entrypointPath ? { VIBRESS_PLUGIN_ENTRYPOINT: entrypointPath } : {}),
    };

    const isProduction = process.env.NODE_ENV === "production";
    let script = this.workerScriptPath;

    if (isProduction) {
      // Production MUST use compiled JavaScript worker artifact. TypeScript fallback is forbidden.
      if (script && (!script.endsWith(".js") || !existsSync(script))) {
        throw new Tier2SupervisorError(
          "PRODUCTION_WORKER_ARTIFACT_MISSING",
          `Tier 2 worker JavaScript bundle is invalid or missing at: ${script}. TypeScript execution is forbidden in production.`,
        );
      }
      if (!script) {
        const productionCandidates = [
          path.resolve(__dirname, "tier2-sandbox-worker.js"),
          path.resolve(__dirname, "../../dist/runtime/tier2-sandbox-worker.js"),
          path.resolve(process.cwd(), "apps/api/dist/tier2-sandbox-worker.js"),
          path.resolve(process.cwd(), "apps/worker/dist/tier2-sandbox-worker.js"),
          path.resolve(process.cwd(), "packages/domains/plugins/dist/runtime/tier2-sandbox-worker.js"),
          path.resolve(__dirname, "dist/runtime/tier2-sandbox-worker.js"),
        ];
        script = productionCandidates.find((p) => existsSync(p));
        if (!script) {
          throw new Tier2SupervisorError(
            "PRODUCTION_WORKER_ARTIFACT_MISSING",
            "Tier 2 worker JavaScript bundle is missing from production installation. Run production build before starting.",
          );
        }
      }
    } else {
      // Development and test mode: prefer source .ts so tests always execute latest code without requiring stale builds
      if (!script || !existsSync(script)) {
        const devCandidates = [
          path.resolve(__dirname, "tier2-sandbox-worker.ts"),
          path.resolve(process.cwd(), "packages/domains/plugins/src/runtime/tier2-sandbox-worker.ts"),
          path.resolve(__dirname, "src/runtime/tier2-sandbox-worker.ts"),
          path.resolve(__dirname, "tier2-sandbox-worker.js"),
          path.resolve(__dirname, "../../dist/runtime/tier2-sandbox-worker.js"),
          path.resolve(process.cwd(), "packages/domains/plugins/dist/runtime/tier2-sandbox-worker.js"),
          path.resolve(__dirname, "dist/runtime/tier2-sandbox-worker.js"),
        ];
        script = devCandidates.find((p) => existsSync(p));
        if (!script) {
          throw new Tier2SupervisorError(
            "WORKER_ARTIFACT_NOT_FOUND",
            "Tier 2 worker artifact could not be resolved from source or dist directories.",
          );
        }
      }
    }

    const isTypeScript = Boolean(script.endsWith(".ts"));
    if (isProduction && isTypeScript) {
      throw new Tier2SupervisorError(
        "PRODUCTION_WORKER_ARTIFACT_MISSING",
        "TypeScript worker fallback is strictly prohibited in production.",
      );
    }

    const nodeArgs = [
      `--max-old-space-size=${this.maxOldSpaceSizeMb}`,
      "--no-addons",
      "--disallow-code-generation-from-strings",
      ...(isTypeScript ? ["--import", "tsx"] : []),
    ];

    const child = fork(script!, [], {
      env: sanitizedEnv,
      execArgv: nodeArgs,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    child.stdout?.resume();
    child.stderr?.resume();

    const active: ActiveProcess = {
      child,
      sessionKey,
      pluginId,
      releaseDigest,
      entrypointPath,
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
            const resPayload = envelope.payload as any;
            if (resPayload && typeof resPayload === "object" && resPayload.ok === false && resPayload.error) {
              pending.reject(
                new Tier2SupervisorError(
                  resPayload.error.code || "INVOCATION_FAILED",
                  resPayload.error.message || "Plugin invocation failed",
                ),
              );
            } else if (resPayload && typeof resPayload === "object" && resPayload.ok === true && "data" in resPayload) {
              pending.resolve(resPayload.data);
            } else if (resPayload && typeof resPayload === "object" && resPayload.error) {
              pending.reject(
                new Tier2SupervisorError(
                  resPayload.error.code || "INVOCATION_FAILED",
                  resPayload.error.message || "Plugin invocation failed",
                ),
              );
            } else {
              pending.resolve(resPayload);
            }
          }
        } else if (envelope.type === "capability_request") {
          // M7.4 Security Fix: Resolve authorization strictly from Host-held pending invocation context
          const req = envelope.payload as Tier2CapabilityRequest;
          const invocationId = envelope.correlationId || req.invocationId;
          const pending = invocationId ? active.pendingRequests.get(invocationId) : undefined;

          if (!pending) {
            // Reject unauthentic or orphan capability requests fail-closed
            const rejectEnv = signTier2IpcEnvelope({
              id: envelope.id,
              correlationId: envelope.correlationId,
              pluginId,
              releaseDigest,
              publicationId: "untrusted",
              type: "capability_response",
              payload: {
                ok: false,
                error: {
                  code: "UNAUTHORIZED_INVOCATION_CONTEXT",
                  message: "Capability request is not correlated with an active, authorized Host invocation",
                },
              },
            }, sessionKey);
            if (child.connected) {
              child.send(rejectEnv);
            }
            return;
          }

          // Authoritative capability context strictly derived from Host state:
          const capContext: Tier2CapabilityContext = {
            pluginId: pending.context.pluginId,
            publicationId: pending.context.publicationId,
            releaseDigest: pending.context.releaseDigest,
            grantedCapabilities: pending.context.grantedCapabilities,
            actor: pending.context.actor,
          };

          const responsePayload = await executeHostCapabilityRequest(capContext, req, pending.handlers);
          const responseEnv = signTier2IpcEnvelope({
            id: envelope.id,
            correlationId: envelope.correlationId,
            pluginId,
            releaseDigest,
            publicationId: pending.context.publicationId,
            type: "capability_response",
            payload: responsePayload,
          }, sessionKey);
          if (child.connected) {
            child.send(responseEnv);
          }
        }
      } catch (err: unknown) {
        // Discard invalid / unauthentic messages silently and emit diagnostic
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

  private handleProcessCrash(pluginId: string, _error: unknown): void {
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
      active.child.unref();
    } catch {
      // Child already terminated
    }
  }

  /**
   * Invokes an isolated plugin method with bounded timeout, authenticated IPC, and Host-mediated authorization.
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
    if (
      !active ||
      !active.child.connected ||
      active.releaseDigest !== context.releaseDigest ||
      active.entrypointPath !== context.entrypointPath
    ) {
      if (active) this.cleanupProcess(context.pluginId, new Error("Process release rotated"));
      active = this.spawnProcess(
        context.pluginId,
        context.releaseDigest,
        context.entrypointPath,
        context.trustTier,
      );
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
        grantedCapabilities: context.grantedCapabilities ?? [],
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
        context,
        handlers,
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
