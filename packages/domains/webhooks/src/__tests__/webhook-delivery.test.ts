import { describe, it, expect } from "vitest";
import crypto from "crypto";

describe("Developer Platform Webhooks & Signature Verification", () => {
  it("computes HMAC-SHA256 signature matching expected digest", () => {
    const payload = JSON.stringify({
      id: "evt_12345",
      type: "post.published",
      timestamp: "2026-08-15T12:00:00.000Z",
    });
    const secret = "whsec_supersecretkey123";

    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    const header = `sha256=${signature}`;
    expect(header).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Receiver verification check
    const expectedSig = header.replace("sha256=", "");
    const receiverSig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(receiverSig).toBe(expectedSig);
  });
});
