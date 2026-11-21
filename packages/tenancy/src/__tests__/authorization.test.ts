import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import {
  assertRecordAllowed,
  authorizeRecord,
  RecordAuthorizationError,
  type FieldPolicy,
  type ResourceReference,
} from "../authorization";
import { verifyTenantScope, type MembershipRecord } from "../scope";

const applicationId = asApplicationId("crm-app");
const tenantA = asTenantId("tenant-a");
const tenantB = asTenantId("tenant-b");
const principalId = asPrincipalId("principal-1");
const POLICY_VERSION = "policy-2026-11-21";

function scope(permissions: readonly string[] = ["deals.read", "deals.update"]) {
  const principal: VerifiedPrincipal = {
    id: principalId,
    kind: "staff",
    applicationId,
    tenantIds: [tenantA],
    roles: ["sales"],
    permissions,
  };
  const membership: MembershipRecord = {
    applicationId,
    tenantId: tenantA,
    principalId,
    active: true,
    roles: ["sales"],
    permissions,
  };
  return verifyTenantScope({
    applicationId,
    tenantId: tenantA,
    principal,
    membership,
    authorization: {
      allowed: true,
      permissions,
      policyVersion: POLICY_VERSION,
    },
  });
}

const resource: ResourceReference = {
  applicationId: applicationId as string,
  tenantId: tenantA as string,
  resourceType: "deal",
  resourceId: "deal-1",
};

const fieldPolicies: readonly FieldPolicy[] = [
  { resourceType: "deal", allowedFields: ["id", "name", "stage"], deniedFields: ["ssn"] },
];

describe("M02 default-deny record and field authorization", () => {
  it("allows a verified principal with matching permission", () => {
    const decision = assertRecordAllowed({
      scope: scope(),
      action: "deals.read",
      resource,
      requestedFields: ["id", "name"],
      fieldPolicies,
    });
    expect(decision.effect).toBe("allow");
    expect(decision.allowedFields).toEqual(["id", "name"]);
    expect(decision.principalId).toBe(principalId);
    expect(decision.policyVersion).toBe(POLICY_VERSION);
  });

  it("denies a resource in another tenant or application", () => {
    expect(
      authorizeRecord({
        scope: scope(),
        action: "deals.read",
        resource: { ...resource, tenantId: tenantB as string },
      }).reason,
    ).toMatch(/does not belong to the verified application and tenant/);
    expect(
      authorizeRecord({
        scope: scope(),
        action: "deals.read",
        resource: { ...resource, applicationId: "other-app" },
      }).effect,
    ).toBe("deny");
  });

  it("denies missing permission by default", () => {
    const decision = authorizeRecord({
      scope: scope(),
      action: "deals.delete",
      resource,
    });
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toMatch(/lacks permission/);
  });

  it("denies explicit deny permissions", () => {
    const decision = authorizeRecord({
      scope: scope(["deals.read", "deny:deals.export"]),
      action: "deals.export",
      resource,
    });
    expect(decision.reason).toMatch(/explicit deny/);
  });

  it("rejects stale membership versions", () => {
    const decision = authorizeRecord({
      scope: scope(),
      action: "deals.read",
      resource,
      membershipVersion: "stale-version",
    });
    expect(decision.reason).toMatch(/stale membership/);
  });

  it("denies unauthorized and explicitly forbidden fields", () => {
    expect(
      authorizeRecord({
        scope: scope(),
        action: "deals.read",
        resource,
        requestedFields: ["id", "ssn"],
        fieldPolicies,
      }).reason,
    ).toMatch(/field-level denial/);
    expect(
      authorizeRecord({
        scope: scope(),
        action: "deals.read",
        resource,
        requestedFields: ["secret"],
        fieldPolicies,
      }).effect,
    ).toBe("deny");
  });

  it("throws an auditable error through the assert helper", () => {
    expect(() =>
      assertRecordAllowed({
        scope: scope(),
        action: "deals.delete",
        resource,
      }),
    ).toThrow(RecordAuthorizationError);
  });

  it("produces frozen decisions without caller-controlled identity", () => {
    const decision = assertRecordAllowed({
      scope: scope(),
      action: "deals.read",
      resource,
      requestedFields: ["id"],
      fieldPolicies,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision.tenantId).toBe(tenantA as string);
  });
});
