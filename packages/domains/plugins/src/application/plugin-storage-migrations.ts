/**
 * EXT-203A: operator-side catalog migration admission only.
 * Nothing here executes external SQL or becomes a public Plugin SDK method.
 * This records atomic, irreversible ownership reservations for EXT-203B.
 */
export type PluginMigrationStatus = "applied" | "already_applied";

export interface PluginStorageModelDeclaration {
  readonly key: string;
  /** SHA-256 of the operator-reviewed model descriptor, not raw SQL. */
  readonly schemaSha256: string;
}

export interface ApprovedPluginCatalogMigration {
  /** Exact installed manifest ID, not a caller-supplied publication ID. */
  readonly manifestId: string;
  readonly migrationId: string;
  readonly packageVersion: string;
  readonly artifactSha256: string;
  readonly migrationSha256: string;
  readonly models: readonly PluginStorageModelDeclaration[];
}

export interface PluginStorageMigrationRepository {
  /** Runs under a DB transaction, with an exclusive per-plugin advisory lock. */
  applyApproved(input: ApprovedPluginCatalogMigration): Promise<PluginMigrationStatus>;
}

export class PluginStorageMigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PluginStorageMigrationError";
  }
}

const MIGRATION_ID = /^[0-9]{4}_[a-z][a-z0-9_]{0,63}$/;
const MANIFEST_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const MODEL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function validateApprovedPluginCatalogMigration(
  input: ApprovedPluginCatalogMigration,
): ApprovedPluginCatalogMigration {
  if (!MANIFEST_ID.test(input.manifestId) ||
      !MIGRATION_ID.test(input.migrationId) ||
      !input.packageVersion || input.packageVersion.length > 128 ||
      !SHA256.test(input.artifactSha256) || !SHA256.test(input.migrationSha256) ||
      !Array.isArray(input.models) || input.models.length > 32) {
    throw new PluginStorageMigrationError(
      "PLUGIN_MIGRATION_INVALID", "Invalid operator-reviewed migration descriptor",
    );
  }
  const keys = new Set<string>();
  for (const model of input.models) {
    if (!model || typeof model.key !== "string" ||
        !MODEL_KEY.test(model.key) || !SHA256.test(model.schemaSha256) ||
        keys.has(model.key)) {
      throw new PluginStorageMigrationError(
        "PLUGIN_MIGRATION_INVALID", "Invalid or repeated storage model declaration",
      );
    }
    keys.add(model.key);
  }
  return input;
}

/**
 * Only the trusted operator deployment orchestration is allowed to construct
 * and invoke this service with verified declarations. There is deliberately
 * no Admin, Member, public, worker, or plugin-SDK access to this method.
 */
export class PluginStorageMigrationService {
  constructor(private readonly repository: PluginStorageMigrationRepository) {}

  async registerApprovedCatalog(
    input: ApprovedPluginCatalogMigration,
  ): Promise<PluginMigrationStatus> {
    return this.repository.applyApproved(validateApprovedPluginCatalogMigration(input));
  }
}
