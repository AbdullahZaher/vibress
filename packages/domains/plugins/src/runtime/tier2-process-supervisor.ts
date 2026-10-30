import { fork, spawn, execFileSync, ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync, readdirSync, lstatSync, statSync, realpathSync } from "node:fs";
import * as path from "node:path";
import {
  signTier2IpcEnvelope,
  verifyTier2IpcEnvelope,
  encodeTier2IpcFrame,
  StreamIpcReader,
  type Tier2IpcEnvelope,
} from "./tier2-ipc.js";
import {
  executeHostCapabilityRequest,
  type HostCapabilityHandlers,
  type Tier2CapabilityContext,
  type Tier2CapabilityRequest,
} from "./tier2-capability-gateway.js";
import type { PluginTrustTier } from "../application/plugin-catalog.js";
import { Tier2KernelCgroupLease, parseBubblewrapChildPid } from "./tier2-kernel-resource-limits.js";

export interface AuthoritativePluginAdmission {
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly trustTier: PluginTrustTier;
  readonly allowedEntrypoints?: readonly string[] | undefined;
  readonly releaseDirectory?: string | undefined;
  /** Optional pinned SHA-256 of the entrypoint file (not the release archive). */
  readonly entrypointSha256?: string | undefined;
  /** Optional pinned SHA-256 map of all files in the release directory. */
  readonly releaseArtifactManifest?: Readonly<Record<string, string>> | undefined;
  /** Host-approved publication scope for independently isolated marketplace code. */
  readonly approvedPublicationIds?: readonly string[] | undefined;
  /** Host-approved maximum capabilities (callers may request a subset only). */
  readonly approvedCapabilities?: readonly string[] | undefined;
  readonly isRevoked?: boolean | undefined;
  readonly revocationReason?: string | undefined;
  readonly publisherId?: string | undefined;
  readonly isPublisherRevoked?: boolean | undefined;
  readonly publisherRevocationReason?: string | undefined;
  /** Monotonically increasing revision from durable Host admission authority. */
  readonly policyRevision?: number | undefined;
}


export interface Tier2SandboxOptions {
  readonly maxOldSpaceSizeMb?: number | undefined;
  readonly invocationTimeoutMs?: number | undefined;
  readonly maxCrashCount?: number | undefined;
  readonly crashWindowMs?: number | undefined;
  readonly workerScriptPath?: string | undefined;
  readonly authoritativeAdmissions?: readonly AuthoritativePluginAdmission[] | undefined;
  /** Durable Host-controlled admission lookup. Mandatory for untrusted execution. */
  readonly loadMarketplaceAdmission?: (
    pluginId: string,
  ) => Promise<AuthoritativePluginAdmission | null>;
}

/**
 * Compare persisted Host admission against the previously observed policy.
 * No callsite-provided tier or plugin ID can upgrade an admission, and a
 * delayed DB reply cannot roll a worker back to an earlier policy revision.
 */
export function validateMarketplaceAdmissionRefresh(
  pluginId: string,
  previous: AuthoritativePluginAdmission,
  current: AuthoritativePluginAdmission | null,
): AuthoritativePluginAdmission {
  if (!current || current.pluginId !== pluginId || current.trustTier !== "untrusted_marketplace") {
    throw new Tier2SupervisorError(
      "UNTRUSTED_ADMISSION_NOT_AUTHORIZED",
      "Durable Host admission is absent or does not authorize this marketplace plugin",
    );
  }
  if (!Number.isSafeInteger(current.policyRevision) || (current.policyRevision ?? 0) <= 0) {
    throw new Tier2SupervisorError(
      "UNTRUSTED_ADMISSION_REVISION_INVALID",
      "Marketplace admission must have an authoritative positive policy revision",
    );
  }
  if (previous.policyRevision !== undefined &&
      current.policyRevision! < previous.policyRevision) {
    throw new Tier2SupervisorError(
      "UNTRUSTED_ADMISSION_STALE",
      "An older Host admission revision cannot replace a newer policy",
    );
  }
  if (current.policyRevision === previous.policyRevision &&
      !isDeepStrictEqual(current, previous)) {
    throw new Tier2SupervisorError(
      "UNTRUSTED_ADMISSION_REVISION_CONFLICT",
      "Host admission content changed without a new authoritative revision",
    );
  }
  return current;
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
 * P0 / M8.3: Discovers and verifies real OS-level sandbox runner executables.
 * Environment variables alone are NEVER treated as proof of active isolation.
 * An active execution probe is required to prove the runner is functional and
 * that unprivileged user/mount namespaces can actually be created on this kernel.
 */
export function detectSandboxRunner(preferredName?: string): VerifiedSandboxRunner | null {
  if (process.platform !== "linux" || process.env.VIBRESS_FORCE_UNSUPPORTED_ISOLATION === "1") {
    return null;
  }

  // Diagnostic discovery ONLY. A version check never authorizes execution.
  // Do not execute arbitrary PATH entries or caller-selected binaries as Host.
  const requested = preferredName ?? process.env.VIBRESS_TIER2_SANDBOX_RUNNER;
  const trustedPaths = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"] as const;
  if (requested && requested !== "bwrap" && !trustedPaths.some((candidate) => candidate === requested)) {
    return null;
  }
  const candidates = requested && requested.startsWith("/")
    ? [requested]
    : [...trustedPaths];

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const binary = realpathSync(candidate);
      const stats = statSync(binary);
      // Require a root-owned binary with no group/other write permission.
      // A local executable in writable directories is not a trusted sandbox.
      if (!stats.isFile() || stats.uid !== 0 || (stats.mode & 0o022) !== 0 || (stats.mode & 0o111) === 0) {
        continue;
      }
      const version = execFileSync(binary, ["--version"], {
        timeout: 2000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { PATH: "/usr/bin:/bin" },
      }).trim();

      // Test functional namespace smoke: verify that bwrap can actually create user and mount namespaces on this kernel
      try {
        execFileSync(binary, [
          "--unshare-all",
          "--proc", "/proc",
          "--dev", "/dev",
          "--tmpfs", "/tmp",
          "--ro-bind", "/bin", "/bin",
          "--ro-bind-try", "/usr", "/usr",
          "true",
        ], {
          timeout: 2000,
          stdio: "ignore",
          env: { PATH: "/usr/bin:/bin" },
        });
      } catch {
        // Namespace creation not supported on this kernel / container configuration
        continue;
      }

      return {
        name: "bwrap",
        executablePath: binary,
        version: version.split("\n")[0]?.slice(0, 128) || "detected",
      };
    } catch {
      // No fallback or privilege downgrade.
    }
  }
  return null;
}

