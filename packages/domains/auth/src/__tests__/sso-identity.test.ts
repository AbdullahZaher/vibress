import { describe, it, expect } from "vitest";
import {
  SsoProvider,
  SsoUserPayload,
  SsoAuthUrlResult,
} from "../index";

describe("Enterprise Identity & Governance SSO Models", () => {
  it("defines OIDC provider adhering to interface contract", async () => {
    const mockOidcProvider: SsoProvider = {
      protocol: "oidc",
      getAuthorizationUrl: async (state: string, redirectUri: string): Promise<SsoAuthUrlResult> => {
        return {
          url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
          state,
        };
      },
      validateCallback: async (payload: Record<string, unknown>): Promise<SsoUserPayload> => {
        return {
          externalId: String(payload.sub || "user-123"),
          email: String(payload.email || "user@enterprise.com"),
          name: String(payload.name || "Enterprise User"),
        };
      },
    };

    expect(mockOidcProvider.protocol).toBe("oidc");

    const authUrl = await mockOidcProvider.getAuthorizationUrl("nonce-state", "https://app.vibress.io/callback");
    expect(authUrl.url).toContain("state=nonce-state");

    const user = await mockOidcProvider.validateCallback({
      sub: "corp-456",
      email: "alice@corp.com",
      name: "Alice Corp",
    });
    expect(user.email).toBe("alice@corp.com");
    expect(user.externalId).toBe("corp-456");
  });
});
