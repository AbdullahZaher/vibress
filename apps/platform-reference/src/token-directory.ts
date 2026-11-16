import { createHash, timingSafeEqual } from "node:crypto";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type ApplicationId,
  type PrincipalKind,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";

const PRINCIPAL_KINDS: readonly PrincipalKind[] = [
  "end_user",
  "staff",
  "operator",
  "service",
];

export class InvalidReferenceTokenDirectoryError extends Error {
  constructor(reason: string) {
    super(`Invalid reference token directory: ${reason}`);
    this.name = "InvalidReferenceTokenDirectoryError";
  }
}

interface TokenEntry {
  readonly digest: Buffer;
  readonly principal: VerifiedPrincipal;
}

function parseStringArray(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new InvalidReferenceTokenDirectoryError(
      `${field} must be a string array`,
    );
  }
  return Object.freeze([...value] as string[]);
}

/**
 * Operator-configured bearer tokens mapped to server-verified principals.
 * This is a reference auth adapter: the token is only a credential, and the
 * principal is resolved on the server. A real deployment replaces this with
 * its identity provider.
 */
export class ReferenceTokenDirectory {
  readonly #entries: readonly TokenEntry[];

  private constructor(entries: readonly TokenEntry[]) {
    this.#entries = Object.freeze(entries);
  }

  static fromJson(
    applicationId: ApplicationId | string,
    json: string | undefined,
  ): ReferenceTokenDirectory {
    if (json === undefined || json.trim() === "") {
      return new ReferenceTokenDirectory([]);
    }
    const application = asApplicationId(applicationId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new InvalidReferenceTokenDirectoryError("must be valid JSON");
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new InvalidReferenceTokenDirectoryError(
        "must be an object keyed by bearer token",
      );
    }

    const entries: TokenEntry[] = [];
    for (const [token, raw] of Object.entries(parsed)) {
      if (token.trim() === "") {
        throw new InvalidReferenceTokenDirectoryError(
          "tokens must not be empty",
        );
      }
      if (typeof raw !== "object" || raw === null) {
        throw new InvalidReferenceTokenDirectoryError(
          `token entry ${token.slice(0, 4)}… must be an object`,
        );
      }
      const record = raw as Record<string, unknown>;
      if (typeof record.id !== "string") {
        throw new InvalidReferenceTokenDirectoryError(
          "principal id is required",
        );
      }
      if (
        typeof record.kind !== "string" ||
        !PRINCIPAL_KINDS.includes(record.kind as PrincipalKind)
      ) {
        throw new InvalidReferenceTokenDirectoryError(
          `principal kind must be one of ${PRINCIPAL_KINDS.join(", ")}`,
        );
      }
      const principal: VerifiedPrincipal = Object.freeze({
        id: asPrincipalId(record.id),
        kind: record.kind as PrincipalKind,
        applicationId: application,
        tenantIds: Object.freeze(
          parseStringArray(record.tenantIds, "tenantIds").map((tenantId) =>
            asTenantId(tenantId),
          ),
        ),
        roles: parseStringArray(record.roles, "roles"),
        permissions: parseStringArray(record.permissions, "permissions"),
      });
      entries.push({
        digest: createHash("sha256").update(token, "utf8").digest(),
        principal,
      });
    }
    return new ReferenceTokenDirectory(entries);
  }

  resolve(presentedToken: string): VerifiedPrincipal | null {
    const digest = createHash("sha256").update(presentedToken, "utf8").digest();
    let resolved: VerifiedPrincipal | null = null;
    for (const entry of this.#entries) {
      if (
        entry.digest.length === digest.length &&
        timingSafeEqual(entry.digest, digest)
      ) {
        resolved = entry.principal;
      }
    }
    return resolved;
  }
}
