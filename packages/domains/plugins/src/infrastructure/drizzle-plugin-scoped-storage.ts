import {
  getDb, plugins, pluginPublicationStates, pluginPhysicalModels,
} from "@vibress/database";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { ApprovedPluginPhysicalModel } from "../application/plugin-storage-migrations";
import {
  PluginScopedStorageError,
  validateStorageFields,
  validateStorageModel,
  validateStoragePage,
  validateStorageRecordId,
  validateStorageVersion,
  type HostBoundPluginStorageScope,
  type PluginScopedStorageRepository,
  type PluginStorageAction,
  type PluginStorageFieldValue,
  type PluginStoragePage,
  type PluginStorageRecord,
} from "../application/plugin-scoped-storage";
import { pluginPhysicalModelDigest } from "../application/plugin-storage-migrations";

type Row = Record<string, unknown>;
type Execute = (query: SQL) => Promise<readonly Row[]>;

function problem(code: string, message: string): never {
  throw new PluginScopedStorageError(code, message);
}
/** Physical names are recomputed, never trusted from caller/model key. */
function expectedName(manifestId: string, key: string): string {
  return "ext_" + createHash("sha256").update(manifestId + ":" + key)
    .digest("hex").slice(0, 40);
}
function projection(model: ApprovedPluginPhysicalModel): SQL {
  return sql.join([
    sql.identifier("id"), sql.identifier("version"),
    ...model.columns.map((column) => sql.identifier(column.name)),
  ], sql`, `);
}
function record(row: Row, model: ApprovedPluginPhysicalModel): PluginStorageRecord {
  if (typeof row.id !== "string" || typeof row.version !== "number" ||
      !Number.isInteger(row.version)) {
    return problem("PLUGIN_STORAGE_SCHEMA_DRIFT", "Storage record projection is invalid");
  }
  const fields: Record<string, PluginStorageFieldValue> = {};
  for (const column of model.columns) {
    const raw = row[column.name];
    // Raw Drizzle SQL returns PostgreSQL timestamptz as either a Date
    // or a database-formatted string. Normalize before exposing the API.
    let value: unknown = raw instanceof Date ? raw.toISOString() : raw;
    if (column.type === "timestamptz" && typeof value === "string") {
      const timestamp = new Date(value);
      if (!Number.isFinite(timestamp.getTime())) {
        return problem("PLUGIN_STORAGE_SCHEMA_DRIFT", "Invalid timestamp stored in model");
      }
      value = timestamp.toISOString();
    }
    if (value === null && !column.required) {
      fields[column.name] = null;
    } else if (
      (column.type === "text" || column.type === "timestamptz") && typeof value === "string" ||
      column.type === "boolean" && typeof value === "boolean" ||
      column.type === "integer" && typeof value === "number" && Number.isInteger(value)
    ) {
      fields[column.name] = value as PluginStorageFieldValue;
    } else {
      return problem("PLUGIN_STORAGE_SCHEMA_DRIFT", "Storage record field is invalid");
    }
  }
  return { id: row.id, version: row.version, fields };
}
function sqlColumns(fields: Readonly<Record<string, PluginStorageFieldValue>>): {
  names: SQL[]; values: SQL[]; assignments: SQL[];
} {
  const entries = Object.entries(fields);
  return {
    names: entries.map(([name]) => sql`${sql.identifier(name)}`),
    values: entries.map(([, value]) => sql`${value}`),
    assignments: entries.map(([name, value]) => sql`${sql.identifier(name)} = ${value}`),
  };
}

/**
 * Only the trusted host constructs/uses this repository with its authoritative
 * plugin+publication binding and a pinned operator-approved descriptor.
 * Every invocation re-checks active state, declared capability, enablement,
 * immutable model owner/digest, and locks lifecycle state through COMMIT.
 * No raw connection is returned to any extension.
 */
export class DrizzlePluginScopedStorageRepository implements PluginScopedStorageRepository {
  constructor(private readonly db: () => ReturnType<typeof getDb> = getDb) {}

