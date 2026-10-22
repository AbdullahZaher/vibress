import {
  getDb, members, plugins, pluginPublicationStates, pluginPhysicalModels,
  pluginMemberRecords, auditEvents,
} from "@vibress/database";
import { and, eq, gt, lt, sql, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ApprovedPluginPhysicalModel } from "../application/plugin-storage-migrations";
import { pluginPhysicalModelDigest } from "../application/plugin-storage-migrations";
import {
  PluginScopedStorageError, validateStorageFields, validateStorageModel,
  validateStorageRecordId, validateStorageVersion, validateStoragePage,
  type PluginStorageRecord, type PluginStorageFieldValue, type PluginStoragePage,
} from "../application/plugin-scoped-storage";
import type {
  MemberStorageHostScope, PluginMemberStorageRepository,
} from "../application/plugin-member-storage-session";

type MemberTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Action = "read" | "write";

function deny(code: string, message: string): never {
  throw new PluginScopedStorageError(code, message);
}

/**
 * Host-only adapter; every operation uses one PostgreSQL transaction and
 * locks the live plugin, publication enablement and authenticated member.
 * The Member principal is NEVER accepted through the record ID or fields.
 */
export class DrizzlePluginMemberStorageRepository implements PluginMemberStorageRepository {
  constructor(private readonly db: () => ReturnType<typeof getDb> = getDb) {}

