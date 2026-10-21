import { describe, expect, it } from "vitest";
import { signSiteAuthToken } from "@vibress/security";
import { evaluatePublicSiteAccess } from "../public-site-privacy";

const secret = "security-review-private-site-test-secret";
const privateSettings = async () => ({ security: { isPrivate: true } });

describe("EXT-302A production public-site privacy gate", () => {
  it("denies the page descriptor and data without a site password cookie", async () => {
    expect(await evaluatePublicSiteAccess("pub_a", undefined, secret, privateSettings))
      .toBe("denied");
    expect(await evaluatePublicSiteAccess("pub_a", "forged", secret, privateSettings))
      .toBe("denied");
  });

  it("accepts only a valid cookie bound to the Host-selected publication", async () => {
    const proofForA = signSiteAuthToken(secret, "pub_a");
    expect(await evaluatePublicSiteAccess("pub_a", proofForA, secret, privateSettings))
      .toBe("allowed");
    expect(await evaluatePublicSiteAccess("pub_b", proofForA, secret, privateSettings))
      .toBe("denied");
    expect(await evaluatePublicSiteAccess("pub_a", proofForA, "other-secret", privateSettings))
      .toBe("denied");
  });

  it("fails closed when privacy settings cannot be loaded", async () => {
    expect(await evaluatePublicSiteAccess(
      "pub_a", undefined, secret,
      async () => { throw new Error("Publication settings database unavailable"); },
    )).toBe("unavailable");
  });

  it("preserves old installations with no private-site flag", async () => {
    expect(await evaluatePublicSiteAccess("pub_a", undefined, secret, async () => ({})))
      .toBe("allowed");
    expect(await evaluatePublicSiteAccess("pub_a", undefined, secret,
      async () => ({ security: { isPrivate: false } }))).toBe("allowed");
  });
});