/**
 * M7.2 / P0 / M8.3: Verifies host environment provides real, kernel-enforced OS isolation boundaries.
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
    // A detected Bubblewrap binary is not sufficient to isolate kernel
    // resources. Until mandatory cgroup v2 quotas and their acceptance tests
    // exist, deny immediately; running synchronous runner probes on every
    // rejected invocation would itself expose the Host to CPU/latency DoS.
    return {
      isIsolated: false,
      isolationMechanism: "unsupported",
      details: "Untrusted execution disabled pending certified per-plugin kernel CPU, memory and PID resource quotas",
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
 * Files verified by SHA-256 must not be writable/replaced by the non-root
 * API/Worker identity between verification and Bubblewrap's ro-bind mount.
 * A read-only bind does not make a mutable source directory immutable.
 *
 * An operator must stage marketplace code in a ROOT-owned, non-writable tree
 * (including ancestors). This rejects normal writable publication/content
 * volumes and symlink/hardlink aliases. It is not a defense against a
 * compromised host administrator, external mount changes or direct block I/O.
 */
export function assertImmutableUntrustedReleaseTree(releaseDirectory: string): void {
  if (process.platform !== "linux" || typeof process.getuid !== "function" ||
      process.getuid() === 0 || !path.isAbsolute(releaseDirectory)) {
    throw new Tier2SupervisorError(
      "UNTRUSTED_RELEASE_NOT_IMMUTABLE",
      "Marketplace artifacts require a non-root Linux worker and an operator-owned immutable release tree",
    );
  }

  let current = path.parse(releaseDirectory).root;
  const parts = path.relative(current, releaseDirectory).split(path.sep).filter(Boolean);
  const ensureOwned = (file: string, isDirectory: boolean): void => {
    let info: ReturnType<typeof lstatSync>;
    try { info = lstatSync(file); } catch {
      throw new Tier2SupervisorError("UNTRUSTED_RELEASE_NOT_IMMUTABLE", "Immutable release artifact is inaccessible");
    }
    if (info.uid !== 0 || (info.mode & 0o022) !== 0 ||
        (isDirectory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) {
      throw new Tier2SupervisorError(
        "UNTRUSTED_RELEASE_NOT_IMMUTABLE",
        "Marketplace artifact or ancestor is writable, linked, or not owned by the host operator",
      );
    }
  };
  ensureOwned(current, true);
  for (const part of parts) {
    current = path.join(current, part);
    ensureOwned(current, true);
  }
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        ensureOwned(full, true);
        visit(full);
      } else {
        // This also rejects symlinks, devices, sockets, and hardlinked files.
        ensureOwned(full, false);
      }
    }
  };
  visit(releaseDirectory);
}

/**
 * M8.4: Verifies the integrity of an approved release directory and all artifacts.
 * Enforces publisher revocation, release revocation, digest matching, artifact manifest
 * checksums, and protection against symlink escapes or unauthorized file injections.
 */
