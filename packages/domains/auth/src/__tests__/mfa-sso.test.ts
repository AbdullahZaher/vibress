import { describe, it, expect } from "vitest";
import {
  generateTotpSecret,
  generateOtpAuthUri,
  verifyTotpToken,
  generateBackupCodes,
  SsoProvider,
  SsoUserPayload,
} from "../index";

describe("Enterprise Identity, MFA & SSO Governance", () => {
  it("generates valid Base32 TOTP secret and otpauth URI", () => {
    const secret = generateTotpSecret(20);
    expect(secret).toHaveLength(20);
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);

    const uri = generateOtpAuthUri(secret, "admin@enterprise.com", "Vibress Enterprise");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=Vibress%20Enterprise");
  });

  it("rejects malformed or invalid TOTP codes", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(verifyTotpToken(secret, "123")).toBe(false);
    expect(verifyTotpToken(secret, "abcdef")).toBe(false);
    expect(verifyTotpToken(secret, "000000", Date.now())).toBe(false);
  });

  it("generates 10 single-use recovery backup codes with matching SHA-256 hashes", () => {
    const { plainCodes, hashedCodes } = generateBackupCodes(10);
    expect(plainCodes).toHaveLength(10);
    expect(hashedCodes).toHaveLength(10);

    for (let i = 0; i < 10; i++) {
      expect(plainCodes[i]).toMatch(/^[a-f0-9]{4}-[a-f0-9]{4}$/);
      expect(hashedCodes[i]).toHaveLength(64); // SHA-256 hex string
    }
  });

  it("conforms to SSO Provider interface contract for enterprise SAML/OIDC identity", async () => {
    const _mockSsoConfig = {
      id: "okta_corp",
      name: "Okta Enterprise SSO",
      protocol: "oidc" as const,
      issuerUrl: "https://auth.enterprise.com",
      clientId: "client_123",
      enabled: true,
      autoProvision: true,
      defaultRole: "editor",
    };

    const mockProvider: SsoProvider = {
      protocol: "oidc",
      async getAuthorizationUrl(state: string, redirectUri: string) {
        return {
          url: `https://auth.enterprise.com/oauth2/v1/authorize?client_id=client_123&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
          state,
        };
      },
      async validateCallback(payload: Record<string, unknown>): Promise<SsoUserPayload> {
        return {
          externalId: String(payload.sub || "ext_123"),
          email: "alice@enterprise.com",
          name: "Alice Smith",
        };
      },
    };

    const authUrl = await mockProvider.getAuthorizationUrl("state_abc", "https://app.vibress.com/callback");
    expect(authUrl.url).toContain("https://auth.enterprise.com");
    expect(authUrl.state).toBe("state_abc");

    const user = await mockProvider.validateCallback({ sub: "user_999" });
    expect(user.externalId).toBe("user_999");
    expect(user.email).toBe("alice@enterprise.com");
  });
});
