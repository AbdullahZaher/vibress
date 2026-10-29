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
  readonly publicationId?: string | undefined;
  readonly invocationId?: string | undefined;
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

const storageGetParamsSchema = z.object({
  modelKey: z.string().min(1).max(64),
  id: z.string().min(1).max(256),
}).strict();

const storageListParamsSchema = z.object({
  modelKey: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(256).optional(),
}).strict();

const storageCreateParamsSchema = z.object({
  modelKey: z.string().min(1).max(64),
  id: z.string().min(1).max(256),
  fields: z.record(z.string(), z.unknown()),
}).strict();

const storageUpdateParamsSchema = z.object({
  modelKey: z.string().min(1).max(64),
  id: z.string().min(1).max(256),
  expectedVersion: z.number().int().min(1),
  fields: z.record(z.string(), z.unknown()),
}).strict();

const memberHasActivePlanParamsSchema = z.object({
  planId: z.string().min(1).max(128),
}).strict();

const secretGetParamsSchema = z.object({
  key: z.string().min(1).max(128),
}).strict();

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Tier2CapabilityError) {
    return error.message;
  }
  if (error instanceof Error) {
    const msg = error.message;
    // Redact internal database errors, sql queries, postgres details, or credentials
    if (
      /postgres|syntax error|select |insert |update |delete |from |where |relation |table |column |violates |keyring|secret|password|token/i.test(
        msg,
      )
    ) {
      return "Database or internal capability execution failed";
    }
    return msg.slice(0, 200);
  }
  return "Capability execution failed";
}

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
 * RT-03 / M7.4: Per-request Host-mediated capability gateway.
 * Evaluates actor, publication scope, and declared manifest capabilities.
 * Strictly prevents cross-publication leakage and ungranted capability execution.
 */
export async function executeHostCapabilityRequest(
  context: Tier2CapabilityContext,
  request: Tier2CapabilityRequest,
  handlers: HostCapabilityHandlers,
): Promise<Tier2CapabilityResponse> {
  // 1. Enforce strict publication binding: plugin cannot request foreign publication data
  if (request.publicationId && request.publicationId !== context.publicationId) {
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

  // 3. Dispatch to host handler with runtime schema validation
  try {
    switch (request.action) {
      case "storage.get": {
        const parsed = storageGetParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
        }
        if (!handlers.storageGet) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Storage handler not configured" } };
        }
        const data = await handlers.storageGet(parsed.data.modelKey, parsed.data.id);
        return { ok: true, data };
      }

      case "storage.list": {
        const parsed = storageListParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
        }
        if (!handlers.storageList) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Storage handler not configured" } };
        }
        const data = await handlers.storageList(parsed.data.modelKey, parsed.data.limit, parsed.data.cursor);
        return { ok: true, data };
      }

      case "storage.create": {
        const parsed = storageCreateParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
        }
        if (!handlers.storageCreate) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Storage handler not configured" } };
        }
        const data = await handlers.storageCreate(parsed.data.modelKey, parsed.data.id, parsed.data.fields as Record<string, unknown>);
        return { ok: true, data };
      }

      case "storage.update": {
        const parsed = storageUpdateParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
        }
        if (!handlers.storageUpdate) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Storage handler not configured" } };
        }
        const data = await handlers.storageUpdate(
          parsed.data.modelKey,
          parsed.data.id,
          parsed.data.expectedVersion,
          parsed.data.fields as Record<string, unknown>,
        );
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
        const parsed = memberHasActivePlanParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
        }
        if (!handlers.memberHasActivePlan) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Plan entitlement check not available" } };
        }
        const data = await handlers.memberHasActivePlan(parsed.data.planId);
        return { ok: true, data };
      }

      case "secret.get": {
        const parsed = secretGetParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
        }
        if (!handlers.secretGet) {
          return { ok: false, error: { code: "NOT_SUPPORTED", message: "Secret retriever not available" } };
        }
        const data = await handlers.secretGet(parsed.data.key);
        return { ok: true, data };
      }

      default:
        return { ok: false, error: { code: "UNKNOWN_ACTION", message: `Action '${(request as Tier2CapabilityRequest).action}' not recognized` } };
    }
  } catch (error: unknown) {
    const message = sanitizeErrorMessage(error);
    return { ok: false, error: { code: "CAPABILITY_EXECUTION_FAILED", message } };
  }
}