  private async inScope<T>(
    scope: MemberStorageHostScope,
    model: ApprovedPluginPhysicalModel,
    action: Action,
    fn: (tx: MemberTransaction) => Promise<T>,
  ): Promise<T> {
    if (!scope || typeof scope !== "object" ||
        ![scope.pluginId, scope.publicationId, scope.memberId]
          .every((value) => typeof value === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) ||
        typeof scope.requestId !== "string" ||
        !/^[A-Za-z0-9_:-]{1,128}$/.test(scope.requestId) ||
        typeof scope.allowWrites !== "boolean") {
      return deny("PLUGIN_MEMBER_STORAGE_INVALID", "Invalid Host context");
    }
    if (action === "write" && !scope.allowWrites) {
      return deny("PLUGIN_MEMBER_STORAGE_METHOD_DENIED", "Writes require POST");
    }
    validateStorageModel(model);
    if (model.columns.some((column) =>
      ["member_id", "plugin_id", "tenant_id", "publication_id",
        "workspace_id", "user_id", "actor_user_id", "owner_id"].includes(column.name))) {
      return deny("PLUGIN_MEMBER_STORAGE_MODEL_DENIED", "Ownership field is not approved");
    }
    if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE === "1") {
      return deny("PLUGIN_MEMBER_STORAGE_DENIED", "Storage unavailable in maintenance");
    }
    return this.db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      const capability = action === "read"
        ? "extension.member_storage.read" : "extension.member_storage.write";
      const [plugin] = await tx.select({
        status: plugins.status, capabilities: plugins.capabilities,
      }).from(plugins).where(eq(plugins.id, scope.pluginId)).for("share").limit(1);
      if (!plugin || plugin.status !== "active" ||
          !Array.isArray(plugin.capabilities) || !plugin.capabilities.includes(capability)) {
        return deny("PLUGIN_MEMBER_STORAGE_DENIED", "Extension storage unavailable");
      }
      const [activation] = await tx.select({ enabled: pluginPublicationStates.enabled })
        .from(pluginPublicationStates).where(and(
          eq(pluginPublicationStates.pluginId, scope.pluginId),
          eq(pluginPublicationStates.publicationId, scope.publicationId),
          eq(pluginPublicationStates.enabled, true),
        )).for("share").limit(1);
      if (!activation?.enabled) {
        return deny("PLUGIN_MEMBER_STORAGE_DENIED", "Extension disabled for publication");
      }
      const [member] = await tx.select({ id: members.id }).from(members).where(and(
        eq(members.id, scope.memberId),
        eq(members.publicationId, scope.publicationId),
        eq(members.status, "active"),
      )).for("share").limit(1);
      if (!member) {
        return deny("PLUGIN_MEMBER_STORAGE_DENIED", "Authenticated member unavailable");
      }
      const [approved] = await tx.select({
        schemaSha256: pluginPhysicalModels.schemaSha256,
      }).from(pluginPhysicalModels).where(and(
        eq(pluginPhysicalModels.pluginId, scope.pluginId),
        eq(pluginPhysicalModels.modelKey, model.key),
      )).for("share").limit(1);
      if (!approved || approved.schemaSha256 !== model.schemaSha256 ||
          approved.schemaSha256 !== pluginPhysicalModelDigest(model.columns)) {
        return deny("PLUGIN_MEMBER_STORAGE_MODEL_DENIED", "Unapproved storage model");
      }
      return fn(tx);
    });
  }

  private record(model: ApprovedPluginPhysicalModel, row: {
    recordId: string; version: number; fields: unknown;
  }): PluginStorageRecord {
    validateStorageRecordId(row.recordId);
    validateStorageVersion(row.version);
    return { id: row.recordId, version: row.version,
      fields: validateStorageFields(model, row.fields, false) };
  }

  private ownerPrefix(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel) {
    return and(
      eq(pluginMemberRecords.pluginId, scope.pluginId),
      eq(pluginMemberRecords.publicationId, scope.publicationId),
      eq(pluginMemberRecords.memberId, scope.memberId),
      eq(pluginMemberRecords.modelKey, model.key),
    );
  }

  private owner(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel, id: string) {
    return and(this.ownerPrefix(scope, model), eq(pluginMemberRecords.recordId, id));
  }

  private async audit(tx: MemberTransaction, scope: MemberStorageHostScope,
    model: ApprovedPluginPhysicalModel, action: "create" | "update") {
    // A fresh audit identifier avoids exposing a guessable hash of Member IDs
    // or an arbitrary record ID that may itself contain personal information.
    const auditTarget = randomUUID();
    await tx.insert(auditEvents).values({
      id: randomUUID(), publicationId: scope.publicationId,
      actorUserId: null, requestId: scope.requestId,
      action: `plugin.member_storage.${action}`,
      targetType: "plugin.member_storage", targetId: auditTarget,
      metadata: { actorKind: "member", pluginId: scope.pluginId, modelKey: model.key },
    });
  }

  async get(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel,
    id: string): Promise<PluginStorageRecord | null> {
    validateStorageRecordId(id);
    return this.inScope(scope, model, "read", async (tx) => {
      const [existing] = await tx.select().from(pluginMemberRecords)
        .where(this.owner(scope, model, id)).limit(1);
      return existing ? this.record(model, existing) : null;
    });
  }

  async list(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel,
    limit: number, cursor?: string): Promise<PluginStoragePage> {
    const page = validateStoragePage(limit, cursor);
    return this.inScope(scope, model, "read", async (tx) => {
      const conditions = cursor === undefined ? this.ownerPrefix(scope, model) :
        and(this.ownerPrefix(scope, model), gt(pluginMemberRecords.recordId, cursor));
      const rows = await tx.select().from(pluginMemberRecords)
        .where(conditions).orderBy(asc(pluginMemberRecords.recordId))
        .limit(page.limit + 1);
      const records = rows.slice(0, page.limit).map((row) => this.record(model, row));
      const last = records[records.length - 1];
      return rows.length > page.limit && last
        ? { items: records, nextCursor: last.id } : { items: records };
    });
  }

  async create(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel,
    id: string, fields: Readonly<Record<string, PluginStorageFieldValue>>): Promise<PluginStorageRecord> {
    validateStorageRecordId(id);
    const safe = validateStorageFields(model, fields, false);
    return this.inScope(scope, model, "write", async (tx) => {
      const [created] = await tx.insert(pluginMemberRecords).values({
        pluginId: scope.pluginId, publicationId: scope.publicationId,
        memberId: scope.memberId, modelKey: model.key, recordId: id, fields: { ...safe },
      }).onConflictDoNothing().returning();
      if (!created) {
        return deny("PLUGIN_MEMBER_STORAGE_CONFLICT", "Record already exists");
      }
      await this.audit(tx, scope, model, "create");
      return this.record(model, created);
    });
  }

  async update(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel,
    id: string, expectedVersion: number,
    patch: Readonly<Record<string, PluginStorageFieldValue>>): Promise<PluginStorageRecord> {
    validateStorageRecordId(id);
    validateStorageVersion(expectedVersion);
    const safe = validateStorageFields(model, patch, true);
    return this.inScope(scope, model, "write", async (tx) => {
      const [updated] = await tx.update(pluginMemberRecords).set({
        fields: sql`${pluginMemberRecords.fields} || ${JSON.stringify(safe)}::jsonb`,
        version: sql`${pluginMemberRecords.version} + 1`,
        updatedAt: new Date(),
      }).where(and(this.owner(scope, model, id),
        eq(pluginMemberRecords.version, expectedVersion),
        lt(pluginMemberRecords.version, 2147483647),
      )).returning();
      if (!updated) {
        const [existing] = await tx.select({ version: pluginMemberRecords.version })
          .from(pluginMemberRecords).where(this.owner(scope, model, id)).limit(1);
        return deny(existing ? "PLUGIN_MEMBER_STORAGE_CONFLICT" : "PLUGIN_MEMBER_STORAGE_NOT_FOUND",
          existing ? "Record version conflict" : "Record not found");
      }
      const record = this.record(model, updated);
      await this.audit(tx, scope, model, "update");
      return record;
    });
  }
}
