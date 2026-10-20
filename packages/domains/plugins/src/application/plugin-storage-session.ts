import type { PluginStorageApi } from "@vibress/plugin-sdk";
import type { ApprovedPluginPhysicalModel } from "./plugin-storage-migrations";
import {
  PluginScopedStorageError,
  PluginScopedStorageService,
  type PluginScopedStorageRepository,
} from "./plugin-scoped-storage";
import { DrizzlePluginScopedStorageRepository } from "../infrastructure/drizzle-plugin-scoped-storage";

/**
 * Host-only binding. Call only after authenticated publication and Staff
 * permission checks, with models resolved from the trusted operator plan.
 * Close in finally: handlers cannot retain authority across requests.
 */
export function createHostPluginStorageSession(
  scope: {
    readonly pluginId: string;
    readonly publicationId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  },
  approvedModels: readonly ApprovedPluginPhysicalModel[],
  repository: PluginScopedStorageRepository = new DrizzlePluginScopedStorageRepository(),
): { readonly storage: PluginStorageApi; close(): void } {
  // Only trusted authenticated Staff host callsites can provide these.
  if (!scope.actorUserId || !/^[A-Za-z0-9_-]{1,128}$/.test(scope.actorUserId) ||
      !scope.requestId || !/^[A-Za-z0-9_:-]{1,128}$/.test(scope.requestId)) {
    throw new PluginScopedStorageError(
      "PLUGIN_STORAGE_INVALID", "Missing or invalid Host audit principal",
    );
  }
  const service = new PluginScopedStorageService(repository, {
    pluginId: scope.pluginId, publicationId: scope.publicationId,
    audit: Object.freeze({ actorUserId: scope.actorUserId, requestId: scope.requestId }),
  }, approvedModels);
  let closed = false;
  const check = (): void => {
    if (closed) throw new PluginScopedStorageError(
      "PLUGIN_STORAGE_SESSION_CLOSED", "The authorized host request has ended",
    );
  };
  const storage: PluginStorageApi = Object.freeze({
    get: async (modelKey: string, id: string) => {
      check();
      return service.get(modelKey, id);
    },
    list: async (modelKey: string, limit?: number, cursor?: string) => {
      check();
      return service.list(modelKey, limit, cursor);
    },
    create: async (modelKey: string, id: string, fields: Readonly<Record<string, string | number | boolean | null>>) => {
      check();
      return service.create(modelKey, id, fields);
    },
    update: async (
      modelKey: string, id: string, expectedVersion: number,
      fields: Readonly<Record<string, string | number | boolean | null>>,
    ) => {
      check();
      return service.update(modelKey, id, expectedVersion, fields);
    },
  });
  return Object.freeze({ storage, close: () => { closed = true; } });
}
