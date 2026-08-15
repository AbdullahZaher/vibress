import {
  generatePasskeyRegistrationOptions,
  generatePasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
  PasskeyAuthenticationOptions,
} from "../domain/passkeys";
import { formatScimUser, ScimUserResource } from "../domain/scim";
import { domainEvents } from "@vibress/events";
import { randomUUID } from "crypto";

export interface DeviceSession {
  id: string;
  userId: string;
  sessionId: string;
  userAgent: string;
  ipAddress: string;
  deviceType: "desktop" | "mobile" | "tablet";
  lastActiveAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface PasskeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceLabel: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export class EnterpriseAuthService {
  private devices = new Map<string, DeviceSession[]>();
  private passkeys = new Map<string, PasskeyCredential[]>();

  // ---------------- Passkeys / WebAuthn ----------------

  generatePasskeyRegistration(
    user: { id: string; email: string; name: string },
    rpId: string,
  ): PasskeyRegistrationOptions {
    return generatePasskeyRegistrationOptions(user, rpId);
  }

  registerPasskey(
    userId: string,
    credential: {
      credentialId: string;
      publicKey: string;
      deviceLabel: string;
    },
  ): PasskeyCredential {
    const list = this.passkeys.get(userId) || [];
    const newPasskey: PasskeyCredential = {
      id: randomUUID(),
      userId,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      counter: 0,
      deviceLabel: credential.deviceLabel,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };
    list.push(newPasskey);
    this.passkeys.set(userId, list);

    domainEvents.emit("auth.passkey_registered", {
      userId,
      credentialId: credential.credentialId,
      deviceLabel: credential.deviceLabel,
    });

    return newPasskey;
  }

  generatePasskeyAuthentication(
    userId: string,
    rpId: string,
  ): PasskeyAuthenticationOptions {
    const userPasskeys = this.passkeys.get(userId) || [];
    const credIds = userPasskeys.map((p) => p.credentialId);
    return generatePasskeyAuthenticationOptions(rpId, credIds);
  }

  // ---------------- Session & Device Management ----------------

  registerDeviceSession(
    userId: string,
    sessionId: string,
    info: { userAgent: string; ipAddress: string; deviceType?: "desktop" | "mobile" | "tablet" },
  ): DeviceSession {
    const userDevices = this.devices.get(userId) || [];
    const device: DeviceSession = {
      id: randomUUID(),
      userId,
      sessionId,
      userAgent: info.userAgent,
      ipAddress: info.ipAddress,
      deviceType: info.deviceType || "desktop",
      lastActiveAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    };
    userDevices.push(device);
    this.devices.set(userId, userDevices);

    domainEvents.emit("auth.device_registered", {
      userId,
      sessionId,
      ipAddress: info.ipAddress,
    });

    return device;
  }

  listUserDevices(userId: string): DeviceSession[] {
    const list = this.devices.get(userId) || [];
    return list.filter((d) => !d.revokedAt);
  }

  revokeDevice(userId: string, sessionId: string): boolean {
    const list = this.devices.get(userId) || [];
    const dev = list.find((d) => d.sessionId === sessionId && !d.revokedAt);
    if (!dev) return false;

    dev.revokedAt = new Date();
    domainEvents.emit("auth.device_revoked", {
      userId,
      sessionId,
    });
    return true;
  }

  revokeAllDevices(userId: string, exceptSessionId?: string): number {
    const list = this.devices.get(userId) || [];
    let count = 0;
    const now = new Date();
    for (const dev of list) {
      if (!dev.revokedAt && dev.sessionId !== exceptSessionId) {
        dev.revokedAt = now;
        count++;
      }
    }
    if (count > 0) {
      domainEvents.emit("auth.all_devices_revoked", {
        userId,
        revokedCount: count,
      });
    }
    return count;
  }

  // ---------------- MFA Enforcement ----------------

  isMfaRequired(
    userRole: string,
    policy: { enforceForAll: boolean; enforceForRoles: string[] },
  ): boolean {
    if (policy.enforceForAll) return true;
    return policy.enforceForRoles.includes(userRole);
  }

  // ---------------- SCIM User Formatting ----------------

  formatScimUserResource(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    status?: string;
    createdAt: Date;
    updatedAt: Date;
  }): ScimUserResource {
    return formatScimUser(user);
  }
}
