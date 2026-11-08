import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const { configOverrides } = vi.hoisted(() => ({
  configOverrides: {
    isProduction: false,
    secrets: {
      encryptionKey: "",
    },
  },
}));

vi.mock("@vibress/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibress/config")>();
  return {
    ...actual,
    getConfig: () => {
      const base = actual.loadConfig(process.env);
      return {
        ...base,
        isProduction: configOverrides.isProduction,
        secrets: {
          ...base.secrets,
          encryptionKey: configOverrides.secrets.encryptionKey,
        },
      };
    },
  };
});

import { getSitePrivacySecret } from "../media-stream";

describe("getSitePrivacySecret defense-in-depth hardening", () => {
  const originalEnvKey = process.env.VIBRESS_ENCRYPTION_KEY;

  beforeEach(() => {
    delete process.env.VIBRESS_ENCRYPTION_KEY;
    configOverrides.isProduction = false;
    configOverrides.secrets.encryptionKey = "";
  });

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env.VIBRESS_ENCRYPTION_KEY = originalEnvKey;
    } else {
      delete process.env.VIBRESS_ENCRYPTION_KEY;
    }
  });

  it("returns configured encryption key in development", () => {
    configOverrides.isProduction = false;
    configOverrides.secrets.encryptionKey = "custom-dev-encryption-key-for-testing";

    expect(getSitePrivacySecret()).toBe("custom-dev-encryption-key-for-testing");
  });

  it("returns fallback secret in development when key is missing", () => {
    configOverrides.isProduction = false;
    configOverrides.secrets.encryptionKey = "";

    expect(getSitePrivacySecret()).toBe("vibress-site-privacy-secret");
  });

  it("returns valid production key when properly configured", () => {
    configOverrides.isProduction = true;
    const secureKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    configOverrides.secrets.encryptionKey = secureKey;

    expect(getSitePrivacySecret()).toBe(secureKey);
  });

  it("fails closed in production if encryption key is missing or empty", () => {
    configOverrides.isProduction = true;
    configOverrides.secrets.encryptionKey = "";

    expect(() => getSitePrivacySecret()).toThrow(
      "VIBRESS_ENCRYPTION_KEY must be configured in production",
    );
  });

  it("fails closed in production if encryption key contains placeholder 'change-me'", () => {
    configOverrides.isProduction = true;
    configOverrides.secrets.encryptionKey = "production-change-me-placeholder-key";

    expect(() => getSitePrivacySecret()).toThrow(
      "VIBRESS_ENCRYPTION_KEY must be configured in production",
    );
  });
});
