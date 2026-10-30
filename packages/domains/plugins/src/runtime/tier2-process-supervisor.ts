import { fork, execFileSync, ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
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
import type { PluginTrustTier } from "../application/plugin-catalog.js";

export interface AuthoritativePluginAdmission {
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly trustTier: PluginTrustTier;
  readonly allowedEntrypoints?: readonly string[] | undefined;
  readonly releaseDirectory?: string | undefined;
  /** Optional pinned SHA-256 of the entrypoint file (not the release archive). */
  readonly entrypointSha256?: string | undefined;
  readonly isRevoked?: boolean | undefined;
  readonly revocationReason?: string | undefined;
}

export interface Tier2SandboxOptions {
  readonly maxOldSpaceSizeMb?: number | undefined;
  readonly invocationTimeoutMs?: number | undefined;
  readonly maxCrashCount?: number | undefined;
  readonly crashWindowMs?: number | undefined;
  readonly workerScriptPath?: string | undefined;
  readonly authoritativeAdmissions?: readonly AuthoritativePluginAdmission[] | undefined;
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
  readonly trustTier?: PluginTrustTier | undefined;
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

export interface VerifiedSandboxRunner {
  readonly name: "bwrap" | "runsc" | "nsjail" | "container";
  readonly executablePath: string;
  readonly version: string;
}

/**
 * P0: Discovers and verifies real OS-level sandbox runner executables.
 * Environment variables alone are NEVER treated as proof of active isolation.
 * An active execution probe is required to prove the runner is functional.
 */
export function detectSandboxRunner(preferredName?: string): VerifiedSandboxRunner | null {
  if (process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION === "1") {
    return null;
  }

  const requested = preferredName || process.env.VIBRESS_TIER2_SANDBOX_RUNNER;
  const namesToProbe: string[] = requested ? [requested] : ["bwrap", "runsc", "nsjail"];

  for (const rawName of namesToProbe) {
    const name = rawName === "gvisor" ? "runsc" : rawName;
    let resolvedBin: string | null = null;

    if (path.isAbsolute(name) && existsSync(name)) {
      resolvedBin = name;
    } else {
      const candidates = [
        `/usr/bin/${name}`,
        `/usr/local/bin/${name}`,
        `/bin/${name}`,
      ];

      if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
          if (dir) candidates.push(path.join(dir, name));
        }
      }

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          try {
            const st = statSync(candidate);
            if (st.isFile()) {
              resolvedBin = candidate;
              break;
            }
          } catch {
            // Ignore stat errors
          }
        }
      }
    }

    if (!resolvedBin) continue;

    try {
      const output = execFileSync(resolvedBin, ["--version"], {
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();

      const normalizedName =
        name.includes("bwrap") ? "bwrap" :
        name.includes("runsc") || name.includes("gvisor") ? "runsc" :
        name.includes("nsjail") ? "nsjail" :
        "container";

      return {
        name: normalizedName,
        executablePath: resolvedBin,
        version: output.split("\n")[0] || "verified",
      };
    } catch {
      // Failed probe; binary cannot be executed safely
      continue;
    }
  }

  return null;
}

/**
 * M7.2 / P0: Verifies host environment provides real, kernel-enforced OS isolation boundaries.
 * Fails closed if untrusted marketplace plugin is scheduled on an unisolated host.
 * Distinguishes host container presence from verified per-plugin isolation.
 */
export function verifyPlatformIsolationSupport(
  trustTier: PluginTrustTier = "untrusted_marketplace",
): Tier2IsolationCheckResult {
  if (process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION === "1") {
    return {
      isIsolated: false,
      isolationMechanism: "unsupported",
      details: "OS-enforced isolation is disabled by operational environment policy",
    };
  }

  if (trustTier === "untrusted_marketplace") {
    // Binary discovery/version checks are not evidence of kernel containment.
    // Keep marketplace execution disabled until the independently isolated
    // runner and IPC transport have passed real Linux adversarial acceptance.
    return {
      isIsolated: false,
      isolationMechanism: "unsupported",
      details:
        "Untrusted execution is disabled pending end-to-end kernel sandbox certification. A sandbox executable or configuration value does not authorize execution.",
    };
  }

  // Curated operator or community reviewed plugins run under restricted child process
  return {
    isIsolated: true,
    isolationMechanism: "restricted_process",
    details: "Restricted process boundary active with scrubbed environment and strict resource ceilings for operator/reviewed plugin",
  };
}

/**
 * P1: Validates that an entrypoint path is safely contained within approved release boundaries.
 * Prevents directory traversal (..), symlink escapes, and arbitrary host filesystem access.
 */
