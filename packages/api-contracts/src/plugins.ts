import { z } from "zod";

/** Plugin IDs in the Admin API identify platform-installed plugin rows. */
export const PluginPublicationParamsSchema = z.object({
  id: z.string().min(1).max(200),
}).strict();

export const PluginPublicationSecretParamsSchema = PluginPublicationParamsSchema.extend({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/),
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
  settings: z.record(z.string(), z.string().max(4096).nullable()).refine(
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
  items: z.array(ExtensionAdminNavDtoSchema).max(512),
}).strict();
/**
 * EXT-302A: Host admits only explicit public view-to-GET-route links.
 * The SDK contribution is metadata, never browser-provided URLs/HTML.
 */
export const ExtensionPublicViewSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  routeId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  title: ExtensionAdminLabelSchema,
  publishedLocales: z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)).max(12).optional(),
}).strict();

export const ExtensionPublicViewDtoSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  viewId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  routeId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  title: ExtensionAdminLabelSchema,
  publishedLocales: z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)).max(12).optional(),
}).strict();

export const ExtensionPublicProjectionSchema = z.record(
  z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
  z.union([z.string().max(4096), z.number().finite(), z.boolean()]),
).refine((data) => Object.keys(data).length <= 24, "Too many extension fields");

/** The SSR response binds descriptor and scalar projection to one Host
 * publication and one authorized execution. Additive: old v1 APIs remain. */
/** An authenticated-by-Host publication/locale admission proof which does
 * not execute the plugin's catalog handler or read plugin storage. Additive
 * endpoint for detailed extension pages; never a bearer authorization token. */
export const ExtensionPublicViewIdentitySchema = ExtensionPublicViewDtoSchema.extend({
  publicationId: z.string().min(1).max(200),
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
}).strict();

export const ExtensionPublicPageResponseSchema = ExtensionPublicViewDtoSchema.extend({
  publicationId: z.string().min(1).max(200),
  /** Selected from the publication's enabled locale policy at request time. */
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  data: ExtensionPublicProjectionSchema,
}).strict();

export const ExtensionPublicPageQuerySchema = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
}).strict();

export const ExtensionAdminNavigationParamsSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  viewId: ExtensionAdminSegmentSchema,
}).strict();

