// @vitest-environment node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  UnsupportedAuthenticationModeError,
  UnsupportedTopologyError,
  assertReferenceAuthenticationMode,
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

  it("refuses reference bearer tokens in a production-shaped process", () => {
    for (const env of [
      { NODE_ENV: "production" },
      { PLATFORM_ENVIRONMENT: "production" },
      { PLATFORM_ENVIRONMENT: " PROD " },
      { NODE_ENV: "test", PLATFORM_ENVIRONMENT: "production" },
    ]) {
      const error = capture(() => assertReferenceAuthenticationMode(env));
      expect(error).toBeInstanceOf(UnsupportedAuthenticationModeError);
      expect((error as UnsupportedAuthenticationModeError).code).toBe(
        "unsupported_authentication_mode",
      );
      expect((error as Error).message).toContain("W1-T07");
    }
  });

  it("accepts only reference authentication outside production", () => {
    expect(assertReferenceAuthenticationMode({})).toBe("reference");
    expect(
      assertReferenceAuthenticationMode({
        NODE_ENV: "development",
        PLATFORM_ENVIRONMENT: "staging",
      }),
    ).toBe("reference");
    expect(
      assertReferenceAuthenticationMode({ PLATFORM_AUTH_MODE: "REFERENCE" }),
    ).toBe("reference");
    for (const mode of ["oidc", "jwt", "none"]) {
      const error = capture(() =>
        assertReferenceAuthenticationMode({
          NODE_ENV: "development",
          PLATFORM_AUTH_MODE: mode,
        }),
      );
      expect(error).toBeInstanceOf(UnsupportedAuthenticationModeError);
      expect((error as Error).message).toContain(mode);
    }
  });

  it("stops a production-shaped serving process before it reads any database URL", async () => {
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const env = {
      ...process.env,
      NODE_ENV: "production",
      PLATFORM_ENVIRONMENT: "production",
      PLATFORM_AUTH_MODE: "reference",
    };
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
    expect(failure.stderr).toContain("UnsupportedAuthenticationModeError");
    expect(failure.stderr).toContain("W1-T07");
    expect(failure.stderr).not.toContain("PLATFORM_RUNTIME_DATABASE_URL is required");
  });
});
