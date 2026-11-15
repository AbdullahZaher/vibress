/**
 * Deployment topology gate for the Wave 1 release posture (F-012).
 *
 * CMS publication isolation is still enforced in application code: no CMS table
 * has row-level security. Until F-012 option A (CMS RLS) is accepted and
 * implemented, only a single-installation deployment without external tenant
 * onboarding is supported. This guard fails closed at boot instead of letting a
 * configuration enable a topology whose isolation has not been proven.
 */
export type SupportedTopology = "single-installation";

export class UnsupportedTopologyError extends Error {
  readonly code = "unsupported_topology";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTopologyError";
  }
}

function enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function assertSupportedTopology(
  env: Record<string, string | undefined>,
): SupportedTopology {
  const topology = (
    env.PLATFORM_TOPOLOGY?.trim() || "single-installation"
  ).toLowerCase();
  if (topology !== "single-installation") {
    throw new UnsupportedTopologyError(
      `PLATFORM_TOPOLOGY '${topology}' is not supported: CMS publication isolation is application-level and F-012 option A (CMS row-level security) has not been accepted or implemented`,
    );
  }
  if (enabled(env.PLATFORM_EXTERNAL_TENANT_ONBOARDING)) {
    throw new UnsupportedTopologyError(
      "PLATFORM_EXTERNAL_TENANT_ONBOARDING is not supported: external tenant onboarding requires F-012 option A (CMS row-level security) first",
    );
  }
  return topology;
}