/** EXT-301B2: authenticated, inert JSON transport; NEVER an HTML response. */
export const ExtensionAdminUiResponseSchema = z.object({
  html: z.string().max(256 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** EXT-301B2B: one-use, Host-bound iframe URL; never plugin-provided. */
export const ExtensionAdminFrameTicketQuerySchema = z.object({
  ticket: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const ExtensionAdminFrameTicketResponseSchema = z.object({
  bridgeNonce: z.string().regex(/^[a-f0-9]{64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  src: z.string().max(400).regex(
    /^\/api\/admin\/v1\/extensions\/[a-z0-9][a-z0-9-]{0,99}\/views\/[a-z][a-z0-9-]{0,63}\/frame\?ticket=[a-f0-9]{64}$/,
  ),
}).strict();

/** Authorization refresh checks the active plugin, Staff, publication and approved bytes. */
export const ExtensionAdminFrameStatusResponseSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Only the signed-off, server-verified iframe document gets this proof. */
export const ExtensionAdminFrameProofSchema = z.object({
  type: z.enum(["vibress:extension:ready", "vibress:extension:gone"]),
  version: z.literal(1),
  bridgeNonce: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/**
 * EXT-301B2B: the opaque-origin iframe may ask Host to read exactly the
 * linked EXT-301A Admin GET route. It cannot choose URLs, route IDs, methods,
 * headers, publication IDs or bodies. Privileged writes are NOT bridged.
 */
/** EXT-301 write bridge: fixed linked route only; opaque-origin UI cannot
 * choose a URL, method, plugin, publication, permission or credentials. */
export const ExtensionAdminBridgeWriteRequestSchema = z.object({
  type: z.literal("vibress:extension:write"),
  version: z.literal(1),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  body: z.record(
    z.string().regex(/^[a-z][A-Za-z0-9_]{0,63}$/),
    z.union([z.string().max(4096), z.number().finite(), z.boolean()]),
  ).refine((fields) => Object.keys(fields).length <= 24, "Too many fields")
    .refine((fields) => ![
      "publicationId", "workspaceId", "tenantId", "pluginId",
      "actorUserId", "userId", "memberId",
    ].some((key) => Object.hasOwn(fields, key)), "Authority selectors are forbidden"),
}).strict();

export const ExtensionAdminBridgeReadRequestSchema = z.object({
  type: z.literal("vibress:extension:read"),
  version: z.literal(1),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  // Optional scalar selectors for the already-bound GET route. No arbitrary
  // URLs, tenant identities or credentials are accepted from plugin HTML.
  query: z.record(
    z.string().regex(/^[a-z][A-Za-z0-9_]{0,63}$/),
    z.union([z.string().max(256), z.number().finite(), z.boolean()]),
  ).refine((fields) => Object.keys(fields).length <= 4, "Too many read selectors")
    .refine((fields) => ![
      "publicationId", "workspaceId", "tenantId", "pluginId",
      "actorUserId", "userId", "memberId",
    ].some((key) => Object.hasOwn(fields, key)), "Authority selectors are forbidden")
    .optional(),
}).strict();

export const ExtensionAdminBridgeReadResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("vibress:extension:response"),
    version: z.literal(1),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    ok: z.literal(true),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  }).strict(),
  z.object({
    type: z.literal("vibress:extension:response"),
    version: z.literal(1),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    ok: z.literal(false),
    error: z.enum(["DENIED", "UNAVAILABLE", "RATE_LIMITED"]),
  }).strict(),
]);


/**
 * EXT-401: operator-admitted, publication-bound asynchronous plugin events.
 * External HTTP input and BullMQ payloads use the same bounded contract.
 * The job's version and digest are verified AGAIN against the live operator
 * release approval on the worker before executing trusted plugin code.
 */
const PluginEventNameSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/).max(100);
const PluginEventPayloadSchema = z.record(
  z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
  z.union([z.string().max(4096), z.number().finite(), z.boolean()]),
).refine((fields) => Object.keys(fields).length <= 24, "Too many event fields")
  .refine((fields) => !["publicationId", "workspaceId", "tenantId", "pluginId", "manifestId"]
    .some((key) => Object.hasOwn(fields, key)), "Caller cannot select event authority");

/** EXT-401 operator-only failed-event inspection and audited replay. The
 * publication is NEVER a caller-controlled field; only Staff context binds it. */
export const PluginEventRecoveryParamsSchema = PluginPublicationParamsSchema.extend({
  eventId: z.string().uuid(),
}).strict();
export const PluginEventFailureListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
export const PluginEventReplayRequestSchema = z.object({
  confirmAtLeastOnceRisk: z.literal(true),
}).strict();
export const PluginEventFailedDtoSchema = z.object({
  eventId: z.string().uuid(),
  jobId: z.string().regex(/^plugin-[a-f0-9]{64}$/),
  attemptsMade: z.number().int().nonnegative(),
  status: z.literal("failed"),
}).strict();
export const PluginEventFailedListResponseSchema = z.object({
  items: z.array(PluginEventFailedDtoSchema).max(50),
  nextOffset: z.number().int().nonnegative(),
}).strict();

export const PluginEventEnqueueSchema = z.object({
  eventId: z.string().uuid(),
  eventName: PluginEventNameSchema,
  payload: PluginEventPayloadSchema,
}).strict();

export const PluginWorkerEventJobSchema = PluginEventEnqueueSchema.extend({
  schemaVersion: z.literal(1),
  scope: z.literal("publication"),
  publicationId: z.string().min(1).max(200),
  pluginId: z.string().min(1).max(200),
  manifestId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  pluginVersion: z.string().min(1).max(128),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  traceparent: z.string().max(128).optional(),
}).strict();

export type PluginWorkerEventJob = z.infer<typeof PluginWorkerEventJobSchema>;
