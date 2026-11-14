import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import { PolicyDeniedError, PolicyEngine, hasPermission } from "../policy";

const principal: VerifiedPrincipal = {
  id: asPrincipalId("principal-1"),
  kind: "staff",
  applicationId: asApplicationId("customer-crm"),
  tenantIds: [asTenantId("tenant-a")],
  roles: ["sales"],
  permissions: ["customers.read", "deals.*"],
};

describe("default-deny policy engine", () => {
  it("denies without a verified principal", () => {
    const engine = new PolicyEngine([{ id: "allow-all", action: "*", effect: "allow" }]);
    expect(engine.decide({ principal: null, action: "customers.read" }).effect).toBe(
      "deny",
    );
  });

  it("denies an action without a matching allow rule", () => {
    const engine = new PolicyEngine([]);
    expect(engine.decide({ principal, action: "customers.read" }).effect).toBe(
      "deny",
    );
  });

  it("allows a permitted action through a namespace wildcard", () => {
    const engine = new PolicyEngine([
      { id: "allow-deals", action: "deals.*", effect: "allow" },
    ]);
    const decision = engine.decide({ principal, action: "deals.approve" });
    expect(decision.effect).toBe("allow");
    expect(decision.matchedRuleId).toBe("allow-deals");
  });

  it("requires an explicit permission grant even when a rule allows", () => {
    const engine = new PolicyEngine([
      { id: "allow-all", action: "*", effect: "allow" },
    ]);
    expect(
      engine.decide({ principal, action: "billing.refund" }).effect,
    ).toBe("deny");
  });

  it("gives explicit deny precedence over allow", () => {
    const engine = new PolicyEngine([
      { id: "allow-all", action: "*", effect: "allow" },
      { id: "deny-refunds", action: "billing.*", effect: "deny" },
    ]);
    const restricted: VerifiedPrincipal = {
      ...principal,
      permissions: ["billing.refund"],
    };
    const decision = engine.decide({
      principal: restricted,
      action: "billing.refund",
    });
    expect(decision.effect).toBe("deny");
    expect(decision.matchedRuleId).toBe("deny-refunds");
  });

  it("denies a resource owned by a different tenant", () => {
    const engine = new PolicyEngine([
      { id: "allow-all", action: "*", effect: "allow" },
    ]);
    const decision = engine.decide({
      principal,
      action: "customers.read",
      scopeTenantId: "tenant-a",
      resourceTenantId: "tenant-b",
    });
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toMatch(/different tenant/);
  });

  it("throws a typed error from assertAllowed", () => {
    const engine = new PolicyEngine([]);
    expect(() =>
      engine.assertAllowed({ principal, action: "customers.read" }),
    ).toThrow(PolicyDeniedError);
  });

  it("rejects duplicate or malformed rules at construction", () => {
    expect(
      () =>
        new PolicyEngine([
          { id: "a", action: "deals.*", effect: "allow" },
          { id: "a", action: "deals.*", effect: "deny" },
        ]),
    ).toThrow(/duplicate/);
    expect(
      () =>
        new PolicyEngine([
          { id: "bad", action: "deals approve", effect: "allow" },
        ]),
    ).toThrow(/invalid action pattern/);
  });
});

describe("hasPermission", () => {
  it("supports exact, namespace and global grants", () => {
    expect(hasPermission(["deals.approve"], "deals.approve")).toBe(true);
    expect(hasPermission(["deals.*"], "deals.approve")).toBe(true);
    expect(hasPermission(["*"], "anything.read")).toBe(true);
    expect(hasPermission(["deals.read"], "deals.approve")).toBe(false);
  });
});