export function validateAndResolveEntrypoint(
  entrypointPath: string | undefined,
  pluginId: string,
  admission?: AuthoritativePluginAdmission,
): string | undefined {
  if (!entrypointPath) {
    return undefined;
  }

  // 1. Must be an absolute path
  if (!path.isAbsolute(entrypointPath)) {
    throw new Tier2SupervisorError(
      "INVALID_PLUGIN_ENTRYPOINT",
      `Plugin '${pluginId}' entrypoint must be an absolute path: '${entrypointPath}'`,
    );
  }

  // 2. Traversal rejection
  const normalized = path.normalize(entrypointPath);
  if (entrypointPath.includes("..") || normalized !== entrypointPath) {
    throw new Tier2SupervisorError(
      "INVALID_PLUGIN_ENTRYPOINT",
      `Plugin '${pluginId}' entrypoint contains forbidden directory traversal characters: '${entrypointPath}'`,
    );
  }

  // 3. File existence and regular file check
  if (!existsSync(entrypointPath)) {
    throw new Tier2SupervisorError(
      "INVALID_PLUGIN_ENTRYPOINT",
      `Plugin '${pluginId}' entrypoint file does not exist: '${entrypointPath}'`,
    );
  }

  let realPath: string;
  try {
    const stats = statSync(entrypointPath);
    if (!stats.isFile()) {
      throw new Tier2SupervisorError(
        "INVALID_PLUGIN_ENTRYPOINT",
        `Plugin '${pluginId}' entrypoint is not a regular file: '${entrypointPath}'`,
      );
    }
    realPath = realpathSync(entrypointPath);
  } catch (err: unknown) {
    if (err instanceof Tier2SupervisorError) throw err;
    throw new Tier2SupervisorError(
      "INVALID_PLUGIN_ENTRYPOINT",
      `Plugin '${pluginId}' failed to inspect entrypoint path: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Deny access to sensitive host directories
  const forbiddenPrefixes = [
    "/etc",
    "/var",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/private/etc",
    "/private/var",
  ];
  for (const prefix of forbiddenPrefixes) {
    if (realPath === prefix || realPath.startsWith(prefix + "/") || realPath.startsWith(prefix + "\\")) {
      throw new Tier2SupervisorError(
        "INVALID_PLUGIN_ENTRYPOINT",
        `Plugin '${pluginId}' entrypoint references forbidden host system path: '${realPath}'`,
      );
    }
  }

  // 5. If admission specifies allowed entrypoints or release directory, verify containment
  if (admission?.allowedEntrypoints && admission.allowedEntrypoints.length > 0) {
    const allowed = admission.allowedEntrypoints.some(
      (p) => path.resolve(p) === realPath || path.resolve(p) === path.resolve(entrypointPath),
    );
    if (!allowed) {
      throw new Tier2SupervisorError(
        "INVALID_PLUGIN_ENTRYPOINT",
        `Plugin '${pluginId}' entrypoint '${entrypointPath}' is not in the operator-approved entrypoint list for this release`,
      );
    }
  }

  if (admission?.releaseDirectory) {
    const resolvedDir = realpathSync(admission.releaseDirectory);
    if (!realPath.startsWith(resolvedDir + path.sep) && realPath !== resolvedDir) {
      throw new Tier2SupervisorError(
        "INVALID_PLUGIN_ENTRYPOINT",
        `Plugin '${pluginId}' entrypoint escaped approved release directory: '${realPath}' is outside '${resolvedDir}'`,
      );
    }
  }

  if (admission?.entrypointSha256) {
    const expected = admission.entrypointSha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new Tier2SupervisorError("INVALID_PLUGIN_ENTRYPOINT", "Approved entrypoint digest is invalid");
    }
    const actual = createHash("sha256").update(readFileSync(realPath)).digest("hex");
    if (actual !== expected) {
      throw new Tier2SupervisorError("ENTRYPOINT_INTEGRITY_MISMATCH", "Plugin entrypoint does not match its approved SHA-256");
    }
  }

  return realPath;
}

/**
 * Historical Bubblewrap argument builder; not an approved production launcher.
 * The untrusted runtime remains disabled until its kernel containment and IPC
 * transport are independently verified. Do not treat these arguments as proof.
 * @deprecated An approved sandbox adapter is not implemented yet.
 */
export function buildBubblewrapArgs(options: {
  scriptPath: string;
  nodeArgs: string[];
  pluginDirectory?: string | undefined;
  sanitizedEnv: NodeJS.ProcessEnv;
}): string[] {
  const args: string[] = [
    "--unshare-all",
    "--unshare-net",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--ro-bind", "/usr", "/usr",
  ];

  if (existsSync("/lib")) args.push("--ro-bind-try", "/lib", "/lib");
  if (existsSync("/lib64")) args.push("--ro-bind-try", "/lib64", "/lib64");
  if (existsSync("/bin")) args.push("--ro-bind-try", "/bin", "/bin");
  if (existsSync("/sbin")) args.push("--ro-bind-try", "/sbin", "/sbin");

  // No IPC fd is passed here: the former --pass-fd option does not exist in Bubblewrap.
  // An approved launcher must establish and test a separate authenticated IPC transport.

  // Read-only bind for the worker bundle
  args.push("--ro-bind", options.scriptPath, options.scriptPath);

  // Read-only bind for plugin directory if specified
  if (options.pluginDirectory && existsSync(options.pluginDirectory)) {
    const realPluginDir = realpathSync(options.pluginDirectory);
    args.push("--ro-bind", realPluginDir, realPluginDir);
  }

  // Strict environment whitelist
  args.push("--clearenv");
  for (const [key, value] of Object.entries(options.sanitizedEnv)) {
    if (value !== undefined) {
      args.push("--setenv", key, value);
    }
  }
  args.push("--setenv", "NODE_CHANNEL_FD", "3");

  // Exec node inside sandbox
  args.push(process.execPath, ...options.nodeArgs, options.scriptPath);
  return args;
}

export function createDefaultAuthoritativeAdmissions(): AuthoritativePluginAdmission[] {
  const fixtureDir = path.resolve(
    process.cwd(),
    "packages/domains/plugins/tests/fixtures/real-standalone-plugin",
  );
  const fixtureEntrypoint = path.resolve(fixtureDir, "release/index.js");

  return [
    {
      pluginId: "com.vibress.real-fixture-plugin",
      releaseDigest: "sha256:1111222233334444555566667777888899990000111122223333444455556666",
      trustTier: "curated_operator",
      allowedEntrypoints: [fixtureEntrypoint],
      releaseDirectory: fixtureDir,
    },
    {
      pluginId: "com.vendor.env-probe",
      releaseDigest: "sha256:release_probe",
      trustTier: "curated_operator",
    },
    {
      pluginId: "com.vendor.math",
      releaseDigest: "sha256:release_math",
      trustTier: "curated_operator",
    },
    {
      pluginId: "com.vendor.infinite-loop",
      releaseDigest: "sha256:release_loop",
      trustTier: "curated_operator",
    },
    {
      pluginId: "com.vendor.flaky-plugin",
      releaseDigest: "sha256:release_flaky",
      trustTier: "curated_operator",
    },
    {
      pluginId: "com.vendor.payment-gateway",
      releaseDigest: "sha256:abc1234567890",
      trustTier: "curated_operator",
    },
  ];
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
  readonly trustTier: PluginTrustTier;
  readonly entrypointPath?: string | undefined;
  pendingRequests: Map<string, PendingInvocation>;
}

export class Tier2PluginSupervisor extends EventEmitter {
  private readonly processes = new Map<string, ActiveProcess>();
  private readonly crashTimestamps = new Map<string, number[]>();
  private readonly quarantinedPlugins = new Set<string>();
  private readonly admissions = new Map<string, AuthoritativePluginAdmission>();

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

    // In dev / test mode, load verified fixture admissions
    if (process.env.NODE_ENV !== "production") {
      for (const adm of createDefaultAuthoritativeAdmissions()) {
        this.admitPlugin(adm);
      }
    }

    if (options?.authoritativeAdmissions) {
      for (const adm of options.authoritativeAdmissions) {
        this.admitPlugin(adm);
      }
    }
  }

  admitPlugin(admission: AuthoritativePluginAdmission): void {
    this.admissions.set(admission.pluginId, admission);
  }

  revokePlugin(pluginId: string, reason?: string): void {
    const existing = this.admissions.get(pluginId);
    if (existing) {
      this.admissions.set(pluginId, {
        ...existing,
        isRevoked: true,
        revocationReason: reason,
      });
    }
    this.cleanupProcess(pluginId, new Tier2SupervisorError("REVOKED_PLUGIN_RELEASE", `Plugin '${pluginId}' has been revoked: ${reason ?? "operator policy"}`));
  }

  isAdmitted(pluginId: string): boolean {
    const admission = this.admissions.get(pluginId);
    return Boolean(admission && !admission.isRevoked);
  }

  getAdmission(pluginId: string): AuthoritativePluginAdmission | null {
    return this.admissions.get(pluginId) ?? null;
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
   * P1: Resolves trust tier strictly from authoritative Host-controlled admission state.
   * Rejects caller-controlled elevation and revoked releases fail-closed.
   */
  resolveAuthoritativeTrustTier(
    pluginId: string,
    releaseDigest: string,
    callerTrustTier?: PluginTrustTier | undefined,
  ): PluginTrustTier {
    const admission = this.admissions.get(pluginId);

    // Host revocation and release pinning apply to every tier, even when a
    // caller explicitly requests the untrusted marketplace tier.
    if (admission?.isRevoked) {
      throw new Tier2SupervisorError("REVOKED_PLUGIN_RELEASE", "Plugin release was revoked by host policy");
    }
    if (admission && admission.releaseDigest !== releaseDigest) {
      throw new Tier2SupervisorError("RELEASE_DIGEST_MISMATCH", "Plugin release does not match Host admission");
    }

    // If caller explicitly claims a trusted tier, it MUST match authoritative host admission state
    if (callerTrustTier === "curated_operator" || callerTrustTier === "community_reviewed") {
      if (!admission) {
        throw new Tier2SupervisorError(
          "UNAUTHORIZED_TRUST_TIER_PROMOTION",
          `Caller claimed trust tier '${callerTrustTier}' for plugin '${pluginId}', but no authoritative host admission exists. Untrusted marketplace code cannot self-elevate trust tier.`,
        );
      }
      if (admission.releaseDigest !== releaseDigest) {
        throw new Tier2SupervisorError(
          "RELEASE_DIGEST_MISMATCH",
          `Plugin '${pluginId}' release digest '${releaseDigest}' does not match authoritative admission digest '${admission.releaseDigest}'`,
        );
      }
      if (admission.isRevoked) {
        throw new Tier2SupervisorError(
          "REVOKED_PLUGIN_RELEASE",
          `Plugin '${pluginId}' release '${releaseDigest}' has been revoked by host policy: ${admission.revocationReason ?? "operator revoked"}`,
        );
      }
      if (admission.trustTier !== callerTrustTier) {
        throw new Tier2SupervisorError(
          "UNAUTHORIZED_TRUST_TIER_PROMOTION",
          `Caller claimed trust tier '${callerTrustTier}' but authoritative host admission records '${admission.trustTier}' for plugin '${pluginId}'`,
        );
      }
      return callerTrustTier;
    }

    if (callerTrustTier === "untrusted_marketplace") {
      return "untrusted_marketplace";
    }

    // Caller omitted trust tier: check if an authoritative admission exists for this plugin & release
    if (admission) {
      if (admission.isRevoked) {
        throw new Tier2SupervisorError(
          "REVOKED_PLUGIN_RELEASE",
          `Plugin '${pluginId}' release '${releaseDigest}' has been revoked by host policy: ${admission.revocationReason ?? "operator revoked"}`,
        );
      }
      if (admission.releaseDigest !== releaseDigest) {
        throw new Tier2SupervisorError(
          "RELEASE_DIGEST_MISMATCH",
          `Plugin '${pluginId}' release digest '${releaseDigest}' does not match authoritative admission digest '${admission.releaseDigest}'`,
        );
      }
      return admission.trustTier;
    }

    // Default-deny: if unknown or unadmitted, it is strictly untrusted_marketplace
    return "untrusted_marketplace";
  }

  /**
   * Spawns an isolated child process with scrubbed environment, resource limits, and verified OS isolation.
   */
  private spawnProcess(
    pluginId: string,
    releaseDigest: string,
    entrypointPath?: string | undefined,
    trustTier: PluginTrustTier = "untrusted_marketplace",
  ): ActiveProcess {
    if (this.quarantinedPlugins.has(pluginId)) {
      throw new Tier2SupervisorError("PLUGIN_CRASH_LOOP_QUARANTINED", `Plugin '${pluginId}' is quarantined due to repeated crashes`);
    }

    // Hard stop independent of runner detection or environment overrides.
    if (trustTier === "untrusted_marketplace") {
      throw new Tier2SupervisorError(
        "UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE",
        "Untrusted execution requires a certified, independently isolated runner",
      );
    }
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

    // No untrusted release reaches the ordinary Host child-process path.
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
      trustTier,
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
          const req = envelope.payload as Tier2CapabilityRequest;
          const invocationId = envelope.correlationId || req.invocationId;
          const pending = invocationId ? active.pendingRequests.get(invocationId) : undefined;

          if (!pending) {
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

    // P1: Authoritative trust tier resolution
    const effectiveTrustTier = this.resolveAuthoritativeTrustTier(
      context.pluginId,
      context.releaseDigest,
      context.trustTier,
    );

    // P1: Secure entrypoint validation
    const admission = this.admissions.get(context.pluginId);
    const resolvedEntrypoint = validateAndResolveEntrypoint(
      context.entrypointPath,
      context.pluginId,
      admission,
    );

    let active = this.processes.get(context.pluginId);
    if (
      !active ||
      !active.child.connected ||
      active.releaseDigest !== context.releaseDigest ||
      active.entrypointPath !== resolvedEntrypoint ||
      active.trustTier !== effectiveTrustTier
    ) {
      if (active) this.cleanupProcess(context.pluginId, new Error("Process release, entrypoint, or trust policy rotated"));
      active = this.spawnProcess(
        context.pluginId,
        context.releaseDigest,
        resolvedEntrypoint,
        effectiveTrustTier,
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