export function verifyReleaseIntegrity(
  pluginId: string,
  releaseDigest: string,
  admission: AuthoritativePluginAdmission,
): void {
  if (admission.trustTier === "untrusted_marketplace" && (
    !admission.releaseDirectory ||
    !admission.releaseArtifactManifest ||
    Object.keys(admission.releaseArtifactManifest).length === 0
  )) {
    throw new Tier2SupervisorError(
      "UNTRUSTED_RELEASE_ADMISSION_INCOMPLETE",
      "Untrusted release integrity verification requires a complete approved directory and manifest",
    );
  }
  if (admission.isRevoked) {
    throw new Tier2SupervisorError(
      "REVOKED_PLUGIN_RELEASE",
      `Plugin '${pluginId}' release '${releaseDigest}' has been revoked by host policy: ${admission.revocationReason ?? "operator revoked"}`,
    );
  }
  if (admission.isPublisherRevoked) {
    throw new Tier2SupervisorError(
      "REVOKED_PLUGIN_PUBLISHER",
      `Plugin '${pluginId}' publisher '${admission.publisherId ?? "unknown"}' has been revoked by host policy: ${admission.publisherRevocationReason ?? "operator revoked"}`,
    );
  }
  if (admission.releaseDigest !== releaseDigest) {
    throw new Tier2SupervisorError(
      "RELEASE_DIGEST_MISMATCH",
      `Plugin '${pluginId}' release digest '${releaseDigest}' does not match authoritative admission digest '${admission.releaseDigest}'`,
    );
  }
  if (admission.releaseDirectory) {
    if (!existsSync(admission.releaseDirectory)) {
      throw new Tier2SupervisorError(
        "INVALID_RELEASE_DIRECTORY",
        `Plugin '${pluginId}' release directory does not exist: '${admission.releaseDirectory}'`,
      );
    }
    const realDir = realpathSync(admission.releaseDirectory);
    const dirStat = statSync(realDir);
    if (!dirStat.isDirectory()) {
      throw new Tier2SupervisorError(
        "INVALID_RELEASE_DIRECTORY",
        `Plugin '${pluginId}' release directory is not a directory: '${realDir}'`,
      );
    }
    if (admission.trustTier === "untrusted_marketplace" && !admission.releaseArtifactManifest) {
      throw new Tier2SupervisorError(
        "UNTRUSTED_RELEASE_ADMISSION_INCOMPLETE",
        "Untrusted releases require a complete approved artifact manifest",
      );
    }
    if (admission.releaseArtifactManifest) {
      const manifest = admission.releaseArtifactManifest;
      for (const [file, digest] of Object.entries(manifest)) {
        if (
          !file || path.posix.isAbsolute(file) || file.includes("\\") ||
          file.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
          !/^[a-f0-9]{64}$/i.test(digest)
        ) {
          throw new Tier2SupervisorError(
            "INVALID_RELEASE_ARTIFACT_MANIFEST",
            "Approved release manifest contains an invalid path or file digest",
          );
        }
      }
      const seen = new Set<string>();

      const scanDir = (current: string, rel: string) => {
        const entries = readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          const entryRel = (rel ? `${rel}/${entry.name}` : entry.name).replace(/\\/g, "/");

          if (entry.isSymbolicLink() && admission.trustTier === "untrusted_marketplace") {
            throw new Tier2SupervisorError(
              "UNTRUSTED_RELEASE_SYMLINK_DENIED",
              `Untrusted release artifact '${entryRel}' cannot be a symbolic link`,
            );
          }
          if (entry.isSymbolicLink()) {
            const target = realpathSync(full);
            if (!target.startsWith(realDir + path.sep) && target !== realDir) {
              throw new Tier2SupervisorError(
                "SYMLINK_ESCAPE_DETECTED",
                `Plugin '${pluginId}' release artifact '${entryRel}' points outside release directory: '${target}'`,
              );
            }
          }

          if (entry.isDirectory()) {
            scanDir(full, entryRel);
          } else if (entry.isFile()) {
            seen.add(entryRel);
            const expected = Object.hasOwn(manifest, entryRel) ? manifest[entryRel]?.toLowerCase() : undefined;
            if (!expected) {
              throw new Tier2SupervisorError(
                "UNAUTHORIZED_ARTIFACT_INJECTED",
                `Plugin '${pluginId}' contains unapproved or injected artifact: '${entryRel}'`,
              );
            }
            if (!/^[a-f0-9]{64}$/.test(expected)) {
              throw new Tier2SupervisorError(
                "INVALID_RELEASE_ARTIFACT_MANIFEST",
                `Approved artifact '${entryRel}' has an invalid SHA-256`,
              );
            }
            const actual = createHash("sha256").update(readFileSync(full)).digest("hex");
            if (actual !== expected) {
              throw new Tier2SupervisorError(
                "ARTIFACT_INTEGRITY_MISMATCH",
                `Plugin '${pluginId}' artifact '${entryRel}' digest mismatch. Expected ${expected}, got ${actual}`,
              );
            }
          }
        }
      };

      scanDir(realDir, "");

      for (const required of Object.keys(manifest)) {
        if (!seen.has(required)) {
          throw new Tier2SupervisorError(
            "ARTIFACT_MISSING",
            `Plugin '${pluginId}' missing required release artifact: '${required}'`,
          );
        }
      }
      if (admission.trustTier === "untrusted_marketplace") {
        assertImmutableUntrustedReleaseTree(realDir);
      }
    }
  }
}

/**
 * M8.3 / M8.4: Builds production Bubblewrap sandbox arguments for independently enforced Linux namespaces.
 * Unshares user, mount, network, pid, ipc, and uts namespaces; enforces read-only root and plugin mounts;
 * cleanses the environment and prepares stdio binary IPC.
 */
export function buildBubblewrapArgs(options: {
  scriptPath: string;
  nodeArgs: string[];
  pluginDirectory?: string | undefined;
  sanitizedEnv: NodeJS.ProcessEnv;
  /** Additional pipe held by Host until the launcher is attached to cgroup v2. */
  blockFd?: number | undefined;
  infoFd?: number | undefined;
}): string[] {
  const args: string[] = [
    "--unshare-all",
    "--unshare-net",
    "--new-session",
    "--die-with-parent",
    ...(options.blockFd === undefined ? [] : ["--block-fd", String(options.blockFd)]),
    ...(options.infoFd === undefined ? [] : ["--info-fd", String(options.infoFd)]),
    "--ro-bind", "/usr", "/usr",
  ];

  if (existsSync("/lib")) args.push("--ro-bind-try", "/lib", "/lib");
  if (existsSync("/lib64")) args.push("--ro-bind-try", "/lib64", "/lib64");
  if (existsSync("/bin")) args.push("--ro-bind-try", "/bin", "/bin");
  if (existsSync("/sbin")) args.push("--ro-bind-try", "/sbin", "/sbin");

  args.push("--proc", "/proc");
  args.push("--dev", "/dev");
  args.push("--tmpfs", "/tmp");

  // Read-only bind for the Node executable
  const nodeBinary = realpathSync(process.execPath);
  args.push("--ro-bind", nodeBinary, nodeBinary);

  // Read-only bind for the worker bundle
  const realScript = realpathSync(options.scriptPath);
  args.push("--ro-bind", realScript, realScript);

  // Read-only bind for plugin directory if specified
  if (options.pluginDirectory && existsSync(options.pluginDirectory)) {
    const realPluginDir = realpathSync(options.pluginDirectory);
    args.push("--ro-bind", realPluginDir, realPluginDir);
  }

  args.push("--chdir", "/tmp");

  // Strict environment whitelist
  args.push("--clearenv");
  for (const [key, value] of Object.entries(options.sanitizedEnv)) {
    if (value !== undefined) {
      args.push("--setenv", key, value);
    }
  }

  // Exec node inside sandbox
  args.push(nodeBinary, ...options.nodeArgs, realScript);
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

/**
 * An untrusted worker must not share imported-module state across publications
 * or actors. Trusted operator plugins preserve historical per-plugin reuse.
 * This key is internal process bookkeeping, not an authorization decision.
 */
export function tier2ProcessIsolationKey(
  context: Pick<Tier2InvocationContext, "pluginId" | "publicationId" | "actor">,
  trustTier: PluginTrustTier,
): string {
  return trustTier === "untrusted_marketplace"
    ? `U:${JSON.stringify([context.pluginId, context.publicationId, context.actor.type, context.actor.id])}`
    : `T:${context.pluginId}`;
}


/**
 * Bubblewrap forks an internal child before the --block-fd checkpoint.
 * Read its authenticated-by-local-process (not plugin-supplied) PID from
 * --info-fd, fail on malformed/truncated output, and never release the
 * sandbox until BOTH its launcher and child are attached to cgroup v2.
 */
function awaitBubblewrapChildPid(stream: Readable, child: ChildProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let info = "";
    const timer = setTimeout(
      () => finish(new Tier2SupervisorError("CGROUP_CHILD_PID_TIMEOUT", "Sandbox child identity was not reported")),
      5000,
    );
    timer.unref();
    const onData = (chunk: Buffer | string) => {
      info += chunk.toString();
      if (info.length > 4096) {
        finish(new Tier2SupervisorError("CGROUP_CHILD_PID_INVALID", "Oversized sandbox child identity"));
      }
    };
    const onEnd = () => {
      try { finish(null, parseBubblewrapChildPid(info)); }
      catch (error: unknown) { finish(error instanceof Error ? error : new Error("Invalid sandbox child identity")); }
    };
    const onError = (error: Error) => finish(error);
    const onExit = () => finish(new Tier2SupervisorError("CGROUP_CHILD_PID_MISSING", "Sandbox exited before reporting its child PID"));
    const finish = (error: Error | null, pid?: number) => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error || pid === undefined) reject(error ?? new Error("Missing sandbox child PID"));
      else resolve(pid);
    };
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

