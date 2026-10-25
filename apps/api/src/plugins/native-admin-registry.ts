import type { PluginModule } from "@vibress/plugin-sdk";
import {
  ExtensionNativeAdminPagesV1Schema,
  type ExtensionNativeAdminPageV1,
} from "@vibress/api-contracts";
import { admitAdminViews } from "./admin-view-registry";

/** Admission is separate from schema parsing and client-provided navigation. */
export type NativeAdminAdmission =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "admitted"; readonly page: ExtensionNativeAdminPageV1;
      readonly routeId: string; readonly permission: "plugins.read" | "plugins.manage" | "posts.read" | "posts.edit" };

/**
 * Static release metadata only. Authorization must be enforced independently
 * on every HTTP request by Staff/session/publication-scoped Host routes.
 */
export function admitNativeAdminPage(
  module: PluginModule,
  viewId: string,
): NativeAdminAdmission {
  if (module.adminPages === undefined) return { kind: "absent" };
  const parsed = ExtensionNativeAdminPagesV1Schema.safeParse(module.adminPages);
  if (!parsed.success || parsed.data.length === 0) return { kind: "invalid" };
  const views = admitAdminViews(module);
  if (!views) return { kind: "invalid" };
  // A native declaration may only enhance an already-admitted legacy view.
  // Fail closed for an orphan or conflicting native contribution.
  for (const page of parsed.data) {
    const linked = views.find((view) => view.viewId === page.viewId);
    if (!linked) return { kind: "invalid" };
    const routes = module.routes?.filter((route) =>
      route.audience === "admin" && route.method === "GET" &&
      route.id === linked.routeId);
    if (!routes || routes.length !== 1 || !routes[0]) return { kind: "invalid" };
    const fields = routes[0].response.fields;
    const referenced = page.components.flatMap((component) =>
      component.type === "stat"
        ? [component.field]
        : component.fields.map((field) => field.key));
    if (referenced.some((key) => !Object.hasOwn(fields, key))) {
      return { kind: "invalid" };
    }
  }
  const page = parsed.data.find((item) => item.viewId === viewId);
  if (!page) return { kind: "absent" };
  const linked = views.find((item) => item.viewId === viewId);
  if (!linked) return { kind: "invalid" };
  return {
    kind: "admitted", page, routeId: linked.routeId,
    permission: linked.permission,
  };
}
