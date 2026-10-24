import { describe, expect, it } from "vitest";
import {
  assertPluginReplicaConsensus, type PluginReplicaReceipt,
} from "../replica-receipt-consistency";

const fingerprint = "a".repeat(64);
const key = "b".repeat(64);
const receipt = {
  schemaVersion: 1,
  signatureVerified: true,
  lockfileSha256: fingerprint,
  publicKeySha256: key,
  releases: [{ pluginId: "hello-public", version: "1.0.0",
    sha256: "c".repeat(64), adminViewCount: 0 }],
};
const expected = { lockfileSha256: fingerprint, publicKeySha256: key };

function replicas(): PluginReplicaReceipt[] {
  return [
    { role: "api", replica: "api-a", receipt },
    { role: "api", replica: "api-b", receipt: { ...receipt } },
    { role: "worker", replica: "worker-a", receipt: { ...receipt } },
    { role: "worker", replica: "worker-b", receipt: { ...receipt } },
  ];
}
describe("PLUG-OPS-01 offline fleet receipt comparison", () => {
  it("accepts two signed API and Worker replica receipts tied to external pins", () => {
    expect(assertPluginReplicaConsensus(replicas(), expected)).toEqual({
      schemaVersion: 1, apiReplicas: 2, workerReplicas: 2,
      approvedReleases: 1, ...expected,
    });
  });

  it("denies a stale Worker identity and a mismatched operator trust root", () => {
    const stale = replicas();
    stale[3] = { ...stale[3]!, receipt: { ...receipt,
      lockfileSha256: "d".repeat(64) } };
    expect(() => assertPluginReplicaConsensus(stale, expected))
      .toThrow("PLUGIN_REPLICA_IDENTITY_MISMATCH");
    expect(() => assertPluginReplicaConsensus(replicas(), {
      ...expected, publicKeySha256: "e".repeat(64),
    })).toThrow("PLUGIN_REPLICA_IDENTITY_MISMATCH");
  });

  it("denies tampered release metadata and unsigned / malformed receipts", () => {
    const altered = replicas();
    altered[1] = { ...altered[1]!, receipt: { ...receipt,
      releases: [{ ...receipt.releases[0], sha256: "d".repeat(64) }] } };
    expect(() => assertPluginReplicaConsensus(altered, expected))
      .toThrow("PLUGIN_REPLICA_IDENTITY_MISMATCH");
    const unsigned = replicas();
    unsigned[0] = { ...unsigned[0]!, receipt: { ...receipt, signatureVerified: false } };
    expect(() => assertPluginReplicaConsensus(unsigned, expected))
      .toThrow("PLUGIN_REPLICA_RECEIPT_INVALID");
    const duplicate = replicas();
    duplicate[0] = { ...duplicate[0]!, receipt: { ...receipt,
      releases: [receipt.releases[0], receipt.releases[0]] } };
    expect(() => assertPluginReplicaConsensus(duplicate, expected))
      .toThrow("PLUGIN_REPLICA_RECEIPT_INVALID");
  });

  it("does not accept fake redundancy, one-sided fleets or missing pins", () => {
    const repeated = replicas();
    repeated[1] = { ...repeated[1]!, replica: "api-a" };
    expect(() => assertPluginReplicaConsensus(repeated, expected))
      .toThrow("PLUGIN_REPLICA_RECEIPTS_INCOMPLETE");
    expect(() => assertPluginReplicaConsensus(replicas().slice(0, 3), expected))
      .toThrow("PLUGIN_REPLICA_RECEIPTS_INCOMPLETE");
    expect(() => assertPluginReplicaConsensus(replicas(), {
      ...expected, lockfileSha256: "",
    })).toThrow("PLUGIN_REPLICA_RECEIPTS_INCOMPLETE");
  });

  it("does not depend on reported ordering of independently reviewed releases", () => {
    const item = { pluginId: "another-plugin", version: "2.0.0",
      sha256: "d".repeat(64), adminViewCount: 1 };
    const rs = replicas();
    rs[0] = { ...rs[0]!, receipt: { ...receipt, releases: [...receipt.releases, item] } };
    for (let i = 1; i < rs.length; i++) {
      rs[i] = { ...rs[i]!, receipt: {
        ...receipt, releases: [item, ...receipt.releases],
      } };
    }
    expect(assertPluginReplicaConsensus(rs, expected).approvedReleases).toBe(2);
  });
});
