import type { PluginModule } from "@vibress/plugin-sdk";
import type { ApprovedPluginPhysicalModel } from "@vibress/plugins";
import {
  ExtensionNativeDataRegistryV1Schema,
  type ExtensionNativeDataResourceV1, type ExtensionNativeDataActionV1,
} from "@vibress/api-contracts";
import { admitNativeAdminPage } from "./native-admin-registry";

export type NativeDataAdmission =
  | { readonly kind: "absent" | "invalid" }
  | { readonly kind: "admitted"; readonly resources: readonly ExtensionNativeDataResourceV1[];
      readonly actions: readonly ExtensionNativeDataActionV1[] };

/** The contribution is inert. It must accompany an admitted Native GET view. */
export function admitNativeDataRegistry(module: PluginModule): NativeDataAdmission {
  if (module.adminResources === undefined && module.adminActions === undefined) {
    return { kind: "absent" };
  }
  const parsed = ExtensionNativeDataRegistryV1Schema.safeParse({
    resources: module.adminResources, actions: module.adminActions ?? [],
  });
  if (!parsed.success || !module.adminPages?.length) return { kind: "invalid" };
  for (const page of module.adminPages) {
    if (admitNativeAdminPage(module, page.viewId).kind !== "admitted") {
      return { kind: "invalid" };
    }
  }
  const operations = parsed.data.actions.map((action) =>
    action.resourceId + ":" + action.operation);
  if (new Set(operations).size !== operations.length) return { kind: "invalid" };
  return { kind: "admitted", ...parsed.data };
}

/** Bind metadata to operator-approved database columns (not plugin-provided schema). */
export function admitNativeDataModel(
  resource: ExtensionNativeDataResourceV1,
  models: readonly ApprovedPluginPhysicalModel[],
  requireCreate = false,
): boolean {
  const model = models.find((item) => item.key === resource.modelKey);
  if (!model) return false;
  const fields = new Set(model.columns.map((column) => column.name));
  if (!resource.fields.every((field) => fields.has(field))) return false;
  if (requireCreate && model.columns.some((column) =>
    column.required && !resource.fields.includes(column.name))) return false;
  const indexed = new Set(model.indexedTextFields ?? []);
  return (resource.textFilters ?? []).every((field) =>
    indexed.has(field) && model.columns.some((column) =>
      column.name === field && column.type === "text"));
}
