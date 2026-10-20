import {
  getDb,
  plugins,
  pluginSchemaMigrations,
  pluginStorageModels,
  pluginPhysicalModels,
} from "@vibress/database";
import { eq, and, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  ApprovedPluginCatalogMigration,
  PluginMigrationStatus,
  PluginStorageMigrationRepository,
  PluginPhysicalMigrationRepository,
  ApprovedPluginPhysicalMigration,
  ApprovedPluginPhysicalModel,
} from "../application/plugin-storage-migrations";
import { PluginStorageMigrationError } from "../application/plugin-storage-migrations";

/**
 * Operator-side ledger writer. Serializes by manifest across replicas,
 * locks the plugin row against activation and commits ledger + model
 * reservations atomically. External modules NEVER receive this transaction.
 */
const FIELD_TYPES: Readonly<Record<ApprovedPluginPhysicalModel["columns"][number]["type"], string>> = {
  text: "text", integer: "integer", boolean: "boolean", timestamptz: "timestamptz",
};

/** Deterministic bounded physical identifier, never raw plugin input. */
function physicalName(manifestId: string, modelKey: string): string {
  const digest = createHash("sha256").update(manifestId + ":" + modelKey).digest("hex");
  return "ext_" + digest.slice(0, 40);
}

export class DrizzlePluginStorageMigrationRepository
  implements PluginStorageMigrationRepository, PluginPhysicalMigrationRepository {
  constructor(private readonly db: () => ReturnType<typeof getDb> = getDb) {}

  async applyApproved(input: ApprovedPluginCatalogMigration): Promise<PluginMigrationStatus> {
    return this.apply(input);
  }

  async applyApprovedPhysical(input: ApprovedPluginPhysicalMigration): Promise<PluginMigrationStatus> {
    return this.apply(input, input.models);
  }

  private async apply(
    input: ApprovedPluginCatalogMigration,
    physical?: readonly ApprovedPluginPhysicalModel[],
  ): Promise<PluginMigrationStatus> {
    return this.db().transaction(async (tx) => {
      // Transaction-scoped PostgreSQL advisory lock is released on COMMIT/ROLLBACK.
      // A stable first key separates this from core/other extension locks.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtext('vibress_plugin_catalog_migration'), hashtext(${input.manifestId})
      )`);

      const [plugin] = await tx.select({
        id: plugins.id,
        status: plugins.status,
        version: plugins.version,
      }).from(plugins).where(eq(plugins.manifestId, input.manifestId))
        .for("update").limit(1);

      if (!plugin) {
        throw new PluginStorageMigrationError(
          "PLUGIN_MIGRATION_NOT_INSTALLED", "Plugin must be installed before recording migrations",
        );
      }
      if (plugin.status !== "registered" && plugin.status !== "inactive") {
        throw new PluginStorageMigrationError(
          "PLUGIN_MIGRATION_LIFECYCLE",
          "Stop and deactivate the plugin before recording a schema migration",
        );
      }

      const [prior] = await tx.select().from(pluginSchemaMigrations)
        .where(and(
          eq(pluginSchemaMigrations.pluginId, plugin.id),
          eq(pluginSchemaMigrations.migrationId, input.migrationId),
        )).limit(1);

      if (prior) {
        if (prior.artifactSha256 !== input.artifactSha256 ||
            prior.migrationSha256 !== input.migrationSha256 ||
            prior.packageVersion !== input.packageVersion) {
          throw new PluginStorageMigrationError(
            "PLUGIN_MIGRATION_CHECKSUM_CONFLICT", "An immutable migration was changed",
          );
        }
        const models = await tx.select().from(pluginStorageModels)
          .where(and(
            eq(pluginStorageModels.pluginId, plugin.id),
            eq(pluginStorageModels.migrationId, input.migrationId),
          ));
        const matched = models.length === input.models.length &&
          models.every((model) =>
            input.models.some((candidate) =>
              candidate.key === model.modelKey &&
              candidate.schemaSha256 === model.schemaSha256));
        if (!matched) {
          throw new PluginStorageMigrationError(
            "PLUGIN_MIGRATION_CHECKSUM_CONFLICT", "Applied model descriptor differs",
          );
        }
        if (physical) {
          // Refuse an old catalog-only entry; never silently "repair" it.
          for (const model of physical) {
            const expectedTable = physicalName(input.manifestId, model.key);
            const rows = await tx.select().from(pluginPhysicalModels).where(and(
              eq(pluginPhysicalModels.pluginId, plugin.id),
              eq(pluginPhysicalModels.modelKey, model.key),
            ));
            if (rows.length !== 1 || rows[0]!.tableName !== expectedTable ||
                rows[0]!.schemaSha256 !== model.schemaSha256) {
              throw new PluginStorageMigrationError(
                "PLUGIN_PHYSICAL_SCHEMA_MISSING", "Physical model registration differs",
              );
            }
            const present = await tx.execute(sql`SELECT to_regclass(${expectedTable}) IS NOT NULL AS present`);
            if (present.rows[0]?.present !== true) {
              throw new PluginStorageMigrationError(
                "PLUGIN_PHYSICAL_SCHEMA_MISSING", "Physical model table is missing",
              );
            }
          }
        }
        return "already_applied";
      }

      // An approved new migration must belong to the installed release.
      // Historical exact replays above remain valid after a version upgrade.
      if (plugin.version !== input.packageVersion) {
        throw new PluginStorageMigrationError(
          "PLUGIN_MIGRATION_VERSION_MISMATCH",
          "Migration package version does not match the installed plugin",
        );
      }

      const [latest] = await tx.select({
        migrationId: pluginSchemaMigrations.migrationId,
      }).from(pluginSchemaMigrations)
        .where(eq(pluginSchemaMigrations.pluginId, plugin.id))
        .orderBy(desc(pluginSchemaMigrations.migrationId)).limit(1);
      if (latest && input.migrationId <= latest.migrationId) {
        throw new PluginStorageMigrationError(
          "PLUGIN_MIGRATION_OUT_OF_ORDER", "Migrations must be forward-only",
        );
      }

      await tx.insert(pluginSchemaMigrations).values({
        pluginId: plugin.id,
        migrationId: input.migrationId,
        packageVersion: input.packageVersion,
        artifactSha256: input.artifactSha256,
        migrationSha256: input.migrationSha256,
      });
      for (const model of input.models) {
        const [existing] = await tx.select({
          key: pluginStorageModels.modelKey,
        }).from(pluginStorageModels).where(and(
          eq(pluginStorageModels.pluginId, plugin.id),
          eq(pluginStorageModels.modelKey, model.key),
        )).limit(1);
        if (existing) {
          throw new PluginStorageMigrationError(
            "PLUGIN_MIGRATION_MODEL_COLLISION",
            "Plugin model key is already owned by another migration",
          );
        }
        await tx.insert(pluginStorageModels).values({
          pluginId: plugin.id,
          modelKey: model.key,
          migrationId: input.migrationId,
          schemaSha256: model.schemaSha256,
        });
      }
      // All DDL and ledger writes share one transaction. Later CREATE TABLE
      // failure rolls back any earlier tables, reservations and the ledger.
      if (physical) {
        for (const model of physical) {
          const tableName = physicalName(input.manifestId, model.key);
          const columnFragments = [
            sql`"publication_id" text NOT NULL REFERENCES "publications" ("id") ON DELETE CASCADE`,
            sql`"id" text NOT NULL`,
            sql`"version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0)`,
            sql`"created_at" timestamptz NOT NULL DEFAULT now()`,
            sql`"updated_at" timestamptz NOT NULL DEFAULT now()`,
            ...model.columns.map((column) =>
              sql`${sql.identifier(column.name)} ${sql.raw(FIELD_TYPES[column.type])} ${
                column.required ? sql.raw("NOT NULL") : sql.raw("")
              }`),
            sql`PRIMARY KEY ("publication_id", "id")`,
          ];
          // No IF NOT EXISTS: an unregistered table collision fails closed.
          await tx.execute(sql`CREATE TABLE ${sql.identifier(tableName)} (${
            sql.join(columnFragments, sql`, `)
          })`);
          await tx.insert(pluginPhysicalModels).values({
            pluginId: plugin.id,
            modelKey: model.key,
            tableName,
            schemaSha256: model.schemaSha256,
          });
        }
      }
      return "applied";
    });
  }
}
