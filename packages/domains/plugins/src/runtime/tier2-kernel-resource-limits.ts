import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";

/**
 * M8.7: kernel-enforced ceilings for ONE untrusted Bubblewrap process tree.
 *
 * The caller MUST block Bubblewrap with --block-fd before attaching its PID.
 * Do not use this module with a child which has already executed plugin code.
 * No environment variable or caller-supplied cgroup path authorizes execution.
 */
export const TIER2_KERNEL_RESOURCE_LIMITS = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  maxTasks: 24,
});

const CGROUP2_SUPER_MAGIC = 0x63677270;
const CGROUP_MOUNT = "/sys/fs/cgroup";
const CONTROLLERS = ["cpu", "memory", "pids"] as const;

export class Tier2KernelResourceError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "Tier2KernelResourceError";
  }
}

export function parseUnifiedCgroupPath(contents: string): string {
  const paths = contents.split("\n").filter((line) => line.startsWith("0::"));
  if (paths.length !== 1) {
    throw new Tier2KernelResourceError("CGROUP_V2_UNAVAILABLE", "No unique unified cgroup v2 membership");
  }
  const memberPath = paths[0]!.slice(3);
  if (!memberPath.startsWith("/") || memberPath.includes("\0") ||
      memberPath.split("/").some((part) => part === "." || part === "..")) {
    throw new Tier2KernelResourceError("INVALID_CGROUP_MEMBERSHIP", "Invalid unified cgroup membership");
  }
  return memberPath;
}

function readTokens(file: string): Set<string> {
  return new Set(readFileSync(file, "utf8").trim().split(/\s+/).filter(Boolean));
}

/**
 * The current systemd / container supervisor must delegate all three
 * controllers to the service's existing cgroup. Never enable controllers
 * on the Host's ancestor cgroup or request privileged Docker access.
 */
export function resolveDelegatedTier2CgroupParent(): string {
  if (process.platform !== "linux" || !existsSync(path.join(CGROUP_MOUNT, "cgroup.controllers"))) {
    throw new Tier2KernelResourceError("CGROUP_V2_UNAVAILABLE", "Unified Linux cgroup v2 is required");
  }
  if (statfsSync(CGROUP_MOUNT).type !== CGROUP2_SUPER_MAGIC) {
    throw new Tier2KernelResourceError("CGROUP_V2_UNAVAILABLE", "The cgroup mount is not a genuine cgroup v2 filesystem");
  }
  const memberPath = parseUnifiedCgroupPath(readFileSync("/proc/self/cgroup", "utf8"));
  const mountRoot = realpathSync(CGROUP_MOUNT);
  const parent = realpathSync(path.join(mountRoot, memberPath.replace(/^\/+/, "")));
  if (parent !== mountRoot && !parent.startsWith(mountRoot + path.sep)) {
    throw new Tier2KernelResourceError("INVALID_CGROUP_MEMBERSHIP", "Cgroup membership escapes the mounted hierarchy");
  }
  const enabled = readTokens(path.join(parent, "cgroup.subtree_control"));
  for (const controller of CONTROLLERS) {
    if (!enabled.has(controller)) {
      throw new Tier2KernelResourceError(
        "CGROUP_CONTROLLER_NOT_DELEGATED",
        `Required cgroup v2 controller '${controller}' is not delegated to this service`,
      );
    }
  }
  return parent;
}

function readLimit(file: string): string {
  return readFileSync(file, "utf8").trim().replace(/\s+/g, " ");
}

/** A lease's cgroup contains bwrap and all descendants. */
export class Tier2KernelCgroupLease {
  private closed = false;
  private readonly group: string;

  private constructor(group: string) {
    this.group = group;
  }

  static create(): Tier2KernelCgroupLease {
    const parent = resolveDelegatedTier2CgroupParent();
    const group = path.join(parent, `vibress-tier2-${randomUUID()}`);
    try {
      // mkdir without recursive prevents accidental traversal into an operator
      // supplied or compromised directory.
      mkdirSync(group, { mode: 0o700 });
      const limits = TIER2_KERNEL_RESOURCE_LIMITS;
      const expected = new Map<string, string>([
        ["memory.max", String(limits.memoryBytes)],
        ["cpu.max", `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}`],
        ["pids.max", String(limits.maxTasks)],
        ["memory.oom.group", "1"],
      ]);
      if (!existsSync(path.join(group, "cgroup.kill"))) {
        throw new Tier2KernelResourceError("CGROUP_KILL_UNAVAILABLE", "Atomic process-tree kill requires cgroup.kill");
      }
      for (const [file, value] of expected) {
        writeFileSync(path.join(group, file), value);
        if (readLimit(path.join(group, file)) !== value) {
          throw new Tier2KernelResourceError("CGROUP_LIMIT_NOT_ENFORCED", `Kernel refused to enforce ${file}`);
        }
      }
      return new Tier2KernelCgroupLease(group);
    } catch (error: unknown) {
      try { rmdirSync(group); } catch { /* cgroup may not exist or be removable */ }
      if (error instanceof Tier2KernelResourceError) throw error;
      throw new Tier2KernelResourceError(
        "CGROUP_SETUP_FAILED",
        `Cannot create a delegated resource-limited cgroup: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /**
   * Attach the trusted bwrap launcher while --block-fd prevents execution of
   * the untrusted child. The parent releases the pipe ONLY after this returns.
   */
  attachBlockedLauncher(pid: number): void {
    if (this.closed || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Tier2KernelResourceError("CGROUP_INVALID_PID", "Invalid blocked sandbox launcher PID");
    }
    try {
      writeFileSync(path.join(this.group, "cgroup.procs"), String(pid));
      if (!readTokens(path.join(this.group, "cgroup.procs")).has(String(pid))) {
        throw new Tier2KernelResourceError("CGROUP_ATTACH_UNVERIFIED", "Blocked sandbox launcher did not join its cgroup");
      }
    } catch (error: unknown) {
      if (error instanceof Tier2KernelResourceError) throw error;
      throw new Tier2KernelResourceError(
        "CGROUP_ATTACH_FAILED",
        `Failed to attach blocked sandbox launcher: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /** Kernel kills bwrap and all inherited descendants, including fork bombs. */
  killTree(): void {
    if (this.closed) return;
    try {
      writeFileSync(path.join(this.group, "cgroup.kill"), "1");
    } catch {
      // If already empty, cgroup.kill may reject; a pending child exit still
      // triggers cleanup, but no untrusted process may be released on failure.
    }
  }

  /** Never silently remove a populated group; retry after kernel reaping. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.killTreeAfterClose();
    this.retryRemoval(0);
  }

  private killTreeAfterClose(): void {
    try { writeFileSync(path.join(this.group, "cgroup.kill"), "1"); } catch { /* already empty */ }
  }

  private retryRemoval(attempt: number): void {
    try {
      rmdirSync(this.group);
      return;
    } catch {
      if (attempt >= 10) return;
      const retry = setTimeout(() => this.retryRemoval(attempt + 1), 100);
      retry.unref();
    }
  }
}
