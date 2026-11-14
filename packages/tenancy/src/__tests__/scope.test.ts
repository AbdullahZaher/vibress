import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import {
  resolveVerifiedScope,
  ScopeVerificationError,
  verifyTenantScope,
  type MembershipRecord,
} from "../scope";

const applicationId = asApplicationId("customer-crm");
const tenantA = asTenantId("tenant-a");
const tenantB = asTenantId("tenant-b");
const principalId = asPrincipalId("principal-1");

function principal(overrides: Partial<VerifiedPrincipal> = {}): VerifiedPrincipal {
  return {
    id: principalId,
    kind: "staff",
    applicationId,
    tenantIds: [tenantA],
    roles: ["sales"],
    permissions: ["customers.read", "deals.approve"],
    ...overrides,
  };
}

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    applicationId,
    tenantId: tenantA,
    principalId,
    active: true,
    roles: ["sales"],
    permissions: ["customers.read", "deals.approve"],
    ...overrides,
  };
}

describe("verifyTenantScope", () => {
  it("creates a frozen verified scope from matching server-owned inputs", () => {
    const scope = verifyTenantScope({
      applicationId,
      tenantId: tenantA,
      principal: principal(),
      authorization: {
        allowed: true,
        permissions: ["customers.read", "deals.approve"],
        policyVersion: "policy-2026-11-14",
      },
      membership: membership(),
    });
    expect(scope.applicationId).toBe(applicationId);
    expect(scope.tenantId).toBe(tenantA);
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it("rejects a principal from another application", () => {
    expect(() =>
      verifyTenantScope({
        applicationId,
        tenantId: tenantA,
        principal: principal({ applicationId: asApplicationId("other-app") }),
        authorization: {
          allowed: true,
          permissions: ["customers.read", "deals.approve"],
          policyVersion: "p1",
        },
        membership: membership(),
      }),
    ).toThrow(/different application/);
  });

  it("rejects a tenant the principal is not entitled to", () => {
    expect(() =>
      verifyTenantScope({
        applicationId,
        tenantId: tenantB,
        principal: principal(),
        authorization: {
          allowed: true,
          permissions: ["customers.read", "deals.approve"],
          policyVersion: "p1",
        },
        membership: membership({ tenantId: tenantB }),
      }),
    ).toThrow(/not entitled/);
  });

  it("rejects an inactive membership", () => {
    expect(() =>
      verifyTenantScope({
        applicationId,
        tenantId: tenantA,
        principal: principal(),
        authorization: {
          allowed: true,
          permissions: ["customers.read", "deals.approve"],
          policyVersion: "p1",
        },
        membership: membership({ active: false }),
      }),
    ).toThrow(ScopeVerificationError);
  });

  it("rejects an authorization snapshot that omits membership permissions", () => {
    expect(() =>
      verifyTenantScope({
        applicationId,
        tenantId: tenantA,
        principal: principal(),
        authorization: {
          allowed: true,
          permissions: ["customers.read"],
          policyVersion: "p1",
        },
        membership: membership(),
      }),
    ).toThrow(/missing membership permission/);
  });

  it("rejects a denied authorization snapshot", () => {
    expect(() =>
      verifyTenantScope({
        applicationId,
        tenantId: tenantA,
        principal: principal(),
        authorization: {
          allowed: false,
          permissions: [],
          policyVersion: "p1",
        },
        membership: membership(),
      }),
    ).toThrow(/denied the scope/);
  });
});

describe("resolveVerifiedScope", () => {
  it("fails closed when no membership exists", async () => {
    await expect(
      resolveVerifiedScope(
        { resolve: async () => null },
        { applicationId, tenantId: tenantA, principal: principal(), policyVersion: "p1" },
      ),
    ).rejects.toThrow(/no membership/);
  });

  it("builds a scope from the resolved membership", async () => {
    const scope = await resolveVerifiedScope(
      { resolve: async () => membership() },
      { applicationId, tenantId: tenantA, principal: principal(), policyVersion: "p1" },
    );
    expect(scope.tenantId).toBe(tenantA);
  });
});
