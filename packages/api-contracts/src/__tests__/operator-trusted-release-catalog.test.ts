import { describe, expect, it } from "vitest";
import { OperatorTrustedPluginCatalogResponseSchema } from "../plugins";

const digest = "a".repeat(64);
const entry = {
  id: "hello-public",
  name: "Hello Public",
  version: "1.0.0",
  description: null,
  capabilities: ["extension.routes.public"],
  signatureVerified: true,
  release: {
    releaseId: `hello-public@1.0.0:${digest}`,
    publisher: { id: "reviewed", name: "Reviewed publisher" },
    artifactSha256: digest,
    compatibility: {
      minVibressApiVersion: "1.0.0",
      maxVibressApiVersion: "1.0.0",
      sdkAbiVersion: "1.0.0",
    },
    hasSbom: true,
    hasProvenance: false,
    migrationPlanIds: ["0001_initial"],
  },
};

describe("P0-2 operator trusted release catalog API response", () => {
  it("admits an additive, path-free release summary", () => {
    const payload = { plugins: [entry] };
    expect(OperatorTrustedPluginCatalogResponseSchema.parse(payload)).toEqual(payload);
    expect(OperatorTrustedPluginCatalogResponseSchema.safeParse({
      plugins: [{ ...entry, release: undefined }],
    }).success).toBe(true);
    expect(OperatorTrustedPluginCatalogResponseSchema.safeParse({
      plugins: [{ ...entry, signatureVerified: null, release: undefined }],
    }).success).toBe(true);
  });

  it("rejects operator file paths and unrecognized executable-install fields", () => {
    const unsafe = [
      { ...entry.release, path: "/etc/vibress/operator-private.pem" },
      { ...entry.release, installUrl: "https://malicious.example/install" },
      { ...entry.release, migrationPlanIds: ["../root"] },
      { ...entry.release, artifactSha256: "invalid" },
      { ...entry.release, publisher: { id: "reviewed", name: "X", keyPath: "/keys" } },
    ];
    for (const release of unsafe) {
      expect(OperatorTrustedPluginCatalogResponseSchema.safeParse({
        plugins: [{ ...entry, release }],
      }).success).toBe(false);
    }
  });
});
