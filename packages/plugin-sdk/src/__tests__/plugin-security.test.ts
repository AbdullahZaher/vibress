import { describe, it, expect } from "vitest";
import {
  validateManifest,
  verifyPluginChecksum,
  executeWithTimeout,
} from "../index";
import crypto from "crypto";

describe("Plugin Security & Packaging Guards", () => {
  it("validates valid plugin manifest and enforces capability declaration", () => {
    const manifest = validateManifest({
      id: "seo-enhancer",
      name: "SEO Enhancer",
      version: "1.0.0",
      vibressApiVersion: "1.0.0",
      entrypoint: "dist/index.js",
      capabilities: ["events.subscribe", "content.read"],
    });

    expect(manifest.id).toBe("seo-enhancer");
    expect(manifest.capabilities).toContain("events.subscribe");
  });

  it("rejects manifest with unsupported capability", () => {
    expect(() =>
      validateManifest({
        id: "bad-plugin",
        name: "Bad Plugin",
        version: "1.0.0",
        vibressApiVersion: "1.0.0",
        entrypoint: "dist/index.js",
        capabilities: ["system.rootAccess"],
      }),
    ).toThrow(/Unsupported capability/);
  });

  it("verifies cryptographic SHA-256 checksum match and rejects mismatch", () => {
    const code = "console.log('Secure plugin code');";
    const expectedHash = crypto
      .createHash("sha256")
      .update(code)
      .digest("hex");

    expect(verifyPluginChecksum(code, expectedHash)).toBe(true);
    expect(verifyPluginChecksum(code, "invalid-hash-12345")).toBe(false);
  });

  it("enforces timeout guard when plugin operation hangs", async () => {
    const hangingFn = () =>
      new Promise((resolve) => setTimeout(resolve, 500));

    await expect(executeWithTimeout(hangingFn, 50)).rejects.toThrow(
      /Plugin execution exceeded timeout of 50ms/,
    );
  });
});
