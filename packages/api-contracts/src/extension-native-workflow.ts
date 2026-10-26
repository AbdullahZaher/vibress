import { z } from "zod";

const Segment = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const Field = z.string().regex(/^[a-z][A-Za-z0-9_]{0,63}$/);
const Label = z.object({
  en: z.string().trim().min(1).max(100),
  ar: z.string().trim().min(1).max(100),
}).strict();

/** Inert, bounded workflow. No handlers, URLs, executable expressions or auth grants. */
export const ExtensionNativeDomainWorkflowV1Schema = z.object({
  schemaVersion: z.literal(1),
  viewId: Segment,
  routeId: Segment,
  resourceId: Segment,
  idField: Field,
  versionField: Field,
  operationField: Field,
  fields: z.array(z.object({
    key: Field,
    label: Label,
    multiline: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(4096),
  }).strict()).min(1).max(10),
  operations: z.array(z.enum(["create", "save", "publish"])).min(2).max(3),
}).strict().superRefine((workflow, ctx) => {
  const inputKeys = workflow.fields.map((field) => field.key);
  const names = [workflow.idField, workflow.versionField, workflow.operationField, ...inputKeys];
  if (new Set(names).size !== names.length || new Set(workflow.operations).size !== workflow.operations.length ||
      !workflow.operations.includes("create") || !workflow.operations.includes("save")) {
    ctx.addIssue({ code: "custom", message: "Conflicting fields or invalid workflow operations" });
  }
  if (new TextEncoder().encode(JSON.stringify(workflow)).byteLength > 16 * 1024) {
    ctx.addIssue({ code: "custom", message: "Workflow descriptor exceeds 16 KiB" });
  }
});
export const ExtensionNativeDomainWorkflowsV1Schema = z.array(
  ExtensionNativeDomainWorkflowV1Schema,
).max(8).refine((items) => new Set(items.map((i) => i.viewId)).size === items.length);

export type ExtensionNativeDomainWorkflowV1 =
  z.infer<typeof ExtensionNativeDomainWorkflowV1Schema>;
