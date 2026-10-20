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
    /** HTTP Host may grant writes only for Origin-validated POST requests. */
    readonly allowWrites?: boolean;
  },
  approvedModels: readonly ApprovedPluginPhysicalModel[],
  repository: PluginScopedStorageRepository = new DrizzlePluginScopedStorageRepository(),
): { readonly storage: PluginStorageApi; close(): Promise<void> } {
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
  const pending = new Set<Promise<unknown>>();
  let closePromise: Promise<void> | null = null;
  // Bound the number of database transactions an extension can launch in one
  // request. The Host must never respond before started operations settle.
  const MAX_PENDING_OPERATIONS = 16;
  const check = (write = false): void => {
    if (closed) throw new PluginScopedStorageError(
      "PLUGIN_STORAGE_SESSION_CLOSED", "The authorized host request has ended",
    );
    if (write && scope.allowWrites !== true) throw new PluginScopedStorageError(
      "PLUGIN_STORAGE_METHOD_DENIED", "Storage writes require authorized POST",
    );
  };
  const invoke = <T>(write: boolean, run: () => Promise<T>): Promise<T> => {
    try {
      check(write);
      if (pending.size >= MAX_PENDING_OPERATIONS) {
        throw new PluginScopedStorageError(
          "PLUGIN_STORAGE_BUSY", "Too many pending storage operations",
        );
      }
      const operation = run();
      pending.add(operation);
      // The exact promise returned to the plugin is observed here: do not
      // introduce an async wrapper that could reject after this observer.
      void operation.then(
        () => { pending.delete(operation); },
        () => { pending.delete(operation); },
      );
      return operation;
    } catch (error) {
      const rejected = Promise.reject<T>(error);
      // Preserve Promise rejection for callers while avoiding process-level
      // unhandled rejections from fire-and-forget invalid SDK calls.
      void rejected.catch(() => undefined);
      return rejected;
    }
  };
  const storage: PluginStorageApi = Object.freeze({
    get: (modelKey: string, id: string) =>
      invoke(false, () => service.get(modelKey, id)),
    list: (modelKey: string, limit?: number, cursor?: string) =>
      invoke(false, () => service.list(modelKey, limit, cursor)),
    create: (
      modelKey: string, id: string,
      fields: Readonly<Record<string, string | number | boolean | null>>,
    ) => invoke(true, () => service.create(modelKey, id, fields)),
    update: (
      modelKey: string, id: string, expectedVersion: number,
      fields: Readonly<Record<string, string | number | boolean | null>>,
    ) => invoke(true, () => service.update(modelKey, id, expectedVersion, fields)),
  });
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    // Close admission synchronously, then drain operations that started
    // before the request completed. Failed detached operations fail the HTTP
    // response; caught errors already settled in the handler stay handled.
    closed = true;
    const outstanding = [...pending];
    closePromise = Promise.allSettled(outstanding).then((settled) => {
      if (settled.some((item) => item.status === "rejected")) {
        throw new PluginScopedStorageError(
          "PLUGIN_STORAGE_IN_FLIGHT_FAILED",
          "An in-flight storage operation failed before request completion",
        );
      }
    });
    return closePromise;
  };
  return Object.freeze({ storage, close });
}
