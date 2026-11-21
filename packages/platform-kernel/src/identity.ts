/**
 * Branded platform identities.
 *
 * These identities are intentionally distinct at the type level. A
 * PublicationId cannot be passed where a TenantId is expected, and the CMS
 * publication fallback (`pub_default`) is rejected for application and tenant
 * identities.
 */

declare const platformIdentityBrand: unique symbol;

type Brand<T, B extends string> = T & {
  readonly [platformIdentityBrand]: B;
};

export type ApplicationId = Brand<string, "ApplicationId">;
export type InstallationId = Brand<string, "InstallationId">;
export type EnvironmentId = Brand<string, "EnvironmentId">;
export type OrganizationId = Brand<string, "OrganizationId">;
export type ProjectId = Brand<string, "ProjectId">;
export type TenantId = Brand<string, "TenantId">;
export type PrincipalId = Brand<string, "PrincipalId">;
export type PublicationId = Brand<string, "PublicationId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;

export const LEGACY_PUBLICATION_FALLBACK = "pub_default" as const;

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class InvalidPlatformIdentityError extends Error {
  readonly kind: string;
  readonly value: unknown;

  constructor(kind: string, value: unknown, reason: string) {
    super(`Invalid ${kind}: ${reason}`);
    this.name = "InvalidPlatformIdentityError";
    this.kind = kind;
    this.value = value;
  }
}

function parseIdentifier<T extends string>(
  kind: string,
  value: unknown,
): T {
  if (typeof value !== "string") {
    throw new InvalidPlatformIdentityError(kind, value, "must be a string");
  }
  if (value === LEGACY_PUBLICATION_FALLBACK) {
    throw new InvalidPlatformIdentityError(
      kind,
      value,
      "the legacy pub_default publication fallback is not a valid platform identity",
    );
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new InvalidPlatformIdentityError(
      kind,
      value,
      "must match /^[a-z][a-z0-9_-]{1,62}$/",
    );
  }
  return value as T;
}

export const asApplicationId = (value: unknown): ApplicationId =>
  parseIdentifier<ApplicationId>("ApplicationId", value);
export const asInstallationId = (value: unknown): InstallationId =>
  parseIdentifier<InstallationId>("InstallationId", value);
export const asEnvironmentId = (value: unknown): EnvironmentId =>
  parseIdentifier<EnvironmentId>("EnvironmentId", value);
export const asOrganizationId = (value: unknown): OrganizationId =>
  parseIdentifier<OrganizationId>("OrganizationId", value);
export const asProjectId = (value: unknown): ProjectId =>
  parseIdentifier<ProjectId>("ProjectId", value);
export const asTenantId = (value: unknown): TenantId =>
  parseIdentifier<TenantId>("TenantId", value);
export const asPrincipalId = (value: unknown): PrincipalId =>
  parseIdentifier<PrincipalId>("PrincipalId", value);
export const asWorkspaceId = (value: unknown): WorkspaceId =>
  parseIdentifier<WorkspaceId>("WorkspaceId", value);

/**
 * Publication identities use the legacy CMS vocabulary and therefore do not
 * reject `pub_default`. Only the CMS compatibility adapter may resolve it.
 */
export function asPublicationId(value: unknown): PublicationId {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new InvalidPlatformIdentityError(
      "PublicationId",
      value,
      "must match /^[a-z][a-z0-9_-]{1,62}$/",
    );
  }
  return value as PublicationId;
}

export function isPlatformIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function assertSemver(kind: string, value: unknown): string {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    throw new InvalidPlatformIdentityError(
      kind,
      value,
      "must be a semver string (MAJOR.MINOR.PATCH)",
    );
  }
  return value;
}
