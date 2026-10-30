import { describe, expect, it } from "vitest";
import {
  parseUnifiedCgroupPath,
  parseBubblewrapChildPid,
  resolveDelegatedTier2CgroupParent,
  TIER2_KERNEL_RESOURCE_LIMITS,
  Tier2KernelResourceError,
} from "../src/runtime/tier2-kernel-resource-limits.js";
import { buildBubblewrapArgs } from "../src/runtime/tier2-process-supervisor.js";

describe("M8.7 cgroup v2 mandatory kernel ceilings", () => {
  it("parses only the unified cgroup v2 process membership", () => {
    expect(parseUnifiedCgroupPath("0::/user.slice/session.scope\n"))
      .toBe("/user.slice/session.scope");
    expect(parseUnifiedCgroupPath("0::/\n")).toBe("/");
  });

  it("rejects legacy, missing, multiple and malicious process memberships", () => {
    for (const invalid of [
      "",
      "2:cpu:/system.slice\n",
      "0::/valid\n0::/other\n",
      "0::/safe/../unsafe\n",
      "0::relative\n",
    ]) {
      expect(() => parseUnifiedCgroupPath(invalid)).toThrow(Tier2KernelResourceError);
    }
  });

  it("binds the real Bubblewrap child PID, not just its launcher", () => {
    expect(parseBubblewrapChildPid('{"child-pid":12345,"namespace-ids":{}}')).toBe(12345);
    for (const malformed of [
      "", "[]", "{}", '{"child-pid":0}', '{"child-pid":"123"}',
      '{"child-pid":-4}', '{"child-pid":1.25}',
    ]) {
      expect(() => parseBubblewrapChildPid(malformed)).toThrow(Tier2KernelResourceError);
    }
  });

  it("configures finite CPU, resident memory, and process limits", () => {
    expect(TIER2_KERNEL_RESOURCE_LIMITS.memoryBytes).toBeGreaterThan(64 * 1024 * 1024);
    expect(TIER2_KERNEL_RESOURCE_LIMITS.cpuQuotaMicros).toBeGreaterThan(0);
    expect(TIER2_KERNEL_RESOURCE_LIMITS.cpuQuotaMicros)
      .toBeLessThan(TIER2_KERNEL_RESOURCE_LIMITS.cpuPeriodMicros);
    expect(TIER2_KERNEL_RESOURCE_LIMITS.maxTasks).toBeGreaterThan(1);
    expect(TIER2_KERNEL_RESOURCE_LIMITS.maxTasks).toBeLessThan(100);
  });

  it("adds a trusted blocked-launcher pipe for cgroup attachment before execution", () => {
    const args = buildBubblewrapArgs({
      scriptPath: process.execPath,
      nodeArgs: ["--version"],
      sanitizedEnv: { NODE_ENV: "production" },
      blockFd: 3,
      infoFd: 4,
    });
    const i = args.indexOf("--block-fd");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("3");
    expect(args[args.indexOf("--info-fd") + 1]).toBe("4");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--clearenv");
    expect(args.indexOf("--block-fd")).toBeLessThan(args.indexOf("--ro-bind"));
  });

  it("does not advertise cgroup support merely because the OS is Linux", () => {
    // Detection is non-mutating. Lack of delegated controllers is an explicit
    // rejection rather than a fallback to a V8 heap-only sandbox.
    try {
      const parent = resolveDelegatedTier2CgroupParent();
      expect(parent.startsWith("/sys/fs/cgroup")).toBe(true);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Tier2KernelResourceError);
    }
  });
});
