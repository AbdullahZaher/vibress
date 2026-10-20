/**
 * EXT-203A: operator-side catalog migration admission only.
 * Nothing here executes external SQL or becomes a public Plugin SDK method.
 * This records atomic, irreversible ownership reservations for EXT-203B.
 */
import { createHash } from "node:crypto";

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
  if (!input || typeof input !== "object" ||
      typeof input.manifestId !== "string" || !MANIFEST_ID.test(input.manifestId) ||
      typeof input.migrationId !== "string" || !MIGRATION_ID.test(input.migrationId) ||
      typeof input.packageVersion !== "string" || !input.packageVersion.trim() ||
      input.packageVersion.length > 128 ||
      typeof input.artifactSha256 !== "string" || !SHA256.test(input.artifactSha256) ||
      typeof input.migrationSha256 !== "string" || !SHA256.test(input.migrationSha256) ||
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

/**
 * EXT-203B1: operator-only declarative relational table plan.
 * This is NOT a public plugin SDK contract or general SQL executor.
 */
export interface ApprovedPluginPhysicalColumn {
  readonly name: string;
  readonly type: "text" | "integer" | "boolean" | "timestamptz";
  readonly required: boolean;
}

export interface ApprovedPluginPhysicalModel extends PluginStorageModelDeclaration {
  readonly columns: readonly ApprovedPluginPhysicalColumn[];
}

export interface ApprovedPluginPhysicalMigration
  extends Omit<ApprovedPluginCatalogMigration, "models"> {
  readonly models: readonly ApprovedPluginPhysicalModel[];
}

export interface PluginPhysicalMigrationRepository {
  applyApprovedPhysical(input: ApprovedPluginPhysicalMigration): Promise<PluginMigrationStatus>;
}

const PHYSICAL_COLUMN = /^[a-z][a-z0-9_]{0,47}$/;
const RESERVED_COLUMNS = new Set([
  "id", "publication_id", "version", "created_at", "updated_at",
]);
const COLUMN_TYPES = new Set(["text", "integer", "boolean", "timestamptz"]);

/** Stable canonical SHA-256 of the complete operator-reviewed field descriptor. */
export function pluginPhysicalModelDigest(
  columns: readonly ApprovedPluginPhysicalColumn[],
): string {
  return createHash("sha256").update(JSON.stringify(columns)).digest("hex");
}

/** Bind migration history to the ordered model and schema declarations. */
export function pluginPhysicalMigrationDigest(
  models: readonly ApprovedPluginPhysicalModel[],
): string {
  return createHash("sha256").update(JSON.stringify(models.map((model) => ({
    key: model.key, schemaSha256: model.schemaSha256,
  })))).digest("hex");
}

export function validateApprovedPhysicalMigration(
  input: ApprovedPluginPhysicalMigration,
): ApprovedPluginPhysicalMigration {
  validateApprovedPluginCatalogMigration(input);
  if (input.models.length === 0 || input.models.length > 16) {
    throw new PluginStorageMigrationError(
      "PLUGIN_MIGRATION_INVALID", "Physical migration requires 1-16 declared models",
    );
  }
  for (const model of input.models) {
    if (!Array.isArray(model.columns) ||
        model.columns.length < 1 || model.columns.length > 24) {
      throw new PluginStorageMigrationError(
        "PLUGIN_MIGRATION_INVALID", "Physical model requires 1-24 declared columns",
      );
    }
    const names = new Set<string>();
    for (const column of model.columns) {
      if (!column || typeof column.name !== "string" ||
          !PHYSICAL_COLUMN.test(column.name) || RESERVED_COLUMNS.has(column.name) ||
          names.has(column.name) || !COLUMN_TYPES.has(column.type) ||
          typeof column.required !== "boolean") {
        throw new PluginStorageMigrationError(
          "PLUGIN_MIGRATION_INVALID", "Invalid physical field definition",
        );
      }
      names.add(column.name);
    }
    if (model.schemaSha256 !== pluginPhysicalModelDigest(model.columns)) {
      throw new PluginStorageMigrationError(
        "PLUGIN_MIGRATION_CHECKSUM_CONFLICT", "Model descriptor digest mismatch",
      );
    }
  }
  if (input.migrationSha256 !== pluginPhysicalMigrationDigest(input.models)) {
    throw new PluginStorageMigrationError(
      "PLUGIN_MIGRATION_CHECKSUM_CONFLICT", "Physical migration digest mismatch",
    );
  }
  return input;
}

export class PluginPhysicalSchemaMigrationService {
  constructor(private readonly repository: PluginPhysicalMigrationRepository) {}

  /** Only invoked by operator-controlled offline deployment orchestration. */
  async applyApprovedPhysical(
    input: ApprovedPluginPhysicalMigration,
  ): Promise<PluginMigrationStatus> {
    return this.repository.applyApprovedPhysical(validateApprovedPhysicalMigration(input));
  }
}
