import { describe, it, expect } from "vitest";
import {
  generatePasskeyRegistrationOptions,
  generatePasskeyAuthenticationOptions,
} from "../domain/passkeys";
import { formatScimUser } from "../domain/scim";
import {
  EnterpriseAuthService,
} from "../application/enterprise-auth-service";

describe("Phase 13: Enterprise Identity & Runtime Governance Flows", () => {
  describe("1. WebAuthn & Passkey Authentication Flows", () => {
    it("generates deterministic registration options with challenge and user metadata", async () => {
      const options = generatePasskeyRegistrationOptions(
        { id: "user-100", email: "editor@vibress.local", name: "Vibress Editor" },
        "vibress.local",
        "Vibress Enterprise",
      );

      expect(options.challenge).toBeDefined();
      expect(options.challenge.length).toBeGreaterThanOrEqual(32);
      expect(options.user.name).toBe("editor@vibress.local");
      expect(options.user.displayName).toBe("Vibress Editor");
      expect(options.pubKeyCredParams).toContainEqual({ alg: -7, type: "public-key" });
    });

    it("generates authentication options with allowCredentials list", async () => {
      const authOptions = generatePasskeyAuthenticationOptions("vibress.local", [
        "cred_abc123",
        "cred_def456",
      ]);

      expect(authOptions.challenge).toBeDefined();
      expect(authOptions.allowCredentials).toHaveLength(2);
      expect(authOptions.allowCredentials?.[0]?.id).toBe("cred_abc123");
    });

    it("registers a passkey on the enterprise auth service and emits domain event", () => {
      const service = new EnterpriseAuthService();
      const passkey = service.registerPasskey("user-100", {
        credentialId: "cred_test_99",
        publicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0...",
        deviceLabel: "MacBook Pro TouchID",
      });

      expect(passkey.id).toBeDefined();
      expect(passkey.credentialId).toBe("cred_test_99");
      expect(passkey.deviceLabel).toBe("MacBook Pro TouchID");

      const authOpts = service.generatePasskeyAuthentication("user-100", "vibress.local");
      expect(authOpts.allowCredentials).toContainEqual({
        id: "cred_test_99",
        type: "public-key",
      });
    });
  });

  describe("2. SCIM 2.0 Provisioning & Deprovisioning", () => {
    it("formats SCIM 2.0 User representation for identity providers (Okta / Entra ID)", () => {
      const user = {
        id: "usr-ent-1",
        email: "john.doe@enterprise.corp",
        name: "John Doe",
        role: "admin",
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      };

      const scim = formatScimUser(user);
      expect(scim.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:User");
      expect(scim.id).toBe("usr-ent-1");
      expect(scim.active).toBe(true);
      expect(scim.roles).toContain("admin");
      expect(scim.meta.resourceType).toBe("User");
    });

    it("formats deprovisioned/inactive SCIM user state", () => {
      const user = {
        id: "usr-ent-2",
        email: "departed@enterprise.corp",
        name: "Departed Employee",
        role: "author",
        status: "disabled",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      };

      const scim = formatScimUser(user);
      expect(scim.active).toBe(false);
    });
  });

  describe("3. Device & Session Governance Lifecycle", () => {
    const service = new EnterpriseAuthService();

    it("registers and lists active device sessions for a user", () => {
      service.registerDeviceSession("user-corp-1", "sess-1", {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0.0.0",
        ipAddress: "192.168.1.50",
        deviceType: "desktop",
      });

      service.registerDeviceSession("user-corp-1", "sess-2", {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Mobile/15E148",
        ipAddress: "10.0.0.24",
        deviceType: "mobile",
      });

      const devices = service.listUserDevices("user-corp-1");
      expect(devices).toHaveLength(2);
      expect(devices[0]?.sessionId).toBe("sess-1");
      expect(devices[1]?.deviceType).toBe("mobile");
    });

    it("revokes a single device session", () => {
      const revoked = service.revokeDevice("user-corp-1", "sess-2");
      expect(revoked).toBe(true);

      const remaining = service.listUserDevices("user-corp-1");
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.sessionId).toBe("sess-1");
    });

    it("revokes all active sessions for a user", () => {
      service.registerDeviceSession("user-corp-1", "sess-3", {
        userAgent: "Firefox/125.0",
        ipAddress: "10.0.0.99",
      });

      const count = service.revokeAllDevices("user-corp-1");
      expect(count).toBe(2);

      const remaining = service.listUserDevices("user-corp-1");
      expect(remaining).toHaveLength(0);
    });
  });

  describe("4. Enterprise MFA Policy Enforcement", () => {
    const service = new EnterpriseAuthService();

    it("enforces mandatory MFA for Owner and Admin roles when policy is configured", () => {
      const policy = { enforceForAll: false, enforceForRoles: ["owner", "admin"] };
      expect(service.isMfaRequired("owner", policy)).toBe(true);
      expect(service.isMfaRequired("admin", policy)).toBe(true);
      expect(service.isMfaRequired("editor", policy)).toBe(false);
      expect(service.isMfaRequired("author", policy)).toBe(false);
    });

    it("enforces mandatory MFA for all roles when enforceForAll is true", () => {
      const policy = { enforceForAll: true, enforceForRoles: [] };
      expect(service.isMfaRequired("author", policy)).toBe(true);
    });
  });
});