const MAX_MARKETPLACE_STDERR_BYTES = 256 * 1024;
const MAX_MARKETPLACE_STDOUT_BYTES = 8 * 1024 * 1024;

/**
 * Whole-process output budget. Retiring a flooder avoids spending unbounded
 * Host CPU parsing/absorbing attacker-controlled output in long-lived workers.
 */
export function countSandboxOutputBytes(previous: number, chunkBytes: number, maxBytes: number): number {
  if (!Number.isSafeInteger(previous) || previous < 0 ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      chunkBytes > maxBytes - previous) {
    throw new Tier2SupervisorError(
      "SANDBOX_OUTPUT_LIMIT",
      "Marketplace worker exceeded its Host output quota",
    );
  }
  return previous + chunkBytes;
}

interface PendingInvocation {
  readonly context: Tier2InvocationContext;
  readonly handlers: HostCapabilityHandlers;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  capabilityRequestCount: number;
}

interface ActiveProcess {
  /** Scoped identity for process reuse and asynchronous cleanup. */
  readonly processKey: string;
  readonly child: ChildProcess;
  readonly resourceLease?: Tier2KernelCgroupLease | undefined;
  readonly startupReady?: Promise<void> | undefined;
  readonly seenCapabilityMessageIds: Set<string>;
  readonly sessionKey: string;
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly trustTier: PluginTrustTier;
  readonly entrypointPath?: string | undefined;
  readonly transport: "ipc" | "stdio";
  readonly isolationMechanism: Tier2IsolationCheckResult["isolationMechanism"];
  latestStderr?: string | undefined;
  stdoutBytes: number;
  stderrBytes: number;
  pendingRequests: Map<string, PendingInvocation>;
}

export class Tier2PluginSupervisor extends EventEmitter {
  // Trusted operator processes retain legacy per-plugin reuse; untrusted code
  // is scoped to publication and actor to prevent shared module state.
  private readonly processes = new Map<string, ActiveProcess>();
  private readonly crashTimestamps = new Map<string, number[]>();
  private readonly quarantinedPlugins = new Set<string>();
  private readonly admissions = new Map<string, AuthoritativePluginAdmission>();

  private readonly maxOldSpaceSizeMb: number;
  private readonly invocationTimeoutMs: number;
  private readonly maxCrashCount: number;
  private readonly crashWindowMs: number;
  private readonly workerScriptPath?: string | undefined;
  private readonly loadMarketplaceAdmission?: Tier2SandboxOptions["loadMarketplaceAdmission"];

  constructor(options?: Tier2SandboxOptions) {
    super();
    this.maxOldSpaceSizeMb = options?.maxOldSpaceSizeMb ?? 64;
    this.invocationTimeoutMs = options?.invocationTimeoutMs ?? 3000;
    this.maxCrashCount = options?.maxCrashCount ?? 3;
    this.crashWindowMs = options?.crashWindowMs ?? 30_000;
    this.workerScriptPath = options?.workerScriptPath;
    this.loadMarketplaceAdmission = options?.loadMarketplaceAdmission;

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
    // Replacing Host admission immediately retires workers using old policy.
    this.cleanupPluginProcesses(
      admission.pluginId,
      new Tier2SupervisorError("PLUGIN_ADMISSION_CHANGED", "Host plugin admission changed"),
    );
    // Caller mutations and changes to returned getAdmission() objects must
    // not silently alter the Host's authorization snapshot.
    this.admissions.set(admission.pluginId, structuredClone(admission));
  }

  private cleanupPluginProcesses(pluginId: string, error: Error): void {
    for (const [key, active] of this.processes) {
      if (active.pluginId === pluginId) this.cleanupProcess(key, error);
    }
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
    this.cleanupPluginProcesses(pluginId, new Tier2SupervisorError("REVOKED_PLUGIN_RELEASE", `Plugin '${pluginId}' has been revoked: ${reason ?? "operator policy"}`));
  }

  revokePublisher(publisherId: string, reason?: string): void {
    for (const [pluginId, adm] of this.admissions.entries()) {
      if (adm.publisherId === publisherId) {
        this.admissions.set(pluginId, {
          ...adm,
          isPublisherRevoked: true,
          publisherRevocationReason: reason,
        });
        this.cleanupPluginProcesses(
          pluginId,
          new Tier2SupervisorError(
            "REVOKED_PLUGIN_PUBLISHER",
            `Plugin '${pluginId}' publisher '${publisherId}' has been revoked: ${reason ?? "operator policy"}`,
          ),
        );
      }
    }
  }

