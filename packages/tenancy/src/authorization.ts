import type { VerifiedScope } from "./scope";

/**
 * M02-E02/E03/E06 — default-deny record and field authorization.
 *
 * Pure and deterministic. It binds every decision to a server-verified scope,
 * an application/tenant-owned resource and an optional membership version.
 * No decision can be produced from caller-supplied identity data.
 */
export interface ResourceReference {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly resourceType: string;
  readonly resourceId: string;
}

export interface FieldPolicy {
  readonly resourceType: string;
  readonly allowedFields: readonly string[];
  readonly deniedFields?: readonly string[];
}

export interface RecordAuthorizationRequest {
  readonly scope: VerifiedScope;
  readonly action: string;
  readonly resource: ResourceReference;
  readonly requestedFields?: readonly string[];
  readonly membershipVersion?: string;
  readonly fieldPolicies?: readonly FieldPolicy[];
}

export interface AuthorizationDecision {
  readonly effect: "allow" | "deny";
  readonly reason: string;
  readonly action: string;
  readonly principalId: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly allowedFields: readonly string[];
  readonly deniedFields: readonly string[];
  readonly policyVersion: string;
}

export class RecordAuthorizationError extends Error {
  readonly decision: AuthorizationDecision;

  constructor(decision: AuthorizationDecision) {
    super(`authorization denied ${decision.action}: ${decision.reason}`);
    this.name = "RecordAuthorizationError";
    this.decision = decision;
  }
}

function matches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

function deny(
  request: RecordAuthorizationRequest,
  reason: string,
): AuthorizationDecision {
  return Object.freeze({
    effect: "deny" as const,
    reason,
    action: request.action,
    principalId: request.scope.principal.id,
    applicationId: request.scope.applicationId,
    tenantId: request.scope.tenantId,
    resourceType: request.resource.resourceType,
    resourceId: request.resource.resourceId,
    allowedFields: Object.freeze([]),
    deniedFields: Object.freeze([...(request.requestedFields ?? [])]),
    policyVersion: request.scope.authorization.policyVersion,
  });
}

export function authorizeRecord(
  request: RecordAuthorizationRequest,
): AuthorizationDecision {
  const { scope, resource } = request;
  if (
    resource.applicationId !== scope.applicationId ||
    resource.tenantId !== scope.tenantId
  ) {
    return deny(
      request,
      "resource does not belong to the verified application and tenant",
    );
  }
  if (request.membershipVersion !== undefined && request.membershipVersion !== "") {
    // A caller-supplied version must match the snapshot's policy generation.
    if (request.membershipVersion !== scope.authorization.policyVersion) {
      return deny(request, "stale membership version");
    }
  }
  if (scope.authorization.permissions.some((p) => p.startsWith("deny:"))) {
    return deny(request, "explicit deny in verified authorization snapshot");
  }
  if (!scope.authorization.permissions.some((p) => matches(p, request.action))) {
    return deny(request, `principal lacks permission ${request.action}`);
  }

  const policy = (request.fieldPolicies ?? []).find(
    (candidate) => candidate.resourceType === resource.resourceType,
  );
  const requested = [...new Set(request.requestedFields ?? [])].sort();
  const deniedFromPolicy = new Set(policy?.deniedFields ?? []);
  const allowed = policy
    ? requested.filter(
        (field) =>
          policy.allowedFields.includes(field) && !deniedFromPolicy.has(field),
      )
    : requested;
  const allowedSet = new Set(allowed);
  const denied = requested.filter((field) => !allowedSet.has(field));
  if (denied.length > 0) {
    return deny(request, `field-level denial: ${denied.join(", ")}`);
  }
  if (policy && !policy.allowedFields.length && requested.length === 0) {
    // An empty field policy means no field is readable in this context.
    return deny(request, "no fields are authorized for this resource type");
  }

  return Object.freeze({
    effect: "allow" as const,
    reason: "allowed by verified scope and field policy",
    action: request.action,
    principalId: scope.principal.id,
    applicationId: scope.applicationId,
    tenantId: scope.tenantId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    allowedFields: Object.freeze(allowed),
    deniedFields: Object.freeze([]),
    policyVersion: scope.authorization.policyVersion,
  });
}

export function assertRecordAllowed(
  request: RecordAuthorizationRequest,
): AuthorizationDecision {
  const decision = authorizeRecord(request);
  if (decision.effect !== "allow") throw new RecordAuthorizationError(decision);
  return decision;
}
