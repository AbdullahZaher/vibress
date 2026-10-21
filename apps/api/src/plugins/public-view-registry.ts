import type { PluginModule } from "@vibress/plugin-sdk";
import {
  ExtensionApiRouteSchema,
  ExtensionPublicViewSchema,
} from "@vibress/api-contracts";

export interface AdmittedPublicView {
  readonly viewId: string;
  readonly routeId: string;
  readonly title: { readonly en: string; readonly ar: string };
}

/**
 * A public page is opt-in. Never infer SSR pages from API routes, construct
 * arbitrary paths, or expose member/admin GET handlers to the web.
 * All linked handlers use the existing Host-authorized public API.
 */
export function admitPublicViews(module: PluginModule): readonly AdmittedPublicView[] | null {
  if (module.publicViews === undefined) return [];
  const views = module.publicViews;
  if (!Array.isArray(views) || views.length === 0 || views.length > 8 ||
      !Array.isArray(module.routes) || module.routes.length > 32) return null;

  const routeKeys = new Set<string>();
  for (const route of module.routes) {
    if (!route || typeof route.handle !== "function") return null;
    const parsed = ExtensionApiRouteSchema.safeParse({
      id: route.id, audience: route.audience, method: route.method,
      permission: route.permission, query: route.query, body: route.body,
      response: route.response,
    });
    if (!parsed.success) return null;
    const key = `${route.audience}:${route.method}:${route.id}`;
    if (routeKeys.has(key)) return null;
    routeKeys.add(key);
  }

  const seen = new Set<string>();
  const result: AdmittedPublicView[] = [];
  for (const raw of views) {
    const parsed = ExtensionPublicViewSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id) ||
        !parsed.data.title.en.trim() || !parsed.data.title.ar.trim()) return null;
    const linked = module.routes.filter((route) =>
      route.audience === "public" && route.method === "GET" &&
      route.id === parsed.data.routeId && route.query === undefined &&
      route.body === undefined);
    if (linked.length !== 1) return null;
    seen.add(parsed.data.id);
    result.push({
      viewId: parsed.data.id, routeId: parsed.data.routeId,
      title: parsed.data.title,
    });
  }
  return result;
}
