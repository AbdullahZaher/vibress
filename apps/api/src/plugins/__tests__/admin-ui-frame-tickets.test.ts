import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { AdminUiFrameTickets } from "../admin-ui-frame-tickets";

/**
 * Integration test against the real shared Redis configured by globalSetup.
 * Models two API replicas as separate stateless service instances.
 */
describe("EXT-301B2B shared Redis frame tickets", () => {
  const claim = () => ({
    staffId: "staff-" + randomBytes(8).toString("hex"),
    sessionHash: randomBytes(32).toString("hex"),
    publicationId: "publication-" + randomBytes(8).toString("hex"),
    pluginId: "operator-demo",
    viewId: "courses",
    sha256: randomBytes(32).toString("hex"),
    bridgeNonce: randomBytes(32).toString("hex"),
  });

  it("atomically consumes an operator-approved ticket exactly once across replicas", async () => {
    const issuingReplica = new AdminUiFrameTickets();
    const readingReplica = new AdminUiFrameTickets();
    const approved = claim();
    const token = await issuingReplica.issue(approved);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const [first, second] = await Promise.all([
      issuingReplica.consume(token),
      readingReplica.consume(token),
    ]);
    expect([first, second].filter((item) => item !== null)).toHaveLength(1);
    expect(first ?? second).toEqual(approved);
    expect(await readingReplica.consume(token)).toBeNull();
  });

  it("rejects invalid tokens and cannot reissue an old client-controlled token", async () => {
    const replica = new AdminUiFrameTickets();
    for (const malformed of ["", "../", "a".repeat(63), "z".repeat(64)]) {
      expect(await replica.consume(malformed)).toBeNull();
    }
    const token = await replica.issue(claim());
    expect(await replica.consume(token)).not.toBeNull();
    expect(await replica.consume(token)).toBeNull();
  });
});
