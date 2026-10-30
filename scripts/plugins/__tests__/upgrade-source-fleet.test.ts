import { describe, expect, it } from "vitest";
import { assessUpgradeSourceFleet } from "../upgrade-source-fleet";
import type { PluginReplicaReceipt } from "../replica-receipt-consistency";

const H = (c: string) => c.repeat(64);
const snapshot = {
  planId: "37ba6c15-1a45-4753-b402-cfc0e66b84d8",
  pluginId: "fd730ff6-b705-4d76-9d60-050fc3ec644d",
  manifestId: "signed-lms",
  status: "approved", revision: 3, planSha256: H("a"),
  fromVersion: "1.0.0", fromArtifactSha256: H("b"),
  fromLockfileSha256: H("c"), fromSignerSha256: H("d"),
  installedVersion: "1.0.0", installedManifestId: "signed-lms",
  installedStatus: "inactive",
  hasEnabledPublications: false, hasUnsettledReceipts: false,
  hasActiveRedisJobs: false,
};
const receipt = {
  schemaVersion: 1, signatureVerified: true,
  lockfileSha256: H("c"), publicKeySha256: H("d"),
  releases: [{ pluginId: "signed-lms", version: "1.0.0",
    sha256: H("b"), adminViewCount: 0 }],
};
function four(): PluginReplicaReceipt[] {
  return [
    { role: "api", replica: "api-a", receipt },
    { role: "api", replica: "api-b", receipt: { ...receipt } },
    { role: "worker", replica: "worker-a", receipt: { ...receipt } },
    { role: "worker", replica: "worker-b", receipt: { ...receipt } },
  ];
}

describe("PLUG-UPD-03 source-fleet snapshot (not quiesce authority)", () => {
  it("correlates exact source artifact, signer, lockfile and 2+2 replicas", () => {
    expect(assessUpgradeSourceFleet(snapshot, four())).toEqual({
      apiReplicas: 2, workerReplicas: 2, approvedSource: true,
      idleSnapshot: true,
    });
  });
  it("rejects any unsafe database or Redis snapshot", () => {
    for (const delta of [
      { status: "preflighted" }, { installedStatus: "active" },
      { hasEnabledPublications: true }, { hasUnsettledReceipts: true },
      { hasActiveRedisJobs: true },
      { installedVersion: "0.9.0" }, { installedManifestId: "other" },
      { revision: 0 }, { fromArtifactSha256: "bad" },
    ]) {
      expect(() => assessUpgradeSourceFleet({ ...snapshot, ...delta }, four()))
        .toThrow();
    }
  });
  it("rejects stale or mixed source replicas and mismatched artifact bytes", () => {
    const wrongVersion = four();
    wrongVersion[3] = { ...wrongVersion[3]!, receipt: {
      ...receipt, releases: [{ ...receipt.releases[0], version: "1.0.1" }],
    } };
    expect(() => assessUpgradeSourceFleet(snapshot, wrongVersion)).toThrow();
    const wrongDigest = four().map((r) => ({
      ...r, receipt: { ...receipt, releases: [
        { ...receipt.releases[0], sha256: H("e") },
      ] },
    }));
    expect(() => assessUpgradeSourceFleet(snapshot, wrongDigest))
      .toThrow("PLUGIN_UPGRADE_FLEET_RELEASE_MISMATCH");
    const unsigned = four();
    unsigned[0] = { ...unsigned[0]!, receipt: { ...receipt, signatureVerified: false } };
    expect(() => assessUpgradeSourceFleet(snapshot, unsigned)).toThrow();
  });
  it("rejects synthetic redundancy and unpinned foreign release", () => {
    expect(() => assessUpgradeSourceFleet(snapshot, four().slice(1))).toThrow();
    const wrong = four();
    wrong[1] = { ...wrong[1]!, replica: "api-a" };
    expect(() => assessUpgradeSourceFleet(snapshot, wrong)).toThrow();
    const foreign = four().map((r) => ({ ...r, receipt: {
      ...receipt, releases: [{ ...receipt.releases[0], pluginId: "another" }],
    } }));
    expect(() => assessUpgradeSourceFleet(snapshot, foreign))
      .toThrow("PLUGIN_UPGRADE_FLEET_RELEASE_MISMATCH");
  });
});
