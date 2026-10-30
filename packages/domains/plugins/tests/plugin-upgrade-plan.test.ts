import { describe, expect, it } from "vitest";
import {
  preparePluginUpgradeStage, PluginUpgradePlanError,
} from "../src/application/plugin-upgrade-plan";

const a = "a".repeat(64), b = "b".repeat(64);
const c = "c".repeat(64), d = "d".repeat(64);
const id = "2fcafc77-3168-4737-a80b-d0957991dccb";
const installed = {
  id, manifestId: "trusted-extension", version: "1.0.0",
  capabilities: ["events.subscribe", "storage.read"],
};
const receipt = (version: string, digest: string, lockfile: string) => ({
  schemaVersion: 1, signatureVerified: true, lockfileSha256: lockfile,
  publicKeySha256: d, releases: [{
    pluginId: installed.manifestId, version, sha256: digest, adminViewCount: 0,
  }],
});
const input = {
  pluginId: id, sourceAdmission: receipt("1.0.0", a, a),
  targetAdmission: receipt("1.1.0", b, b),
  targetManifest: {
    id: installed.manifestId, version: "1.1.0",
    capabilities: ["storage.read", "members.read"],
  },
};
const plan = (candidate: unknown = input, current: unknown = installed) =>
  preparePluginUpgradeStage(candidate as typeof input, current);
const invalid = (candidate: typeof input, code: string) => {
  expect(() => plan(candidate)).toThrowError(PluginUpgradePlanError);
  try { plan(candidate); throw new Error("unexpected approval"); }
  catch (error) { expect(error).toMatchObject({ code }); }
};
describe("PLUG-UPD-01 offline signed upgrade staging", () => {
  it("pins both admitted releases and computes deterministic capability diff", () => {
    const stage = plan();
    expect(stage).toMatchObject({
      pluginId: id, fromVersion: "1.0.0", toVersion: "1.1.0",
      fromArtifactSha256: a, toArtifactSha256: b,
      capabilitiesAdded: ["members.read"], capabilitiesRemoved: ["events.subscribe"],
    });
    expect(stage.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan().planSha256).toBe(stage.planSha256);
    expect(plan({ ...input, targetManifest: {
      ...input.targetManifest, capabilities: ["members.read", "storage.read"],
    } }).planSha256).toBe(stage.planSha256);
  });
  it("rejects unsigned, unpinned and mismatched releases", () => {
    invalid({ ...input, targetAdmission: {
      ...input.targetAdmission, signatureVerified: false,
    } }, "PLUGIN_UPGRADE_INVALID_INPUT");
    invalid({ ...input, sourceAdmission: receipt("1.0.1", a, a) }, "PLUGIN_UPGRADE_STALE_RELEASE");
    invalid({ ...input, targetAdmission: receipt("1.1.1", b, b) }, "PLUGIN_UPGRADE_STALE_RELEASE");
    invalid({ ...input, targetAdmission: receipt("1.0.0", b, b),
      targetManifest: { ...input.targetManifest, version: "1.0.0" },
    }, "PLUGIN_UPGRADE_STALE_RELEASE");
    invalid({ ...input, targetAdmission: receipt("1.1.0", a, b) }, "PLUGIN_UPGRADE_STALE_RELEASE");
    invalid({ ...input, targetAdmission: receipt("1.1.0", b, a) }, "PLUGIN_UPGRADE_STALE_RELEASE");
  });
  it("refuses cross-plugin, forged or duplicate release identities", () => {
    invalid({ ...input, pluginId: "foreign" }, "PLUGIN_UPGRADE_WRONG_PLUGIN");
    invalid({ ...input, targetManifest: { ...input.targetManifest, id: "foreign" } },
      "PLUGIN_UPGRADE_WRONG_PLUGIN");
    invalid({ ...input, targetAdmission: {
      ...input.targetAdmission, releases: [
        ...input.targetAdmission.releases, ...input.targetAdmission.releases,
      ],
    } }, "PLUGIN_UPGRADE_RELEASE_IDENTITY_INVALID");
    invalid({ ...input, targetManifest: { ...input.targetManifest,
      capabilities: ["storage.read", "storage.read"],
    } }, "PLUGIN_UPGRADE_CAPABILITIES_INVALID");
  });
  it("fails closed on malformed signed-receipt shapes and installed state", () => {
    invalid({ ...input, targetAdmission: { ...input.targetAdmission,
      secret: "rogue",
    } }, "PLUGIN_UPGRADE_INVALID_INPUT");
    expect(() => plan(input, { ...installed, capabilities: ["../unsafe"] }))
      .toThrowError(PluginUpgradePlanError);
    expect(() => plan(input, null)).toThrowError(PluginUpgradePlanError);
  });
});
