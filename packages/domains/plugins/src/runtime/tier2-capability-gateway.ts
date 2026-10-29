import { z } from "zod";

export interface Tier2CapabilityContext {
  readonly pluginId: string;
  readonly publicationId: string;
  readonly releaseDigest: string;
  readonly grantedCapabilities: readonly string[];
  readonly actor: {
    readonly id: string;
    readonly type: "staff" | "member" | "anonymous";
  };
}

export type Tier2CapabilityAction =
  | "storage.get"
  | "storage.list"
  | "storage.create"
  | "storage.update"
  | "member.getSelf"
  | "member.hasActivePlan"
  | "secret.get";

export interface Tier2CapabilityRequest {
  readonly action: Tier2CapabilityAction;
  readonly publicationId: string;
  readonly params: Record<string, unknown>;
}

export interface Tier2CapabilityResponse<T = unknown> {
  readonly ok: boolean;
  readonly data?: T | undefined;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  } | undefined;
}

export class Tier2CapabilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Tier2CapabilityError";
  }
}

const REQUIRED_CAPABILITY_MAP: Record<Tier2CapabilityAction, string> = {
  "storage.get": "extension.storage.read",
  "storage.list": "extension.storage.read",
  "storage.create": "extension.storage.write",
  "storage.update": "extension.storage.write",
  "member.getSelf": "extension.member.read",
  "member.hasActivePlan": "extension.entitlements.plan.read",
  "secret.get": "extension.secrets.read",
};

export interface HostCapabilityHandlers {
  storageGet?: (modelKey: string, id: string) => Promise<unknown>;
  storageList?: (modelKey: string, limit?: number, cursor?: string) => Promise<unknown>;
  storageCreate?: (modelKey: string, id: string, fields: Record<string, unknown>) => Promise<unknown>;
  storageUpdate?: (modelKey: string, id: string, expectedVersion: number, fields: Record<string, unknown>) => Promise<unknown>;
  memberGetSelf?: () => Promise<unknown>;
  memberHasActivePlan?: (planId: string) => Promise<boolean>;
  secretGet?: (key: string) => Promise<string | null>;
}

/**
 * RT-03: Per-request Host-mediated capability gateway.
 * Evaluates actor, publication scope, and declared manifest capabilities.
 * Strictly prevents cross-publication leakage and ungranted capability execution.
 */
export async function executeHostCapabilityRequest(
  context: Tier2CapabilityContext,
  request: Tier2CapabilityRequest,
  handlers: HostCapabilityHandlers,
): Promise<Tier2CapabilityResponse> {
  // 1. Enforce strict publication binding: plugin cannot request foreign publication data
  if (request.publicationId !== context.publicationId) {
    return {
      ok: false,
      error: {
        code: "CROSS_PUBLICATION_DENIED",
        message: "Plugin is forbidden from requesting capabilities across publication boundaries",
      },
    };
  }

  // 2. Enforce declared capability requirement
  const requiredCap = REQUIRED_CAPABILITY_MAP[request.action];
  if (!requiredCap || !context.grantedCapabilities.includes(requiredCap)) {
    return {
      ok: false,
      error: {
        code: "CAPABILITY_NOT_GRANTED",
        message: `Plugin lacks required capability '${requiredCap || request.action}'`,
      },
    };
  }

  // 3. Dispatch to host handler
  try {
    switch (request.action) {
      case "storage.get": {
        const modelKey = String(request.params.modelKey || "");
        const id = String(request.params.id || "");
        if (!modelKey || !id || !handlers.storageGet) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "Missing modelKey or id" } };
        }
        const data = await handlers.storageGet(modelKey, id);
        return { ok: true, data };
      }

      case "storage.list": {
        const modelKey = String(request.params.modelKey || "");
        const limit = typeof request.params.limit === "number" ? Math.min(request.params.limit, 100) : 20;
        const cursor = typeof request.params.cursor === "string" ? request.params.cursor : undefined;
        if (!modelKey || !handlers.storageList) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "Missing modelKey" } };
        }
        const data = await handlers.storageList(modelKey, limit, cursor);
        return { ok: true, data };
      }

      case "storage.create": {
        const modelKey = String(request.params.modelKey || "");
        const id = String(request.params.id || "");
        const fields = (request.params.fields as Record<string, unknown>) || {};
        if (!modelKey || !id || !handlers.storageCreate) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "Missing parameters" } };
        }
        const data = await handlers.storageCreate(modelKey, id, fields);
        return { ok: true, data };
      }

      case "storage.update": {
        const modelKey = String(request.params.modelKey || "");
        const id = String(request.params.id || "");
        const expectedVersion = Number(request.params.expectedVersion || 0);
        const fields = (request.params.fields as Record<string, unknown>) || {};
        if (!modelKey || !id || !expectedVersion || !handlers.storageUpdate) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "Missing parameters" } };
        }
        const data = await handlers.storageUpdate(modelKey, id, expectedVersion, fields);
        return { ok: true, data };
      }

      case "member.getSelf": {
        if (!handlers.memberGetSelf) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Member session not available" } };
        }
        const data = await handlers.memberGetSelf();
        return { ok: true, data };
      }

      case "member.hasActivePlan": {
        const planId = String(request.params.planId || "");
        if (!planId || !handlers.memberHasActivePlan) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "Missing planId" } };
        }
        const data = await handlers.memberHasActivePlan(planId);
        return { ok: true, data };
      }

      case "secret.get": {
        const key = String(request.params.key || "");
        if (!key || !handlers.secretGet) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "Missing key" } };
        }
        const data = await handlers.secretGet(key);
        return { ok: true, data };
      }

      default:
        return { ok: false, error: { code: "UNKNOWN_ACTION", message: `Action '${request.action}' not recognized` } };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Capability execution failed";
    return { ok: false, error: { code: "CAPABILITY_EXECUTION_FAILED", message } };
  }
}
