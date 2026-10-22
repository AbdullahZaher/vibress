import type { PluginMemberStorageApi } from "@vibress/plugin-sdk";
import type { ApprovedPluginPhysicalModel } from "./plugin-storage-migrations";
import {
  PluginScopedStorageError, validateStorageFields, validateStorageModel,
  validateStorageRecordId, validateStorageVersion, validateStoragePage,
  type PluginStorageRecord, type PluginStorageFieldValue, type PluginStoragePage,
} from "./plugin-scoped-storage";
import { DrizzlePluginMemberStorageRepository } from "../infrastructure/drizzle-plugin-member-storage";

export interface MemberStorageHostScope {
  readonly pluginId: string;
  readonly publicationId: string;
  readonly memberId: string;
  readonly requestId: string;
  readonly allowWrites: boolean;
}

export interface PluginMemberStorageRepository {
  get(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel, id: string):
    Promise<PluginStorageRecord | null>;
  list(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel,
    limit: number, cursor?: string): Promise<PluginStoragePage>;
  create(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel, id: string,
    fields: Readonly<Record<string, PluginStorageFieldValue>>): Promise<PluginStorageRecord>;
  update(scope: MemberStorageHostScope, model: ApprovedPluginPhysicalModel, id: string,
    expectedVersion: number, patch: Readonly<Record<string, PluginStorageFieldValue>>):
    Promise<PluginStorageRecord>;
}

/**
 * Authenticated request-lifetime Member bridge. Approved model descriptors are
 * operator-owned; caller fields cannot set member, plugin or publication.
 * Closing rejects new work and drains admitted work before HTTP reply.
 */
export function createHostPluginMemberStorageSession(
  hostScope: MemberStorageHostScope,
  approvedModels: readonly ApprovedPluginPhysicalModel[],
  repository: PluginMemberStorageRepository = new DrizzlePluginMemberStorageRepository(),
): { readonly memberStorage: PluginMemberStorageApi; close(): Promise<void> } {
  const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  if (!hostScope ||
      ![hostScope.pluginId, hostScope.publicationId, hostScope.memberId]
        .every((value) => typeof value === "string" && id.test(value)) ||
      typeof hostScope.requestId !== "string" ||
      !/^[A-Za-z0-9_:-]{1,128}$/.test(hostScope.requestId) ||
      typeof hostScope.allowWrites !== "boolean") {
    throw new PluginScopedStorageError("PLUGIN_MEMBER_STORAGE_INVALID", "Invalid Host Member binding");
  }
  if (!Array.isArray(approvedModels) || approvedModels.length === 0 ||
      approvedModels.length > 16) {
    throw new PluginScopedStorageError("PLUGIN_MEMBER_STORAGE_INVALID", "Missing approved models");
  }
  const models = new Map<string, ApprovedPluginPhysicalModel>();
  for (const model of approvedModels) {
    validateStorageModel(model);
    if (model.columns.some((column) =>
      ["member_id", "plugin_id", "tenant_id", "publication_id",
        "workspace_id", "user_id", "actor_user_id", "owner_id"].includes(column.name))) {
      throw new PluginScopedStorageError(
        "PLUGIN_MEMBER_STORAGE_INVALID", "Ownership selectors cannot be Member model fields",
      );
    }
    if (models.has(model.key)) {
      throw new PluginScopedStorageError("PLUGIN_MEMBER_STORAGE_INVALID", "Duplicate approved model");
    }
    models.set(model.key, model);
  }
  const scope = Object.freeze({ ...hostScope });
  const resolveModel = (key: string): ApprovedPluginPhysicalModel => {
    const model = models.get(key);
    if (!model) {
      throw new PluginScopedStorageError("PLUGIN_MEMBER_STORAGE_MODEL_DENIED", "Unknown Member model");
    }
    return model;
  };
  let closed = false;
  let closing: Promise<void> | null = null;
  const pending = new Set<Promise<unknown>>();
  const MAX_PENDING = 16;
  const call = <T>(write: boolean, fn: () => Promise<T>): Promise<T> => {
    try {
      if (closed) throw new PluginScopedStorageError(
        "PLUGIN_MEMBER_STORAGE_SESSION_CLOSED", "Member request has ended",
      );
      if (write && !scope.allowWrites) throw new PluginScopedStorageError(
        "PLUGIN_MEMBER_STORAGE_METHOD_DENIED", "Member writes require authenticated POST",
      );
      if (pending.size >= MAX_PENDING) throw new PluginScopedStorageError(
        "PLUGIN_MEMBER_STORAGE_BUSY", "Too many concurrent Member operations",
      );
      const operation = fn();
      pending.add(operation);
      void operation.then(
        () => { pending.delete(operation); },
        () => { pending.delete(operation); },
      );
      return operation;
    } catch (error) {
      const rejected = Promise.reject<T>(error);
      void rejected.catch(() => undefined);
      return rejected;
    }
  };
  const memberStorage: PluginMemberStorageApi = Object.freeze({
    get: (modelKey: string, recordId: string) => call(false, () =>
      repository.get(scope, resolveModel(modelKey), validateStorageRecordId(recordId))),
    list: (modelKey: string, limit = 20, cursor?: string) => call(false, () => {
      const page = validateStoragePage(limit, cursor);
      return repository.list(scope, resolveModel(modelKey), page.limit, page.cursor);
    }),
    create: (modelKey: string, recordId: string, fields: Readonly<Record<string, PluginStorageFieldValue>>) =>
      call(true, () => {
        const model = resolveModel(modelKey);
        return repository.create(scope, model, validateStorageRecordId(recordId),
          validateStorageFields(model, fields, false));
      }),
    update: (modelKey: string, recordId: string, expectedVersion: number,
      fields: Readonly<Record<string, PluginStorageFieldValue>>) => call(true, () => {
        const model = resolveModel(modelKey);
        return repository.update(scope, model, validateStorageRecordId(recordId),
          validateStorageVersion(expectedVersion), validateStorageFields(model, fields, true));
      }),
  });
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    closing = Promise.allSettled([...pending]).then((results) => {
      if (results.some((result) => result.status === "rejected")) {
        throw new PluginScopedStorageError(
          "PLUGIN_MEMBER_STORAGE_IN_FLIGHT_FAILED", "Member storage operation failed",
        );
      }
    });
    return closing;
  };
  return Object.freeze({ memberStorage, close });
}
