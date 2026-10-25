/**
 * Experimental NUI-03 declarations. Only the Host may resolve an operator-
 * approved storage model or authorize an operation against it.
 * These inert descriptors do not expose plugin handlers or SQL.
 */
export interface PluginAdminDataResourceV1 {
  readonly id: string;
  readonly modelKey: string;
  /** Explicit projection: no wildcard, and no undeclared storage fields. */
  readonly fields: readonly string[];
  /** Optional operator-indexed text equality filters only. */
  readonly textFilters?: readonly string[] | undefined;
}

export interface PluginAdminDataActionV1 {
  readonly id: string;
  readonly resourceId: string;
  readonly operation: "create" | "update";
}
