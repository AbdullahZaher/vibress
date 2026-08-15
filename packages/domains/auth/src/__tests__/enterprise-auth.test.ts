import { describe, it, expect } from "vitest";
import {
  EnterpriseAuthService,
  formatScimUser,
} from "../index";

describe("Phase 13: Enterprise Identity, Passkeys, SCIM & Governance", () => {
  const service = new EnterpriseAuthService();

  it("generates valid WebAuthn/Passkey registration and authentication options", () => {
    const regOptions = service.generatePasskeyRegistration(
      { id: "user_123", email: "admin@enterprise.com", name: "Admin User" },
      "enterprise.com",
    );

    expect(regOptions.challenge).toBeDefined();
    expect(regOptions.rp.id).toBe("enterprise.com");
    expect(regOptions.user.name).toBe("admin@enterprise.com");
    expect(regOptions.pubKeyCredParams.length).toBeGreaterThan(0);

    // Register credential
    const passkey = service.registerPasskey("user_123", {
      credentialId: "cred_abc123",
      publicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
      deviceLabel: "MacBook Touch ID",
    });
    expect(passkey.credentialId).toBe("cred_abc123");

    // Authenticate options includes registered credentials
    const authOptions = service.generatePasskeyAuthentication("user_123", "enterprise.com");
    expect(authOptions.rpId).toBe("enterprise.com");
    expect(authOptions.allowCredentials?.some((c) => c.id === "cred_abc123")).toBe(true);
  });

  it("manages user devices and supports revoking a single device or all devices", () => {
    const userId = "user_device_test";

    service.registerDeviceSession(userId, "sess_1", {
      userAgent: "Chrome on macOS",
      ipAddress: "192.168.1.50",
      deviceType: "desktop",
    });
    service.registerDeviceSession(userId, "sess_2", {
      userAgent: "Safari on iOS",
      ipAddress: "10.0.0.1",
      deviceType: "mobile",
    });

    expect(service.listUserDevices(userId)).toHaveLength(2);

    // Revoke dev1
    const revokedSingle = service.revokeDevice(userId, "sess_1");
    expect(revokedSingle).toBe(true);
    expect(service.listUserDevices(userId)).toHaveLength(1);
    expect(service.listUserDevices(userId)[0]?.sessionId).toBe("sess_2");

    // Add dev3
    service.registerDeviceSession(userId, "sess_3", {
      userAgent: "Firefox on Windows",
      ipAddress: "192.168.1.100",
      deviceType: "desktop",
    });

    // Revoke all except current session (sess_3)
    const revokedCount = service.revokeAllDevices(userId, "sess_3");
    expect(revokedCount).toBe(1); // revokes sess_2
    expect(service.listUserDevices(userId)).toHaveLength(1);
    expect(service.listUserDevices(userId)[0]?.sessionId).toBe("sess_3");
  });

  it("governs MFA enforcement based on workspace role policy", () => {
    const ownerPolicy = {
      enforceForAll: false,
      enforceForRoles: ["owner", "admin"],
    };

    expect(service.isMfaRequired("owner", ownerPolicy)).toBe(true);
    expect(service.isMfaRequired("admin", ownerPolicy)).toBe(true);
    expect(service.isMfaRequired("author", ownerPolicy)).toBe(false);

    const universalPolicy = {
      enforceForAll: true,
      enforceForRoles: [],
    };
    expect(service.isMfaRequired("contributor", universalPolicy)).toBe(true);
  });

  it("formats SCIM 2.0 User resource representation accurately", () => {
    const scim = formatScimUser({
      id: "usr_scim",
      email: "engineer@company.com",
      name: "Lead Engineer",
      role: "admin",
      status: "active",
      createdAt: new Date("2026-08-15T12:00:00Z"),
      updatedAt: new Date("2026-08-15T12:00:00Z"),
    });

    expect(scim.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:User");
    expect(scim.userName).toBe("engineer@company.com");
    expect(scim.active).toBe(true);
    expect(scim.roles).toContain("admin");
    expect(scim.meta.resourceType).toBe("User");
  });
});
