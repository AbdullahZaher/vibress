import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  LEGACY_PUBLICATION_FALLBACK,
  type ApplicationId,
  type PrincipalId,
  type TenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";

const verifiedScopeBrand: unique symbol = Symbol("vibress.verifiedTenantScope");

export interface AuthorizationSnapshot {
  readonly allowed: boolean;
  readonly permissions: readonly string[];
  readonly policyVersion: string;
}

/**
 * A scope that can only be produced by `verifyTenantScope`. Repositories must
 * accept this type rather than a bare tenant id.
 */
export interface VerifiedScope {
  readonly [verifiedScopeBrand]: true;
  readonly applicationId: ApplicationId;
  readonly tenantId: TenantId;
  readonly principal: VerifiedPrincipal;
  readonly authorization: AuthorizationSnapshot;
}

export interface MembershipRecord {
  readonly applicationId: ApplicationId;
  readonly tenantId: TenantId;
  readonly principalId: PrincipalId;
  readonly active: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface ScopeResolver {
  resolve(
    principalId: PrincipalId,
    applicationId: ApplicationId,
    tenantId: TenantId,
  ): Promise<MembershipRecord | null>;
}

export class ScopeVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeVerificationError";
  }
}

export interface ScopeVerificationInput {
  readonly applicationId: ApplicationId;
  readonly tenantId: TenantId;
  readonly principal: VerifiedPrincipal;
  readonly authorization: AuthorizationSnapshot;
  readonly membership: MembershipRecord;
}

export function verifyTenantScope(
  input: ScopeVerificationInput,
): VerifiedScope {
  const { applicationId, tenantId, principal, authorization, membership } =
    input;

  if ((applicationId as string) === LEGACY_PUBLICATION_FALLBACK) {
    throw new ScopeVerificationError(
      "pub_default is not an application identity",
    );
  }
  if ((tenantId as string) === LEGACY_PUBLICATION_FALLBACK) {
    throw new ScopeVerificationError(
      "pub_default is not a tenant identity",
    );
  }
  if (principal.applicationId !== applicationId) {
    throw new ScopeVerificationError(
      "principal belongs to a different application",
    );
  }
  if (!principal.tenantIds.includes(tenantId)) {
    throw new ScopeVerificationError(
      "principal is not entitled to the requested tenant",
    );
  }
  if (!authorization.allowed) {
    throw new ScopeVerificationError("authorization denied the scope");
  }
  if (authorization.policyVersion.trim() === "") {
    throw new ScopeVerificationError(
      "authorization snapshot must record a policy version",
    );
  }
  if (
    membership.applicationId !== applicationId ||
    membership.tenantId !== tenantId ||
    membership.principalId !== principal.id
  ) {
    throw new ScopeVerificationError(
      "membership does not match the requested application, tenant and principal",
    );
  }
  if (!membership.active) {
    throw new ScopeVerificationError("membership is not active");
  }

  const granted = new Set(authorization.permissions);
  for (const permission of membership.permissions) {
    if (!granted.has(permission)) {
      throw new ScopeVerificationError(
        `authorization snapshot is missing membership permission ${permission}`,
      );
    }
  }

  return Object.freeze({
    [verifiedScopeBrand]: true as const,
    applicationId,
    tenantId,
    principal: Object.freeze({
      ...principal,
      tenantIds: Object.freeze([...principal.tenantIds]),
      roles: Object.freeze([...principal.roles]),
      permissions: Object.freeze([...principal.permissions]),
    }),
    authorization: Object.freeze({
      allowed: true as const,
      permissions: Object.freeze([...authorization.permissions]),
      policyVersion: authorization.policyVersion,
    }),
  });
}

export async function resolveVerifiedScope(
  resolver: ScopeResolver,
  input: {
    applicationId: ApplicationId;
    tenantId: TenantId;
    principal: VerifiedPrincipal;
    policyVersion: string;
  },
): Promise<VerifiedScope> {
  const membership = await resolver.resolve(
    input.principal.id,
    input.applicationId,
    input.tenantId,
  );
  if (!membership) {
    throw new ScopeVerificationError(
      "no membership exists for the requested application and tenant",
    );
  }
  return verifyTenantScope({
    applicationId: input.applicationId,
    tenantId: input.tenantId,
    principal: input.principal,
    membership,
    authorization: {
      allowed: true,
      permissions: membership.permissions,
      policyVersion: input.policyVersion,
    },
  });
}

export function isVerifiedScope(value: unknown): value is VerifiedScope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as VerifiedScope)[verifiedScopeBrand] === true
  );
}

export function assertVerifiedScope(value: unknown): asserts value is VerifiedScope {
  if (!isVerifiedScope(value)) {
    throw new ScopeVerificationError(
      "a server-verified tenant scope is required",
    );
  }
}

export function parseScopeIdentifiers(input: {
  applicationId: unknown;
  tenantId: unknown;
  principalId: unknown;
}): {
  applicationId: ApplicationId;
  tenantId: TenantId;
  principalId: PrincipalId;
} {
  return {
    applicationId: asApplicationId(input.applicationId),
    tenantId: asTenantId(input.tenantId),
    principalId: asPrincipalId(input.principalId),
  };
}
