import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  LEGACY_PUBLICATION_FALLBACK,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import {
  buildExportManifest,
  buildOffboardingPlan,
  LifecycleContractError,
  reconcileOffboarding,
  validateRetentionPolicy,
  type RetentionPolicy,
} from "../lifecycle";
import { verifyTenantScope, type MembershipRecord } from "../scope";

const applicationId = asApplicationId("customer-crm");
const tenantA = asTenantId("tenant-a");
const tenantB = asTenantId("tenant-b");
const principalId = asPrincipalId("principal-1");

function scope(overrides: { readonly tenantId?: typeof tenantA | typeof tenantB } = {}) {
  const selectedTenant = overrides.tenantId ?? tenantA;
  const principal: VerifiedPrincipal = {
    id: principalId,
    kind: "staff",
    applicationId,
    tenantIds: [selectedTenant],
    roles: ["sales"],
    permissions: ["customers.read"],
  };
  const membership: MembershipRecord = {
    applicationId,
    tenantId: selectedTenant,
    principalId,
    active: true,
    roles: ["sales"],
    permissions: ["customers.read"],
  };
  return verifyTenantScope({
    applicationId,
    tenantId: selectedTenant,
    principal,
    membership,
    authorization: {
      allowed: true,
      permissions: ["customers.read"],
      policyVersion: "policy-2026-11-21",
    },
  });
}

const retention = (surface: RetentionPolicy["surface"], legalHold = false): RetentionPolicy => ({
  surface,
  maxRetentionDays: 30,
  legalHold,
});

describe("bounded tenant lifecycle contracts (M02-E11)", () => {
  it("rejects a scope for a different tenant", () => {
    expect(() =>
      buildExportManifest(scope(), {
        applicationId,
        tenantId: tenantB,
        surfaces: ["POSTGRES"],
        recordCounts: {},
      }),
    ).toThrow(LifecycleContractError);
  });

  it("rejects the legacy publication fallback as a tenant identity", () => {
    expect(() =>
      buildExportManifest(scope(), {
        applicationId,
        tenantId: LEGACY_PUBLICATION_FALLBACK as typeof tenantA,
        surfaces: ["POSTGRES"],
        recordCounts: {},
      }),
    ).toThrow(/pub_default/);
  });

  it("rejects unknown and duplicate surfaces", () => {
    expect(() =>
      buildExportManifest(scope(), {
        applicationId,
        tenantId: tenantA,
        surfaces: ["ARBITRARY" as "POSTGRES"],
        recordCounts: {},
      }),
    ).toThrow(/unsupported lifecycle surface/);
    expect(() =>
      buildExportManifest(scope(), {
        applicationId,
        tenantId: tenantA,
        surfaces: ["POSTGRES", "POSTGRES"],
        recordCounts: {},
      }),
    ).toThrow(/duplicate lifecycle surface/);
  });

  it("rejects negative or non-integer record counts", () => {
    expect(() =>
      buildExportManifest(scope(), {
        applicationId,
        tenantId: tenantA,
        surfaces: ["POSTGRES"],
        recordCounts: { customers: -1 },
      }),
    ).toThrow(/invalid record count/);
    expect(() =>
      buildExportManifest(scope(), {
        applicationId,
        tenantId: tenantA,
        surfaces: ["POSTGRES"],
        recordCounts: { customers: 1.5 },
      }),
    ).toThrow(/invalid record count/);
  });

  it("produces an order-independent digest", () => {
    const first = buildExportManifest(scope(), {
      applicationId,
      tenantId: tenantA,
      surfaces: ["QUEUE", "POSTGRES"],
      recordCounts: { customers: 3, deals: 2 },
    });
    const second = buildExportManifest(scope(), {
      applicationId,
      tenantId: tenantA,
      surfaces: ["POSTGRES", "QUEUE"],
      recordCounts: { deals: 2, customers: 3 },
    });
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.surfaces).toEqual(["POSTGRES", "QUEUE"]);
  });

  it("bounds retention policies", () => {
    expect(validateRetentionPolicy(retention("POSTGRES")).maxRetentionDays).toBe(30);
    expect(() => validateRetentionPolicy({ ...retention("POSTGRES"), maxRetentionDays: 3651 })).toThrow();
    expect(() => validateRetentionPolicy({ ...retention("POSTGRES"), maxRetentionDays: 1.5 })).toThrow();
  });

  it("never claims backup erasure", () => {
    expect(() =>
      buildOffboardingPlan(scope(), {
        applicationId,
        tenantId: tenantA,
        exportRequired: true,
        surfaces: ["POSTGRES", "BACKUPS"],
        retention: [retention("POSTGRES"), retention("BACKUPS")],
        backupErasureClaim: "ERASED" as "NOT_CLAIMED",
      }),
    ).toThrow(/backup erasure must never be claimed/);
  });

  it("requires export before data-bearing surfaces are offboarded", () => {
    expect(() =>
      buildOffboardingPlan(scope(), {
        applicationId,
        tenantId: tenantA,
        exportRequired: false,
        surfaces: ["OBJECT_STORAGE"],
        retention: [retention("OBJECT_STORAGE")],
      }),
    ).toThrow(/export is required/);
  });

  it("reports missing surfaces and refuses completion with BACKUPS", () => {
    const plan = buildOffboardingPlan(scope(), {
      applicationId,
      tenantId: tenantA,
      exportRequired: true,
      surfaces: ["POSTGRES", "BACKUPS"],
      retention: [retention("POSTGRES"), retention("BACKUPS")],
    });
    const partial = reconcileOffboarding(plan, ["POSTGRES"]);
    expect(partial.missingSurfaces).toEqual(["BACKUPS"]);
    expect(partial.complete).toBe(false);
    const all = reconcileOffboarding(plan, ["POSTGRES", "BACKUPS"]);
    expect(all.missingSurfaces).toEqual([]);
    expect(all.complete).toBe(false);
    expect(all.reasons.join(" ")).toMatch(/backup erasure/);
  });

  it("blocks completion while a legal hold is active", () => {
    const plan = buildOffboardingPlan(scope(), {
      applicationId,
      tenantId: tenantA,
      exportRequired: true,
      surfaces: ["QUEUE"],
      retention: [retention("QUEUE", true)],
    });
    expect(reconcileOffboarding(plan, ["QUEUE"]).complete).toBe(false);
  });

  it("completes only when every bounded surface is executed", () => {
    const plan = buildOffboardingPlan(scope(), {
      applicationId,
      tenantId: tenantA,
      exportRequired: true,
      surfaces: ["QUEUE", "SEARCH_INDEX"],
      retention: [retention("QUEUE"), retention("SEARCH_INDEX")],
    });
    expect(reconcileOffboarding(plan, ["QUEUE"]).complete).toBe(false);
    expect(reconcileOffboarding(plan, ["QUEUE", "SEARCH_INDEX"]).complete).toBe(true);
  });
});