  isAdmitted(pluginId: string): boolean {
    const admission = this.admissions.get(pluginId);
    return Boolean(admission && !admission.isRevoked && !admission.isPublisherRevoked);
  }

  getAdmission(pluginId: string): AuthoritativePluginAdmission | null {
    const admission = this.admissions.get(pluginId);
    return admission ? structuredClone(admission) : null;
  }

  isQuarantined(pluginId: string): boolean {
    return this.quarantinedPlugins.has(pluginId);
  }

  resetQuarantine(pluginId: string): void {
    this.quarantinedPlugins.delete(pluginId);
    this.crashTimestamps.delete(pluginId);
  }

  getProcessState(pluginId: string): Tier2ProcessState | null {
    const active = Array.from(this.processes.values()).find((item) => item.pluginId === pluginId);
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
      if (!admission) {
        throw new Tier2SupervisorError(
          "PLUGIN_NOT_ADMITTED",
          `Plugin '${pluginId}' has no authoritative Host release admission`,
        );
      }
      // A caller must not demote a trusted admission and change its runtime policy.
      if (admission.trustTier !== callerTrustTier) {
        throw new Tier2SupervisorError(
          "UNAUTHORIZED_TRUST_TIER_OVERRIDE",
          `Requested tier differs from Host admission for plugin '${pluginId}'`,
        );
      }
      return admission.trustTier;
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

    // Unknown releases are not merely untrusted: a sandbox is NOT admission.
    throw new Tier2SupervisorError(
      "PLUGIN_NOT_ADMITTED",
      `Plugin '${pluginId}' has no authoritative Host release admission`,
    );
  }

  /**
   * Spawns an isolated child process with scrubbed environment, resource limits, and verified OS isolation.
   */
  private spawnProcess(
    pluginId: string,
    releaseDigest: string,
    entrypointPath?: string | undefined,
    trustTier: PluginTrustTier = "untrusted_marketplace",
    processKey: string = pluginId,
  ): ActiveProcess {
    if (this.quarantinedPlugins.has(pluginId)) {
      throw new Tier2SupervisorError("PLUGIN_CRASH_LOOP_QUARANTINED", `Plugin '${pluginId}' is quarantined due to repeated crashes`);
    }

    const isolation = verifyPlatformIsolationSupport(trustTier);
    if (!isolation.isIsolated) {
      throw new Tier2SupervisorError(
        "UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE",
        `Untrusted plugin execution rejected: ${isolation.details}`,
      );
    }

    const sessionKey = randomBytes(32).toString("hex");

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

    const transport: "ipc" | "stdio" = isolation.isolationMechanism === "sandbox_runner" ? "stdio" : "ipc";

    // Whitelist environment variables strictly. NO Host secrets, DB, or Redis credentials.
    const sanitizedEnv: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      VIBRESS_TIER2_SANDBOX: "1",
      VIBRESS_PLUGIN_ID: pluginId,
      VIBRESS_RELEASE_DIGEST: releaseDigest,
      VIBRESS_SESSION_KEY: sessionKey,
      ...(entrypointPath ? { VIBRESS_PLUGIN_ENTRYPOINT: entrypointPath } : {}),
      ...(transport === "stdio" ? { VIBRESS_IPC_TRANSPORT: "stdio" } : {}),
    };

    let child: ChildProcess;
    let blockedLauncher: ChildProcess | undefined;
    let resourceLease: Tier2KernelCgroupLease | undefined;
    let startupReady: Promise<void> | undefined;

    if (isolation.isolationMechanism === "sandbox_runner") {
      const runner = detectSandboxRunner();
      if (!runner) {
        throw new Tier2SupervisorError(
          "UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE",
          "Sandbox runner became unavailable",
        );
      }
      // A delegated cgroup must exist with verified limits BEFORE any plugin
      // code may run. Bwrap blocks on inherited fd 3 until Host attaches its
      // launcher to the cgroup; descendants inherit kernel-enforced ceilings.
      resourceLease = Tier2KernelCgroupLease.create();
      try {
        const bwrapArgs = buildBubblewrapArgs({
          scriptPath: script!,
          pluginDirectory: entrypointPath ? path.dirname(entrypointPath) : undefined,
          sanitizedEnv,
          nodeArgs,
          blockFd: 3,
          infoFd: 4,
        });
        child = spawn(runner.executablePath, bwrapArgs, {
          stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
        });
        blockedLauncher = child;
        const barrier = child.stdio[3];
        const childIdentity = child.stdio[4];
        if (!child.pid || !(barrier instanceof Writable) || !(childIdentity instanceof Readable)) {
          throw new Tier2SupervisorError(
            "CGROUP_LAUNCH_BLOCK_FAILED",
            "Sandbox could not create supervised execution and child-identity pipes",
          );
        }
        resourceLease.attachBlockedLauncher(child.pid);
        const lease = resourceLease;
        // Bwrap can fork its sandbox child BEFORE its --block-fd checkpoint.
        // Its actual child PID is reported through --info-fd. Attach BOTH PIDs
        // before writing the barrier, otherwise the child could escape quotas.
        startupReady = awaitBubblewrapChildPid(childIdentity, child)
          .then(async (sandboxPid) => {
            if (sandboxPid === child.pid) {
              throw new Tier2SupervisorError("CGROUP_CHILD_PID_INVALID", "Sandbox child and launcher share a PID");
            }
            lease.attachBlockedLauncher(sandboxPid);
            await new Promise<void>((resolve, reject) => {
              barrier.once("error", reject);
              barrier.end("1", () => {
                barrier.off("error", reject);
                resolve();
              });
            });
          })
          .catch((error: unknown) => {
            lease.killTree();
            this.cleanupProcess(processKey, new Tier2SupervisorError(
              "CGROUP_LAUNCH_BLOCK_FAILED",
              error instanceof Error ? error.message : "Sandbox could not be attached before execution",
            ));
            throw error;
          });
      } catch (error: unknown) {
        // If cgroup.procs attachment fails, the blocked launcher was never
        // enrolled: cgroup.kill alone cannot terminate it.
        if (blockedLauncher) {
          try { blockedLauncher.kill("SIGKILL"); } catch { /* exited during setup */ }
        }
        resourceLease.killTree();
        resourceLease.dispose();
        throw error;
      }
    } else {
      child = fork(script!, [], {
        env: sanitizedEnv,
        execArgv: nodeArgs,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
    }

    const active: ActiveProcess = {
      processKey,
      child,
      ...(resourceLease ? { resourceLease } : {}),
      ...(startupReady ? { startupReady } : {}),
      seenCapabilityMessageIds: new Set(),
      sessionKey,
      pluginId,
      releaseDigest,
      trustTier,
      entrypointPath,
      transport,
      isolationMechanism: isolation.isolationMechanism,
      stdoutBytes: 0,
      stderrBytes: 0,
      pendingRequests: new Map(),
    };

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (this.processes.get(active.processKey) !== active) return;
      if (active.trustTier === "untrusted_marketplace") {
        try {
          active.stderrBytes = countSandboxOutputBytes(
            active.stderrBytes,
            Buffer.byteLength(chunk),
            MAX_MARKETPLACE_STDERR_BYTES,
          );
        } catch {
          this.cleanupProcess(active.processKey, new Tier2SupervisorError(
            "SANDBOX_OUTPUT_LIMIT", "Marketplace worker exceeded its stderr quota",
          ));
          return;
        }
      }
      const str = chunk.toString();
      active.latestStderr = ((active.latestStderr || "") + str).slice(-8192);
    });

