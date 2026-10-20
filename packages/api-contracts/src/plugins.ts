import { z } from "zod";

/** Plugin IDs in the Admin API identify platform-installed plugin rows. */
export const PluginPublicationParamsSchema = z.object({
  id: z.string().min(1).max(200),
}).strict();

export const PluginPublicationActivationSchema = z.object({
  enabled: z.boolean(),
}).strict();

export const PluginPublicationStateSchema = z.object({
  pluginId: z.string(),
  publicationId: z.string(),
  enabled: z.boolean(),
}).strict();

/** Only declared string keys may be updated; domain validates declarations. */
export const PluginPublicationSettingsUpdateSchema = z.object({
  settings: z.record(z.string().max(4096).nullable()).refine(
    (value) => Object.keys(value).length <= 64,
    "Too many plugin settings",
  ),
}).strict();

export const PluginPublicationSettingsResponseSchema = z.object({
  settings: z.array(z.object({
    key: z.string(),
    value: z.string().nullable(),
    isSecret: z.boolean(),
    masked: z.boolean(),
  }).strict()),
}).strict();

export const OperatorTrustedPluginRegisterSchema = z.object({
  manifestId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(200),
}).strict();

/**
 * Online recovery is forbidden by default. An isolated recovery-maintenance
 * instance accepts operator attestation only after all other runtimes stop.
 */
export const PluginLifecycleRecoverySchema = z.object({
  confirmAllRuntimesStopped: z.literal(true),
}).strict();

/**
 * EXT-201: shared admission/runtime schema for declarative extension routes.
 * Descriptors are operator-installed trusted code, but data still arrives from
 * untrusted HTTP callers; reject unexpected keys, types and oversized payloads.
 */
const ExtensionScalarTypeSchema = z.enum(["string", "number", "boolean"]);
const ExtensionFieldNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/);
export const ExtensionApiShapeSchema = z.object({
  fields: z.record(ExtensionFieldNameSchema, ExtensionScalarTypeSchema).refine(
    (fields) => Object.keys(fields).length <= 24, "Too many extension fields",
  ),
  required: z.array(ExtensionFieldNameSchema).max(24).optional(),
}).strict().superRefine((shape, ctx) => {
  for (const field of shape.required ?? []) {
    if (!Object.hasOwn(shape.fields, field)) {
      ctx.addIssue({ code: "custom", message: "Required field is not declared" });
    }
  }
  if (new Set(shape.required ?? []).size !== (shape.required ?? []).length) {
    ctx.addIssue({ code: "custom", message: "Duplicate required fields" });
  }
});

export const ExtensionApiRouteSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  audience: z.enum(["admin", "member", "public"]),
  method: z.enum(["GET", "POST"]),
  permission: z.enum(["plugins.read", "plugins.manage", "posts.read", "posts.edit"]).optional(),
  query: ExtensionApiShapeSchema.optional(),
  body: ExtensionApiShapeSchema.optional(),
  response: ExtensionApiShapeSchema,
}).strict().superRefine((route, ctx) => {
  if (route.audience === "admin" && !route.permission) {
    ctx.addIssue({ code: "custom", message: "Admin route requires a Staff permission" });
  }
  if (route.audience !== "admin" && route.permission) {
    ctx.addIssue({ code: "custom", message: "Only Admin routes declare Staff permissions" });
  }
  if (route.audience === "public" && route.method !== "GET") {
    ctx.addIssue({ code: "custom", message: "Public routes are GET-only" });
  }
  if (route.method === "GET" && route.body) {
    ctx.addIssue({ code: "custom", message: "GET routes cannot accept bodies" });
  }
  if (Object.values(route.query?.fields ?? {}).some((type) => type !== "string")) {
    ctx.addIssue({ code: "custom", message: "Query parameters must be strings" });
  }
});

export const ExtensionApiRouteParamsSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  routeId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
}).strict();

/** Also accepts the SDK's readonly descriptor fields without a cross-package import. */
type ExtensionShape = {
  readonly fields: Readonly<Record<string, "string" | "number" | "boolean">>;
  readonly required?: readonly string[] | undefined;
};

/** Strict primitive-only contract. Rejects unknown keys and nested raw data. */
export function validateExtensionApiObject(
  shape: ExtensionShape | undefined,
  input: unknown,
): Record<string, string | number | boolean> | null {
  const fields = shape?.fields ?? {};
  if (input === undefined && Object.keys(fields).length === 0) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const candidate: Record<string, unknown> = input as Record<string, unknown>;
  if (Object.keys(candidate).length > 24) return null;
  for (const [key, value] of Object.entries(candidate)) {
    const expected = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!expected || typeof value !== expected ||
        (expected === "string" && (value as string).length > 4096) ||
        (expected === "number" && typeof value === "number" && !Number.isFinite(value))) return null;
  }
  for (const key of shape?.required ?? []) {
    if (!Object.hasOwn(candidate, key)) return null;
  }
  return candidate as Record<string, string | number | boolean>;
}

/**
 * EXT-301A: Host-owned Studio navigation and read-only data views.
 * Labels are localized plain text. No arbitrary href, HTML, iframe or asset URL.
 */
const ExtensionAdminSegmentSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const ExtensionAdminLabelSchema = z.object({
  en: z.string().min(1).max(100),
  ar: z.string().min(1).max(100),
}).strict();
export const ExtensionAdminViewSchema = z.object({
  id: ExtensionAdminSegmentSchema,
  routeId: ExtensionAdminSegmentSchema,
  title: ExtensionAdminLabelSchema,
}).strict();
export const ExtensionAdminNavigationItemSchema = z.object({
  viewId: ExtensionAdminSegmentSchema,
  label: ExtensionAdminLabelSchema,
  permission: z.enum(["plugins.read", "plugins.manage", "posts.read", "posts.edit"]),
}).strict();
/** Validated Host projection; plugin-supplied URLs never enter the DTO. */
export const ExtensionAdminNavDtoSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  viewId: ExtensionAdminSegmentSchema,
  routeId: ExtensionAdminSegmentSchema,
  label: ExtensionAdminLabelSchema,
  title: ExtensionAdminLabelSchema,
  permission: z.enum(["plugins.read", "plugins.manage", "posts.read", "posts.edit"]),
}).strict();
export const ExtensionAdminNavigationResponseSchema = z.object({
  items: z.array(ExtensionAdminNavDtoSchema).max(128),
}).strict();
export const ExtensionAdminNavigationParamsSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  viewId: ExtensionAdminSegmentSchema,
}).strict();
