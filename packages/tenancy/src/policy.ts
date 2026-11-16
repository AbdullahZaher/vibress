import type {
  PolicyDecision,
  VerifiedPrincipal,
} from "@vibress/platform-kernel";

export type PolicyRuleEffect = "allow" | "deny";

export interface PolicyRule {
  readonly id: string;
  /**
   * Exact action (`deals.approve`), namespace wildcard (`deals.*`) or `*`.
   */
  readonly action: string;
  readonly effect: PolicyRuleEffect;
}

export interface PolicyRequest {
  readonly principal: VerifiedPrincipal | null;
  readonly action: string;
  readonly resourceTenantId?: string | undefined;
  readonly scopeTenantId?: string | undefined;
}

export class InvalidPolicyRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPolicyRuleError";
  }
}

const ACTION_PATTERN = /^(?:\*|[a-z][a-z0-9]*(?:\.(?:[a-z0-9]+|\*))+)$/;

function validateRule(rule: PolicyRule): PolicyRule {
  if (!rule.id || rule.id.trim() === "") {
    throw new InvalidPolicyRuleError("policy rule id must not be empty");
  }
  if (!ACTION_PATTERN.test(rule.action)) {
    throw new InvalidPolicyRuleError(
      `policy rule ${rule.id} has an invalid action pattern`,
    );
  }
  if (rule.effect !== "allow" && rule.effect !== "deny") {
    throw new InvalidPolicyRuleError(
      `policy rule ${rule.id} has an invalid effect`,
    );
  }
  return Object.freeze({ ...rule });
}

function matchesAction(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1);
    return action.startsWith(prefix);
  }
  return pattern === action;
}

export function hasPermission(
  permissions: readonly string[],
  action: string,
): boolean {
  return permissions.some((permission) => matchesAction(permission, action));
}

/**
 * Default-deny policy evaluation. An explicit deny wins over any allow, an
 * allow also requires the principal's verified permission grant, and a
 * resource in another tenant is denied regardless of policy rules.
 */
export class PolicyEngine {
  readonly #rules: readonly PolicyRule[];

  constructor(rules: readonly PolicyRule[] = []) {
    const seen = new Set<string>();
    const validated: PolicyRule[] = [];
    for (const rule of rules) {
      const next = validateRule(rule);
      if (seen.has(next.id)) {
        throw new InvalidPolicyRuleError(`duplicate policy rule id ${next.id}`);
      }
      seen.add(next.id);
      validated.push(next);
    }
    this.#rules = Object.freeze(validated);
  }

  decide(request: PolicyRequest): PolicyDecision {
    if (!request.principal) {
      return { effect: "deny", reason: "no verified principal" };
    }
    if (
      request.resourceTenantId !== undefined &&
      request.scopeTenantId !== undefined &&
      request.resourceTenantId !== request.scopeTenantId
    ) {
      return {
        effect: "deny",
        reason: "resource belongs to a different tenant than the verified scope",
      };
    }

    for (const rule of this.#rules) {
      if (
        rule.effect === "deny" &&
        matchesAction(rule.action, request.action)
      ) {
        return {
          effect: "deny",
          reason: `denied by policy rule ${rule.id}`,
          matchedRuleId: rule.id,
        };
      }
    }

    if (!hasPermission(request.principal.permissions, request.action)) {
      return {
        effect: "deny",
        reason: `principal lacks permission ${request.action}`,
      };
    }

    for (const rule of this.#rules) {
      if (
        rule.effect === "allow" &&
        matchesAction(rule.action, request.action)
      ) {
        return {
          effect: "allow",
          reason: `allowed by policy rule ${rule.id}`,
          matchedRuleId: rule.id,
        };
      }
    }

    return { effect: "deny", reason: "no matching allow rule (default deny)" };
  }

  assertAllowed(request: PolicyRequest): void {
    const decision = this.decide(request);
    if (decision.effect !== "allow") {
      throw new PolicyDeniedError(request.action, decision);
    }
  }

  get rules(): readonly PolicyRule[] {
    return this.#rules;
  }
}

export class PolicyDeniedError extends Error {
  readonly action: string;
  readonly decision: PolicyDecision;

  constructor(action: string, decision: PolicyDecision) {
    super(`Policy denied ${action}: ${decision.reason}`);
    this.name = "PolicyDeniedError";
    this.action = action;
    this.decision = decision;
  }
}