    if (transport === "stdio") {
      const streamReader = new StreamIpcReader(sessionKey);
      streamReader.onEnvelope((envelope) => {
        this.handleIncomingEnvelope(active, envelope).catch((err) => {
          this.emit("security_violation", { pluginId, error: err });
        });
      });
      streamReader.onError((err) => {
        // Events from a retired process must never terminate its replacement.
        if (this.processes.get(processKey) !== active) return;
        this.emit("security_violation", { pluginId, error: err });
        // Dropping a malformed frame but continuing to trust the same peer
        // permits repeated probing of the Host IPC parser.
        this.cleanupProcess(processKey, new Tier2SupervisorError(
          "IPC_PROTOCOL_VIOLATION", "Sandbox sent an invalid IPC frame",
        ));
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        if (this.processes.get(active.processKey) !== active) return;
        if (active.trustTier === "untrusted_marketplace") {
          try {
            active.stdoutBytes = countSandboxOutputBytes(
              active.stdoutBytes,
              chunk.byteLength,
              MAX_MARKETPLACE_STDOUT_BYTES,
            );
          } catch {
            this.cleanupProcess(active.processKey, new Tier2SupervisorError(
              "SANDBOX_OUTPUT_LIMIT", "Marketplace worker exceeded its IPC output quota",
            ));
            return;
          }
        }
        streamReader.feed(chunk);
      });
    } else {
      child.stdout?.resume();
      child.on("message", async (msg: unknown) => {
        try {
          const envelope = verifyTier2IpcEnvelope(msg, sessionKey);
          await this.handleIncomingEnvelope(active, envelope);
        } catch (err: unknown) {
          this.emit("security_violation", { pluginId, error: err });
        }
      });
    }

    child.on("exit", (code, signal) => {
      this.handleProcessExit(active, code, signal);
    });

    child.on("error", (err) => {
      this.handleProcessCrash(active, err);
    });

