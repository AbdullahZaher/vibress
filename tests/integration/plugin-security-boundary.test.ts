import { describe, it, expect } from "vitest";
import {
  BundledPluginRegistry,
  defaultBundledPluginRegistry,
  executeSandboxedPluginCode,
  PluginSecurityViolationError,
  verifyPluginCapabilityPermission,
  validatePluginManifest,
  PluginContext,
} from "@vibress/plugin-core";

describe("SEC-01: Plugin Security Boundary & Safe Execution Verification", () => {
  const dummyContext: PluginContext = {
    pluginId: "vibress-content-metrics",
    manifest: {
      id: "vibress-content-metrics",
      name: "Vibress Content Metrics",
      version: "1.0.0",
      capabilities: ["posts.read"],
    },
    settings: {},
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  it("fails closed when untrusted/unregistered plugin execution is attempted", async () => {
    const registry = new BundledPluginRegistry();

    await expect(
      registry.executeHook(
        "untrusted-third-party-plugin",
        "onEvent",
        { data: "payload" },
        dummyContext,
      ),
    ).rejects.toThrow(PluginSecurityViolationError);

    await expect(
      registry.executeHook(
        "untrusted-third-party-plugin",
        "onEvent",
        { data: "payload" },
        dummyContext,
      ),
    ).rejects.toThrow(/Dynamic arbitrary plugin execution is disabled for security/);
  });

  it("executes official bundled plugins safely within capability boundaries", async () => {
    const result = await defaultBundledPluginRegistry.executeHook<{
      wordCount: number;
      readingTimeMinutes: number;
      characterCount: number;
    }>(
      "vibress-content-metrics",
      "calculateMetrics",
      { text: "This is a production article intended to verify reading time and metrics calculation." },
      dummyContext,
    );

    expect(result).toBeDefined();
    expect(result.wordCount).toBe(13);
    expect(result.readingTimeMinutes).toBe(1);
    expect(result.characterCount).toBe(85);
  });

  it("enforces strict capability checks for bundled plugins", async () => {
    const registry = new BundledPluginRegistry();

    // Register a plugin that lacks 'posts.read' capability
    registry.register({
      id: "unauthorized-plugin",
      manifest: {
        id: "unauthorized-plugin",
        name: "Unauthorized Plugin",
        version: "1.0.0",
        capabilities: ["media.read"], // lacks posts.read
      },
      executeHook: () => ({ success: true }),
    });

    await expect(
      registry.executeHook(
        "unauthorized-plugin",
        "calculateMetrics",
        { text: "test" },
        dummyContext,
      ),
    ).rejects.toThrow(PluginSecurityViolationError);
  });

  it("detects and blocks prototype escape attempts in deprecated dynamic sandbox", () => {
    const prototypeEscapeCode = `
      (() => {
        const foreign = this.constructor.constructor('return process')();
        return foreign;
      })()
    `;

    expect(() =>
      executeSandboxedPluginCode(prototypeEscapeCode, dummyContext),
    ).toThrow(PluginSecurityViolationError);
    expect(() =>
      executeSandboxedPluginCode(prototypeEscapeCode, dummyContext),
    ).toThrow(/Security violation/);
  });

  it("detects and blocks __proto__ prototype pollution attempts in dynamic sandbox", () => {
    const protoPollutionCode = `
      (() => {
        const payload = JSON.parse('{"__proto__": {"polluted": true}}');
        return payload;
      })()
    `;

    expect(() =>
      executeSandboxedPluginCode(protoPollutionCode, dummyContext),
    ).toThrow(PluginSecurityViolationError);
  });

  it("detects and blocks eval/Function dynamic evaluation in sandbox", () => {
    const evalCode = `
      (() => {
        return eval('1 + 1');
      })()
    `;

    expect(() =>
      executeSandboxedPluginCode(evalCode, dummyContext),
    ).toThrow(PluginSecurityViolationError);

    const functionCode = `
      (() => {
        const fn = new Function('return 42');
        return fn();
      })()
    `;

    expect(() =>
      executeSandboxedPluginCode(functionCode, dummyContext),
    ).toThrow(PluginSecurityViolationError);
  });

  it("validates plugin manifests and rejects directory traversal or illegal characters", () => {
    expect(() =>
      validatePluginManifest({
        id: "../bad/path",
        name: "Bad Path",
        version: "1.0.0",
      }),
    ).toThrow(/Plugin ID must be lowercase alphanumeric/);

    expect(() =>
      validatePluginManifest({
        id: "UPPERCASE_ID",
        name: "Uppercase ID",
        version: "1.0.0",
      }),
    ).toThrow(/Plugin ID must be lowercase alphanumeric/);
  });
});
