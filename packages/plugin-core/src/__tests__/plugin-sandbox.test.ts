import { describe, it, expect } from "vitest";
import {
  validatePluginManifest,
  executeSandboxedPluginCode,
  verifyPluginCapabilityPermission,
  PluginSecurityViolationError,
} from "../index";

describe("Secure Plugin Runtime Sandbox & Isolation Boundary", () => {
  const dummyContext = {
    pluginId: "analytics-tracker",
    manifest: {
      id: "analytics-tracker",
      name: "Analytics Tracker",
      version: "1.0.0",
      capabilities: ["events.read"],
    },
    settings: { trackingId: "UA-12345" },
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  it("validates compliant plugin manifests and rejects invalid IDs and path traversals", () => {
    const valid = validatePluginManifest({
      id: "seo-booster",
      name: "SEO Booster",
      version: "2.1.0",
      capabilities: ["posts.read"],
    });
    expect(valid.id).toBe("seo-booster");

    // Path traversal attempt in ID
    expect(() =>
      validatePluginManifest({
        id: "../../../etc/passwd",
        name: "Malicious Plugin",
        version: "1.0.0",
      }),
    ).toThrow(/Plugin ID must be lowercase alphanumeric/);
  });

  it("prohibits sandboxed code from accessing Node.js process, filesystem, or require", () => {
    const maliciousCode = `
      (() => {
        if (typeof process !== 'undefined') throw new Error('process exposed!');
        if (typeof require !== 'undefined') throw new Error('require exposed!');
        return 'isolation_passed';
      })()
    `;

    const result = executeSandboxedPluginCode<string>(maliciousCode, dummyContext);
    expect(result).toBe("isolation_passed");
  });

  it("terminates infinite loops or runaway execution within strict timeout limit", () => {
    const runawayCode = `
      while (true) {
        // infinite loop
      }
    `;

    expect(() =>
      executeSandboxedPluginCode(runawayCode, dummyContext, { timeoutMs: 50 }),
    ).toThrow();
  });

  it("enforces capability declarations and denies undeclared capabilities", () => {
    expect(() =>
      verifyPluginCapabilityPermission(dummyContext.manifest, "events.read"),
    ).not.toThrow();

    expect(() =>
      verifyPluginCapabilityPermission(dummyContext.manifest, "database.write"),
    ).toThrow(PluginSecurityViolationError);
  });

  it("allows safe functional calculations and pure operations", () => {
    const transformCode = `
      (() => {
        const id = context.settings.trackingId;
        return { formatted: id.toUpperCase(), len: id.length };
      })()
    `;

    const result = executeSandboxedPluginCode<{ formatted: string; len: number }>(
      transformCode,
      dummyContext,
    );

    expect(result.formatted).toBe("UA-12345");
    expect(result.len).toBe(8);
  });

  it("executes hooks safely across the decoupled ExtensionHost boundary", async () => {
    const { ExtensionHost } = await import("../extension-host");
    const host = new ExtensionHost(dummyContext.manifest);

    const hookResult = await host.executeHook<{ executed: boolean; hook: string }>(
      "onEvent",
      { event: "post.published" },
      dummyContext,
    );

    expect(hookResult.executed).toBe(true);
    expect(hookResult.hook).toBe("onEvent");
  });
});

