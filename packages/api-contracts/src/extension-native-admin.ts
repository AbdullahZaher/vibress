import { z } from "zod";

/**
 * NUI-01 experimental inert descriptor contract.
 *
 * This schema validates syntactic shape only. It is NOT an authorization,
 * routing or plugin-admission decision. Before any native page is rendered,
 * a future Host registry MUST link page.viewId to exactly one admitted legacy
 * adminViews GET route, enforce Staff and publication-local authorization,
 * and verify every referenced field against that route's response schema.
 */
const NativeLabelV1 = z.object({
  en: z.string().min(1).max(100),
  ar: z.string().min(1).max(100),
}).strict();

const NativeSegment = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const NativeField = z.string().regex(/^[a-z][A-Za-z0-9_]{0,63}$/);

const NativeStatV1 = z.object({
  type: z.literal("stat"),
  id: NativeSegment,
  label: NativeLabelV1,
  field: NativeField,
}).strict();

const NativeFieldListV1 = z.object({
  type: z.literal("field-list"),
  id: NativeSegment,
  fields: z.array(z.object({
    key: NativeField,
    label: NativeLabelV1,
  }).strict()).min(1).max(12),
}).strict().refine(
  (section) => new Set(section.fields.map((field) => field.key)).size === section.fields.length,
  "Duplicate field references are not allowed",
);

export const ExtensionNativeAdminComponentV1Schema = z.discriminatedUnion(
  "type", [NativeStatV1, NativeFieldListV1],
);

export const ExtensionNativeAdminPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  viewId: NativeSegment,
  title: NativeLabelV1,
  description: NativeLabelV1.optional(),
  components: z.array(ExtensionNativeAdminComponentV1Schema).min(1).max(12),
}).strict().superRefine((page, ctx) => {
  const componentIds = page.components.map((component) => component.id);
  if (new Set(componentIds).size !== componentIds.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate component IDs" });
  }
  // A bounded transport envelope also limits an otherwise legal set of labels.
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > 64 * 1024) {
    ctx.addIssue({ code: "custom", message: "Native descriptor exceeds 64 KiB" });
  }
});

export const ExtensionNativeAdminPagesV1Schema = z.array(
  ExtensionNativeAdminPageV1Schema,
).max(8).superRefine((pages, ctx) => {
  const ids = pages.map((page) => page.viewId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate native view IDs" });
  }
});

export type ExtensionNativeAdminPageV1 =
  z.infer<typeof ExtensionNativeAdminPageV1Schema>;