    this.processes.set(processKey, active);
    return active;
  }

  private isProcessAlive(active: ActiveProcess): boolean {
    if (active.transport === "stdio") {
      return (
        active.child.exitCode === null &&
        active.child.signalCode === null &&
        !active.child.killed
      );
    }
    return active.child.connected;
  }

  private sendToProcess(
    active: ActiveProcess,
    envelope: Tier2IpcEnvelope,
    callback?: (err?: Error | null) => void,
  ): void {
    if (active.transport === "stdio") {
      if (!active.child.stdin || active.child.stdin.destroyed) {
        callback?.(new Error("Sandbox stdin is closed or unavailable"));
        return;
      }
      try {
        const frame = encodeTier2IpcFrame(envelope);
        active.child.stdin.write(frame, (err) => {
          callback?.(err);
        });
      } catch (err: unknown) {
        callback?.(err instanceof Error ? err : new Error(String(err)));
      }
    } else {
      if (!active.child.connected) {
        callback?.(new Error("Process IPC channel is disconnected"));
        return;
      }
      active.child.send(envelope, (err) => {
        callback?.(err ?? undefined);
      });
    }
  }

  private async handleIncomingEnvelope(
    active: ActiveProcess,
    envelope: Tier2IpcEnvelope,
  ): Promise<void> {
    try {
      if (this.processes.get(active.processKey) !== active) return;
      if (envelope.pluginId !== active.pluginId || envelope.releaseDigest !== active.releaseDigest) {
        throw new Tier2SupervisorError("IPC_CONTEXT_MISMATCH", "Sandbox message identity does not match the admitted worker");
      }
      if (envelope.type === "response") {
        const pending = active.pendingRequests.get(envelope.id);
        if (pending) {
          if (envelope.publicationId !== pending.context.publicationId) {
            throw new Tier2SupervisorError("IPC_CONTEXT_MISMATCH", "Sandbox response publication does not match the invocation");
          }
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
        // A replay within the same invocation could duplicate Host-side effects.
        // Keep a bounded replay window per supervised process; retire a peer
        // that exceeds this window rather than silently accepting old messages.
        if (active.seenCapabilityMessageIds.has(envelope.id)) {
          throw new Tier2SupervisorError("IPC_REPLAY_DENIED", "Repeated sandbox capability request");
        }
        if (active.seenCapabilityMessageIds.size >= 4096) {
          // Completed invocations cannot be replayed: the Host no longer
          // retains their correlation IDs. Keep the deduplication window
          // bounded instead of exhausting a legitimate long-lived worker.
          const oldest = active.seenCapabilityMessageIds.values().next().value;
          if (oldest) active.seenCapabilityMessageIds.delete(oldest);
        }
        active.seenCapabilityMessageIds.add(envelope.id);
        const req = envelope.payload as Tier2CapabilityRequest;
        const invocationId = envelope.correlationId || req.invocationId;
        const pending = invocationId ? active.pendingRequests.get(invocationId) : undefined;

        if (pending) {
          pending.capabilityRequestCount += 1;
          if (pending.capabilityRequestCount > 128) {
            throw new Tier2SupervisorError("IPC_MESSAGE_LIMIT", "Sandbox invocation exceeded its Host capability request limit");
          }
          if (envelope.publicationId !== pending.context.publicationId) {
            // The caller-controlled envelope publication is not authority.
            // Reject this capability request without invoking any Host handler,
            // but return a signed response so the worker can reject the parent
            // invocation instead of hanging until its timeout.
            const denyEnv = signTier2IpcEnvelope({
              id: envelope.id,
              correlationId: envelope.correlationId,
              pluginId: active.pluginId,
              releaseDigest: active.releaseDigest,
              publicationId: pending.context.publicationId,
              type: "capability_response",
              payload: {
                ok: false,
                error: {
                  code: "CROSS_PUBLICATION_DENIED",
                  message: "Plugin is forbidden from requesting capabilities across publication boundaries",
                },
              },
            }, active.sessionKey);
            this.sendToProcess(active, denyEnv);
            this.emit("security_violation", {
              pluginId: active.pluginId,
              error: new Tier2SupervisorError("CROSS_PUBLICATION_DENIED", "Sandbox requested a foreign publication"),
            });
            return;
          }
        }

        if (!pending) {
          const rejectEnv = signTier2IpcEnvelope({
            id: envelope.id,
            correlationId: envelope.correlationId,
            pluginId: active.pluginId,
            releaseDigest: active.releaseDigest,
            publicationId: "untrusted",
            type: "capability_response",
            payload: {
              ok: false,
              error: {
                code: "UNAUTHORIZED_INVOCATION_CONTEXT",
                message: "Capability request is not correlated with an active, authorized Host invocation",
              },
            },
          }, active.sessionKey);
          this.sendToProcess(active, rejectEnv);
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
          pluginId: active.pluginId,
          releaseDigest: active.releaseDigest,
          publicationId: pending.context.publicationId,
          type: "capability_response",
          payload: responsePayload,
        }, active.sessionKey);
        this.sendToProcess(active, responseEnv);
      }
    } catch (err: unknown) {
      this.emit("security_violation", { pluginId: active.pluginId, error: err });
      if (active.transport === "stdio") {
        this.cleanupProcess(active.processKey, new Tier2SupervisorError(
          "IPC_SECURITY_VIOLATION", "Sandbox IPC authorization or protocol violation",
        ));
      }
    }
  }

  private handleProcessCrash(active: ActiveProcess, _error: unknown): void {
    // A late exit from an earlier worker must not terminate its replacement.
    if (this.processes.get(active.processKey) !== active) return;
    this.recordCrash(active.pluginId);
    this.cleanupProcess(active.processKey, new Tier2SupervisorError("PLUGIN_CRASHED", "Sandbox worker process crashed"));
  }

  private handleProcessExit(active: ActiveProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.processes.get(active.processKey) !== active) return;
    if (code !== 0 && signal !== "SIGTERM") {
      this.recordCrash(active.pluginId);
    }
    const stderrSuffix = active.latestStderr ? `: ${active.latestStderr.trim()}` : "";
    this.cleanupProcess(active.processKey, new Tier2SupervisorError("PLUGIN_PROCESS_EXITED", `Sandbox exited with code ${code ?? "null"} (${signal ?? "none"})${stderrSuffix}`));
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

  private cleanupProcess(processKey: string, error: Error): void {
    const active = this.processes.get(processKey);
    if (!active) return;
    this.processes.delete(processKey);
    // Fail-closed process-tree kill, even when a descendant ignores SIGTERM.
    active.resourceLease?.dispose();

    for (const [, pending] of active.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    active.pendingRequests.clear();

    try {
      if (active.transport === "ipc" && active.child.connected) {
        active.child.disconnect();
      }
      if (active.child.stdin && !active.child.stdin.destroyed) {
        active.child.stdin.destroy();
      }
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

    // M8.4: Verify release integrity and publisher revocation
    const admission = this.admissions.get(context.pluginId);
    if (!admission) {
      throw new Tier2SupervisorError(
        "PLUGIN_NOT_ADMITTED",
        `Plugin '${context.pluginId}' has no authoritative Host release admission`,
      );
    }
    // Marketplace code cannot run with an absent/partial release manifest or
    // an arbitrary entrypoint path supplied by the invocation caller.
    if (effectiveTrustTier === "untrusted_marketplace") {
      if (
        !admission.releaseDirectory ||
        !admission.releaseArtifactManifest ||
        Object.keys(admission.releaseArtifactManifest).length === 0 ||
        !admission.allowedEntrypoints?.length ||
        !context.entrypointPath ||
        !admission.approvedPublicationIds?.length ||
        !admission.approvedCapabilities
      ) {
        throw new Tier2SupervisorError(
          "UNTRUSTED_RELEASE_ADMISSION_INCOMPLETE",
          "Untrusted execution requires a pinned complete release manifest and approved entrypoint",
        );
      }
    }
    if (effectiveTrustTier === "untrusted_marketplace") {
      if (!admission.approvedPublicationIds?.includes(context.publicationId)) {
        throw new Tier2SupervisorError(
          "PUBLICATION_NOT_ADMITTED",
          "Untrusted plugin has no Host-approved execution grant for this publication",
        );
      }
      if (!context.grantedCapabilities.every((capability) =>
        admission.approvedCapabilities?.includes(capability) === true
      )) {
        throw new Tier2SupervisorError(
          "CAPABILITY_NOT_ADMITTED",
          "Requested capabilities exceed the Host-approved release grant",
        );
      }
    }
    // A per-process Map is not durable revocation authority. For marketplace
    // code, the Supervisor MUST consult the persisted Host policy every time
    // it is about to execute. Its provider must independently authenticate
    // publication/plugin ownership; the caller's IDs alone are not grants.
    let effectiveAdmission = admission;
    if (effectiveTrustTier === "untrusted_marketplace") {
      if (!this.loadMarketplaceAdmission) {
        throw new Tier2SupervisorError(
          "UNTRUSTED_ADMISSION_AUTHORITY_UNAVAILABLE",
          "Marketplace execution requires a durable Host admission authority",
        );
      }
      let refreshed: AuthoritativePluginAdmission;
      let latestObserved: AuthoritativePluginAdmission;
      try {
        const returned = await this.loadMarketplaceAdmission(context.pluginId);
        // Concurrent invocations can complete DB reads out of order. Always
        // compare a reply with the CURRENT observed revision after await,
        // never against a snapshot captured before awaiting the database.
        latestObserved = this.admissions.get(context.pluginId)!;
        if (!latestObserved) {
          throw new Tier2SupervisorError(
            "UNTRUSTED_ADMISSION_NOT_AUTHORIZED", "Marketplace admission disappeared while refreshing",
          );
        }
        refreshed = validateMarketplaceAdmissionRefresh(
          context.pluginId,
          latestObserved,
          returned,
        );
      } catch (error: unknown) {
        // A lost authority connection, a revoked/missing release, or an
        // out-of-order policy read must retire previously executing workers.
        this.cleanupPluginProcesses(context.pluginId, new Tier2SupervisorError(
          "UNTRUSTED_ADMISSION_AUTHORITY_UNAVAILABLE",
          "Marketplace Host admission could not be refreshed safely",
        ));
        throw error;
      }
      if (refreshed.policyRevision !== latestObserved.policyRevision ||
          !isDeepStrictEqual(refreshed, latestObserved)) {
        this.admitPlugin(refreshed);
      }
      effectiveAdmission = this.admissions.get(context.pluginId)!;
      if (effectiveAdmission.isRevoked || effectiveAdmission.isPublisherRevoked) {
        this.cleanupPluginProcesses(context.pluginId, new Tier2SupervisorError(
          "REVOKED_PLUGIN_RELEASE", "Durable Host policy revoked this plugin",
        ));
        throw new Tier2SupervisorError(
          "REVOKED_PLUGIN_RELEASE", "Durable Host policy revoked this plugin",
        );
      }
      if (effectiveAdmission.releaseDigest !== context.releaseDigest ||
          !effectiveAdmission.approvedPublicationIds?.includes(context.publicationId) ||
          !context.grantedCapabilities.every((cap) =>
            effectiveAdmission.approvedCapabilities?.includes(cap) === true
          )) {
        throw new Tier2SupervisorError(
          "UNTRUSTED_ADMISSION_CHANGED",
          "Current Host release, publication or capability grant does not match the request",
        );
      }
    }
    verifyReleaseIntegrity(context.pluginId, context.releaseDigest, effectiveAdmission);

    // P1: Secure entrypoint validation
    const resolvedEntrypoint = validateAndResolveEntrypoint(
      context.entrypointPath,
      context.pluginId,
      effectiveAdmission,
    );

    // A malicious plugin may retain JavaScript module state between calls.
    // Untrusted workers must never be shared across publications or actors.
    const processKey = tier2ProcessIsolationKey(context, effectiveTrustTier);
    let active = this.processes.get(processKey);
    if (
      !active ||
      !this.isProcessAlive(active) ||
      active.releaseDigest !== context.releaseDigest ||
      active.entrypointPath !== resolvedEntrypoint ||
      active.trustTier !== effectiveTrustTier
    ) {
      if (active) this.cleanupProcess(processKey, new Error("Process release, entrypoint, or trust policy rotated"));
      active = this.spawnProcess(
        context.pluginId,
        context.releaseDigest,
        resolvedEntrypoint,
        effectiveTrustTier,
        processKey,
      );
    }

    if (active.startupReady) {
      await active.startupReady;
      if (this.processes.get(processKey) !== active || !this.isProcessAlive(active)) {
        throw new Tier2SupervisorError("CGROUP_LAUNCH_BLOCK_FAILED", "Sandbox became unavailable before invocation");
      }
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
        if (active && this.processes.get(processKey) === active) {
          // A timer from a retired invocation must not kill a replacement.
          this.cleanupProcess(processKey, new Tier2SupervisorError("PLUGIN_TIMEOUT", `Operation '${operation}' timed out after ${this.invocationTimeoutMs}ms`));
        }
        reject(new Tier2SupervisorError("PLUGIN_TIMEOUT", `Sandbox invocation timed out after ${this.invocationTimeoutMs}ms`));
      }, this.invocationTimeoutMs);

      active!.pendingRequests.set(requestId, {
        context,
        handlers,
        resolve: (val) => resolve(val as R),
        reject,
        timer,
        capabilityRequestCount: 0,
      });

      this.sendToProcess(active!, envelope, (err) => {
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
    this.cleanupPluginProcesses(pluginId, new Tier2SupervisorError("PLUGIN_TERMINATED", "Plugin worker was terminated"));
  }

  /**
   * Terminate all managed sandbox workers.
   */
  async terminateAll(): Promise<void> {
    for (const key of Array.from(this.processes.keys())) {
      this.cleanupProcess(key, new Tier2SupervisorError("PLUGIN_TERMINATED", "Plugin worker was terminated"));
    }
  }

  async shutdownAll(): Promise<void> {
    await this.terminateAll();
  }
}
