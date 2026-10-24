import type { PluginApiShape, PluginModule } from "@vibress/plugin-sdk";
import {
  ExtensionAdminNavigationItemSchema,
  ExtensionAdminViewSchema,
  ExtensionApiRouteSchema,
} from "@vibress/api-contracts";

export interface AdmittedAdminView {
  readonly viewId: string;
  readonly routeId: string;
  readonly title: { readonly en: string; readonly ar: string };
  readonly label: { readonly en: string; readonly ar: string };
  readonly permission: "plugins.read" | "plugins.manage" | "posts.read" | "posts.edit";
}

const MAX_VIEWS_PER_PLUGIN = 8;

const FORBIDDEN_READ_SELECTORS = new Set([
  "publicationId", "workspaceId", "tenantId", "pluginId",
  "actorUserId", "userId", "memberId",
]);

function admittedReadQuery(
  query: PluginApiShape | undefined,
): boolean {
  if (!query) return true;
  if (query.required?.length) return false;
  const keys = Object.keys(query.fields);
  return keys.length <= 4 && keys.every((key) =>
    !FORBIDDEN_READ_SELECTORS.has(key) &&
    /^[a-z][A-Za-z0-9_]{0,63}$/.test(key));
}


/**
 * Reject the ENTIRE contribution for broken links, duplicate IDs, dynamic
 * queries, unsafe descriptions or mismatched route permissions. Never call
 * activate() or plugin handlers to discover Studio navigation.
 */
export function admitAdminViews(module: PluginModule): readonly AdmittedAdminView[] | null {
  const views = module.adminViews;
  const navigation = module.adminNavigation;
  if (views === undefined && navigation === undefined) return [];
  if (!Array.isArray(views) || !Array.isArray(navigation) ||
      views.length === 0 || navigation.length === 0 ||
      views.length > MAX_VIEWS_PER_PLUGIN || navigation.length > MAX_VIEWS_PER_PLUGIN) return null;

  const viewMap = new Map<string, { id: string; routeId: string; title: { en: string; ar: string } }>();
  for (const raw of views) {
    const parsed = ExtensionAdminViewSchema.safeParse(raw);
    if (!parsed.success || viewMap.has(parsed.data.id)) return null;
    if (!parsed.data.title.en.trim() || !parsed.data.title.ar.trim()) return null;
    viewMap.set(parsed.data.id, parsed.data);
  }

  const result: AdmittedAdminView[] = [];
  const seen = new Set<string>();
  for (const raw of navigation) {
    const parsed = ExtensionAdminNavigationItemSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.viewId) ||
        !parsed.data.label.en.trim() || !parsed.data.label.ar.trim()) return null;
    seen.add(parsed.data.viewId);
    const view = viewMap.get(parsed.data.viewId);
    if (!view) return null;
    // A Host-rendered view can only call its single permission-checked GET
    // handler. Optional bounded scalar queries are validated again by HTTP.
    const routes = module.routes?.filter((route) =>
      route?.audience === "admin" && route.method === "GET" && route.id === view.routeId) ?? [];
    if (routes.length !== 1 || routes[0] === undefined ||
        typeof routes[0].handle !== "function") return null;
    const route = routes[0];
    const descriptor = ExtensionApiRouteSchema.safeParse({
      id: route.id, audience: route.audience, method: route.method,
      permission: route.permission, query: route.query, body: route.body,
      response: route.response,
    });
    if (!descriptor.success || !admittedReadQuery(route.query) ||
        route.permission !== parsed.data.permission) return null;
    result.push({
      viewId: view.id, routeId: view.routeId, title: view.title,
      label: parsed.data.label, permission: parsed.data.permission,
    });
  }
  // Unlinked views are a configuration mistake, not a hidden attack surface.
  if (seen.size !== viewMap.size) return null;
  return result;
}
