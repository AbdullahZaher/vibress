// @vitest-environment node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  UnsupportedTopologyError,
  assertSupportedTopology,
} from "../../apps/platform-reference/src/topology";

function capture(action: () => void): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("F-012 deployment topology gate", () => {
  it("defaults to the supported single-installation posture", () => {
    expect(assertSupportedTopology({})).toBe("single-installation");
    expect(
      assertSupportedTopology({ PLATFORM_TOPOLOGY: " SINGLE-INSTALLATION " }),
    ).toBe("single-installation");
  });

  it("rejects shared and multi-tenant topologies", () => {
    for (const topology of ["shared", "multi-tenant", "public-hosting"]) {
      const error = capture(() =>
        assertSupportedTopology({ PLATFORM_TOPOLOGY: topology }),
      );
      expect(error).toBeInstanceOf(UnsupportedTopologyError);
      expect((error as UnsupportedTopologyError).code).toBe(
        "unsupported_topology",
      );
      expect((error as Error).message).toContain("F-012");
      expect((error as Error).message).toContain(topology);
    }
  });

  it("rejects external tenant onboarding even in the supported topology", () => {
    for (const value of ["1", "true", "YES"]) {
      const error = capture(() =>
        assertSupportedTopology({ PLATFORM_EXTERNAL_TENANT_ONBOARDING: value }),
      );
      expect(error).toBeInstanceOf(UnsupportedTopologyError);
      expect((error as Error).message).toContain("F-012");
    }
    expect(
      assertSupportedTopology({ PLATFORM_EXTERNAL_TENANT_ONBOARDING: "0" }),
    ).toBe("single-installation");
  });

  it("does not mutate the environment it inspects", () => {
    const env = { PLATFORM_TOPOLOGY: "single-installation" };
    assertSupportedTopology(env);
    expect(env).toEqual({ PLATFORM_TOPOLOGY: "single-installation" });
  });

  it("stops the serving process before it reads any database URL", async () => {
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const env = { ...process.env, PLATFORM_TOPOLOGY: "multi-tenant" };
    delete env.DATABASE_URL;
    delete env.PLATFORM_RUNTIME_DATABASE_URL;
    delete env.PLATFORM_MEMBERSHIP_READER_DATABASE_URL;
    delete env.PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL;

    const failure = (await promisify(execFile)(
      tsx,
      ["apps/platform-reference/src/main.ts"],
      { env },
    ).catch((error: { code?: number; stderr?: string }) => error)) as {
      code?: number;
      stderr?: string;
    };

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("UnsupportedTopologyError");
    expect(failure.stderr).toContain("F-012");
    expect(failure.stderr).not.toContain("PLATFORM_RUNTIME_DATABASE_URL is required");
  });
});
