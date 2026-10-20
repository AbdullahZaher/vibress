import type {
  PluginMemberAccessApi, PluginMemberSelf,
} from "@vibress/plugin-sdk";
import { PluginDomainError } from "./plugins-service";
import { DrizzlePluginMemberAccessRepository } from "../infrastructure/drizzle-plugin-member-access";

export interface HostBoundMemberScope {
  readonly pluginId: string;
  readonly publicationId: string;
  readonly memberId: string;
}

export interface PluginMemberAccessRepository {
  getSelf(scope: HostBoundMemberScope): Promise<PluginMemberSelf | null>;
  hasActivePlan(scope: HostBoundMemberScope, planId: string): Promise<boolean>;
}

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PENDING_READS = 16;

/**
 * Internal Host factory. Scope is derived from authenticated Member session
 * and publication resolved by the Host, never from extension input. Revoking
 * the session stops new reads and drains existing reads before HTTP response.
 */
export function createHostMemberAccessSession(
  scope: HostBoundMemberScope,
  repository: PluginMemberAccessRepository = new DrizzlePluginMemberAccessRepository(),
): { readonly memberAccess: PluginMemberAccessApi; close(): Promise<void> } {
  if (!scope || ![scope.pluginId, scope.publicationId, scope.memberId]
    .every((id) => typeof id === "string" && VALID_ID.test(id))) {
    throw new PluginDomainError("EXTENSION_MEMBER_INVALID", "Invalid Host member binding");
  }
  const bound = Object.freeze({ ...scope });
  let closed = false;
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | null = null;
  const call = <T>(work: () => Promise<T>): Promise<T> => {
    try {
      if (closed) throw new PluginDomainError(
        "EXTENSION_MEMBER_SESSION_CLOSED", "Member request has ended",
      );
      if (pending.size >= MAX_PENDING_READS) throw new PluginDomainError(
        "EXTENSION_MEMBER_BUSY", "Too many member lookups",
      );
      const operation = work();
      pending.add(operation);
      // Observe rejections even for fire-and-forget extension handlers.
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
  const memberAccess: PluginMemberAccessApi = Object.freeze({
    getSelf: () => call(() => repository.getSelf(bound)),
    hasActivePlan: (planId: string) => call(() => {
      if (typeof planId !== "string" || !VALID_ID.test(planId)) {
        throw new PluginDomainError("EXTENSION_PLAN_INVALID", "Invalid plan identifier");
      }
      return repository.hasActivePlan(bound, planId);
    }),
  });
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    closing = Promise.allSettled([...pending]).then((items) => {
      if (items.some((item) => item.status === "rejected")) {
        throw new PluginDomainError(
          "EXTENSION_MEMBER_READ_FAILED", "Member lookup failed before response",
        );
      }
    });
    return closing;
  };
  return Object.freeze({ memberAccess, close });
}