  private async run<T>(
    scope: HostBoundPluginStorageScope,
    model: ApprovedPluginPhysicalModel,
    action: PluginStorageAction,
    fn: (table: SQL, execute: Execute) => Promise<T>,
    auditMutation?: { readonly operation: "create" | "update"; readonly recordId: string },
  ): Promise<T> {
    // Defense in depth: adapters are exported for internal callers, so service
    // validation is never sufficient authorization or input sanitation.
    if (!scope || typeof scope !== "object") {
      return problem("PLUGIN_STORAGE_INVALID", "Missing host storage binding");
    }
    validateStorageRecordId(scope.pluginId);
    validateStorageRecordId(scope.publicationId);
    if (scope.audit) {
      if (!scope.audit.actorUserId || typeof scope.audit.actorUserId !== "string" ||
          scope.audit.actorUserId.length > 128 ||
          !scope.audit.requestId || typeof scope.audit.requestId !== "string" ||
          scope.audit.requestId.length > 128) {
        return problem("PLUGIN_STORAGE_INVALID", "Invalid Host audit context");
      }
    }
    validateStorageModel(model);
    if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE === "1") {
      return problem("PLUGIN_STORAGE_DISABLED", "Storage unavailable during recovery");
    }
    return this.db().transaction(async (tx) => {
      const [plugin] = await tx.select({
        id: plugins.id,
        manifestId: plugins.manifestId,
        capabilities: plugins.capabilities,
        status: plugins.status,
      }).from(plugins).where(eq(plugins.id, scope.pluginId)).for("share").limit(1);
      if (!plugin || plugin.status !== "active") {
        return problem("PLUGIN_STORAGE_DENIED", "Plugin is not active");
      }
      const capability = action === "read" ? "extension.storage.read" : "extension.storage.write";
      if (!Array.isArray(plugin.capabilities) || !plugin.capabilities.includes(capability)) {
        return problem("PLUGIN_STORAGE_DENIED", "Plugin storage capability is not approved");
      }
      const [publication] = await tx.select({
        enabled: pluginPublicationStates.enabled,
      }).from(pluginPublicationStates).where(and(
        eq(pluginPublicationStates.pluginId, scope.pluginId),
        eq(pluginPublicationStates.publicationId, scope.publicationId),
        eq(pluginPublicationStates.enabled, true),
      )).for("share").limit(1);
      if (!publication?.enabled) {
        return problem("PLUGIN_STORAGE_DENIED", "Plugin disabled for this publication");
      }
      const [owned] = await tx.select({
        tableName: pluginPhysicalModels.tableName,
        schemaSha256: pluginPhysicalModels.schemaSha256,
      }).from(pluginPhysicalModels).where(and(
        eq(pluginPhysicalModels.pluginId, scope.pluginId),
        eq(pluginPhysicalModels.modelKey, model.key),
      )).limit(1);
      const tableName = expectedName(plugin.manifestId, model.key);
      if (!owned || owned.tableName !== tableName ||
          owned.schemaSha256 !== model.schemaSha256 ||
          model.schemaSha256 !== pluginPhysicalModelDigest(model.columns)) {
        return problem("PLUGIN_STORAGE_MODEL_DENIED", "Unapproved or incompatible physical model");
      }
      const execute: Execute = async (query) => (await tx.execute(query)).rows;
      // Bind the physical model to the same real PostgreSQL namespace as
      // the owner catalog. A same-named relation earlier on search_path must
      // NEVER shadow an operator-created plugin table.
      const [physical] = await execute(sql`
        SELECT ns.nspname AS schema_name, physical_table.oid AS physical_oid
        FROM pg_class owner_catalog
        JOIN pg_namespace ns ON ns.oid = owner_catalog.relnamespace
        JOIN pg_class physical_table ON physical_table.relnamespace = ns.oid
          AND physical_table.relname = ${tableName}
          AND physical_table.relkind = 'r'
        WHERE owner_catalog.oid = to_regclass('plugin_storage_physical_models')
          AND owner_catalog.relkind = 'r'
      `);
      if (!physical || typeof physical.schema_name !== "string") {
        return problem("PLUGIN_STORAGE_MODEL_DENIED", "Physical model table is missing or shadowed");
      }
      const physicalTable = sql`${sql.identifier(physical.schema_name)}.${sql.identifier(tableName)}`;
      // Hold a physical table lock so out-of-band ALTER/DROP cannot race
      // catalog attestation and the data operation in this transaction.
      await execute(sql`LOCK TABLE ${physicalTable} IN ACCESS SHARE MODE`);
      const oidValue = physical.physical_oid;
      // PostgreSQL drivers can return oid either as int4 or decimal text.
      const oid = typeof oidValue === "number" ? oidValue :
        typeof oidValue === "string" && /^[0-9]{1,10}$/.test(oidValue)
          ? Number(oidValue) : NaN;
      if (!Number.isSafeInteger(oid) || oid < 1 || oid > 4294967295) {
        return problem("PLUGIN_STORAGE_SCHEMA_DRIFT", "Invalid physical table identity");
      }
      const columns = await execute(sql`
        SELECT attr.attname AS column_name, typ.typname AS column_type,
          attr.attnotnull AS required
        FROM pg_attribute attr
        JOIN pg_type typ ON typ.oid = attr.atttypid
        WHERE attr.attrelid = ${oid}::oid
          AND attr.attnum > 0 AND NOT attr.attisdropped
      `);
      const expected: Record<string, { type: string; required: boolean }> = {
        publication_id: { type: "text", required: true },
        id: { type: "text", required: true },
        version: { type: "int4", required: true },
        created_at: { type: "timestamptz", required: true },
        updated_at: { type: "timestamptz", required: true },
      };
      const pgType = {
        text: "text", integer: "int4", boolean: "bool",
        timestamptz: "timestamptz",
      } as const;
      for (const column of model.columns) {
        expected[column.name] = {
          type: pgType[column.type], required: column.required,
        };
      }
      if (columns.length !== Object.keys(expected).length ||
          columns.some((column) => {
            const spec = typeof column.column_name === "string"
              ? expected[column.column_name] : undefined;
            return !spec || column.column_type !== spec.type ||
              column.required !== spec.required;
          })) {
        return problem("PLUGIN_STORAGE_SCHEMA_DRIFT", "Physical model columns differ from approval");
      }
      const [constraints] = await execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_constraint con
            WHERE con.conrelid = ${oid}::oid AND con.contype = 'p'
              AND (
                SELECT array_agg(att.attname::text ORDER BY keys.ordinality)
                FROM unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
                JOIN pg_attribute att ON att.attrelid = ${oid}::oid
                  AND att.attnum = keys.attnum
              ) = ARRAY['publication_id','id']::text[]
          ) AS valid_pk,
          EXISTS (
            SELECT 1 FROM pg_constraint con
            JOIN pg_class parent ON parent.oid = con.confrelid
            JOIN pg_class physical ON physical.oid = ${oid}::oid
            JOIN pg_attribute src ON src.attrelid = physical.oid
              AND src.attname = 'publication_id'
            JOIN pg_attribute target ON target.attrelid = parent.oid
              AND target.attname = 'id'
            WHERE con.conrelid = ${oid}::oid AND con.contype = 'f'
              AND con.confdeltype = 'c'
              AND parent.relname = 'publications'
              AND parent.relnamespace = physical.relnamespace
              AND con.conkey = ARRAY[src.attnum]::smallint[]
              AND con.confkey = ARRAY[target.attnum]::smallint[]
          ) AS valid_pub_fk
      `);
      if (constraints?.valid_pk !== true || constraints.valid_pub_fk !== true) {
        return problem("PLUGIN_STORAGE_SCHEMA_DRIFT", "Physical model isolation constraints differ from approval");
      }
      const result = await fn(physicalTable, execute);
      if (auditMutation && scope.audit) {
        // The mutation and its actor-bound audit entry commit or roll back
        // together. Never log model field values or user-provided payloads.
        // Keep the audit table in the exact namespace admitted by the
        // operator, never an earlier same-named search_path relation.
        const [logged] = await execute(sql`
          INSERT INTO ${sql.identifier(physical.schema_name)}."audit_events"
            ("id", "publication_id", "actor_user_id", "request_id",
              "action", "target_type", "target_id", "metadata")
          VALUES (
            ${randomUUID()}, ${scope.publicationId}, ${scope.audit.actorUserId},
            ${scope.audit.requestId}, ${`plugin.storage.${auditMutation.operation}`},
            'plugin.storage', ${auditMutation.recordId},
            ${JSON.stringify({ pluginId: scope.pluginId, modelKey: model.key })}::jsonb
          )
          RETURNING "id"
        `);
        if (!logged) {
          return problem("PLUGIN_STORAGE_UNAVAILABLE", "Storage audit write returned no record");
        }
      }
      return result;
    });
  }
  async get(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    id: string): Promise<PluginStorageRecord | null> {
    validateStorageRecordId(id);
    return this.run(scope, model, "read", async (table, execute) => {
      const [row] = await execute(sql`SELECT ${projection(model)}
        FROM ${table}
        WHERE "publication_id" = ${scope.publicationId} AND "id" = ${id} LIMIT 1`);
      return row ? record(row, model) : null;
    });
  }
  async list(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    limit: number, cursor?: string): Promise<PluginStoragePage> {
    validateStoragePage(limit, cursor);
    return this.run(scope, model, "read", async (table, execute) => {
      const cursorClause = cursor === undefined ? sql`` : sql`AND "id" > ${cursor}`;
      const rows = await execute(sql`SELECT ${projection(model)}
        FROM ${table}
        WHERE "publication_id" = ${scope.publicationId} ${cursorClause}
        ORDER BY "id" ASC LIMIT ${limit + 1}`);
      const more = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => record(row, model));
      const last = items[items.length - 1];
      return more && last ? { items, nextCursor: last.id } : { items };
    });
  }
  async create(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    id: string, fields: Readonly<Record<string, PluginStorageFieldValue>>):
    Promise<PluginStorageRecord> {
    validateStorageRecordId(id);
    validateStorageModel(model);
    const safeFields = validateStorageFields(model, fields, false);
    return this.run(scope, model, "write", async (table, execute) => {
      const columns = sqlColumns(safeFields);
      try {
        const [row] = await execute(sql`INSERT INTO ${table}
          (${sql.join([sql.identifier("publication_id"), sql.identifier("id"), ...columns.names], sql`, `)})
          VALUES (${sql.join([sql`${scope.publicationId}`, sql`${id}`, ...columns.values], sql`, `)})
          RETURNING ${projection(model)}`);
        if (!row) return problem("PLUGIN_STORAGE_UNAVAILABLE", "Insert returned no record");
        return record(row, model);
      } catch (error: unknown) {
        const cause = error instanceof Error && "cause" in error ? error.cause : error;
        if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
          return problem("PLUGIN_STORAGE_CONFLICT", "Record already exists");
        }
        throw error;
      }
    }, { operation: "create", recordId: id });
  }
  async update(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    id: string, expectedVersion: number,
    fields: Readonly<Record<string, PluginStorageFieldValue>>): Promise<PluginStorageRecord> {
    validateStorageRecordId(id);
    validateStorageVersion(expectedVersion);
    validateStorageModel(model);
    const safeFields = validateStorageFields(model, fields, true);
    return this.run(scope, model, "write", async (table, execute) => {
      const assignments = sqlColumns(safeFields).assignments;
      const [row] = await execute(sql`UPDATE ${table}
        SET ${sql.join([...assignments, sql`"version" = "version" + 1`,
          sql`"updated_at" = now()`], sql`, `)}
        WHERE "publication_id" = ${scope.publicationId}
          AND "id" = ${id} AND "version" = ${expectedVersion}
          AND "version" < 2147483647
        RETURNING ${projection(model)}`);
      if (row) return record(row, model);
      const [existing] = await execute(sql`SELECT "version" FROM ${table}
        WHERE "publication_id" = ${scope.publicationId} AND "id" = ${id} LIMIT 1`);
      return problem(existing ? "PLUGIN_STORAGE_CONFLICT" : "PLUGIN_STORAGE_NOT_FOUND",
        existing ? "Record was changed or version limit reached" : "Record not found");
    }, { operation: "update", recordId: id });
  }
}
