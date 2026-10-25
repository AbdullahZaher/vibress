import { z } from "zod";

/** NUI-03: operator-approved Host plugin storage, not a general plugin API. */
const Segment = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const Model = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const Field = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const RecordId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const Keys = z.array(Field).min(1).max(12).refine(
  (items) => new Set(items).size === items.length, "Duplicate field identifiers",
);
const OptionalKeys = z.array(Field).max(4).refine(
  (items) => new Set(items).size === items.length, "Duplicate filters",
);
export const ExtensionNativeDataResourceV1Schema = z.object({
  id: Segment,
  modelKey: Model,
  viewId: Segment.optional(),
  fields: Keys,
  textFilters: OptionalKeys.optional(),
}).strict().superRefine((resource, ctx) => {
  if (resource.textFilters?.some((key) => !resource.fields.includes(key))) {
    ctx.addIssue({ code: "custom", message: "Filter is not a projected field" });
  }
});
export const ExtensionNativeDataActionV1Schema = z.object({
  id: Segment,
  resourceId: Segment,
  operation: z.enum(["create", "update"]),
}).strict();
export const ExtensionNativeDataRegistryV1Schema = z.object({
  resources: z.array(ExtensionNativeDataResourceV1Schema).min(1).max(8),
  actions: z.array(ExtensionNativeDataActionV1Schema).max(16),
}).strict().superRefine((registry, ctx) => {
  const resources = registry.resources.map((resource) => resource.id);
  const actions = registry.actions.map((action) => action.id);
  if (new Set(resources).size !== resources.length ||
      new Set(actions).size !== actions.length ||
      registry.actions.some((action) => !resources.includes(action.resourceId))) {
    ctx.addIssue({ code: "custom", message: "Duplicate or unbound Native data ID" });
  }
});
export const ExtensionNativeDataDiscoveryV1Schema = z.object({
  schemaVersion: z.literal(1),
  resources: z.array(z.object({
    id: Segment,
    viewId: Segment.optional(),
    fields: Keys,
    textFilters: OptionalKeys.optional(),
    fieldTypes: z.record(Field, z.enum(["text", "integer", "boolean", "timestamptz"])).optional(),
    requiredFields: OptionalKeys.optional(),
  }).strict()).max(8),
  actions: z.array(ExtensionNativeDataActionV1Schema).max(16),
}).strict();
export type ExtensionNativeDataDiscoveryV1 = z.infer<typeof ExtensionNativeDataDiscoveryV1Schema>;

export const ExtensionNativeDataParamsV1Schema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  resourceId: Segment,
}).strict();
export const ExtensionNativeActionParamsV1Schema = z.object({
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  actionId: Segment,
}).strict();
export const ExtensionNativeDataQueryV1Schema = z.object({
  limit: z.string().regex(/^(?:[1-9]|1[0-9]|20)$/).optional(),
  cursor: z.string().min(50).max(1024).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  filterField: Field.optional(),
  filterValue: z.string().min(1).max(256).optional(),
}).strict().refine(
  (query) => (query.filterField === undefined) === (query.filterValue === undefined),
  "Filter field and value must be supplied together",
);
const DataValue = z.union([
  z.string().max(8192),
  z.number().int().min(-2147483648).max(2147483647),
  z.boolean(),
  z.null(),
]);
const DataFields = z.record(Field, DataValue).refine(
  (value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 12,
  "Invalid number of Native data fields",
);
export const ExtensionNativeActionBodyV1Schema = z.object({
  id: RecordId,
  expectedVersion: z.number().int().min(1).max(2147483646).optional(),
  fields: DataFields,
}).strict();
export const ExtensionNativeDataRecordV1Schema = z.object({
  id: RecordId,
  version: z.number().int().positive(),
  fields: z.record(Field, DataValue),
}).strict();
export const ExtensionNativeDataPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(ExtensionNativeDataRecordV1Schema).max(20),
  nextCursor: z.string().min(50).max(1024).optional(),
}).strict();
export const ExtensionNativeActionResultV1Schema = z.object({
  schemaVersion: z.literal(1),
  record: ExtensionNativeDataRecordV1Schema,
}).strict();

export type ExtensionNativeDataResourceV1 = z.infer<typeof ExtensionNativeDataResourceV1Schema>;
export type ExtensionNativeDataActionV1 = z.infer<typeof ExtensionNativeDataActionV1Schema>;
export type ExtensionNativeDataPageV1 = z.infer<typeof ExtensionNativeDataPageV1Schema>;
