import { hasPermission } from "@vibress/security";
import type { PluginAdminPermission } from "@vibress/plugin-sdk";

/**
 * Extension Admin endpoints are publication-scoped. Global Staff roles and
 * capabilities cannot elevate the Host-resolved publication membership.
 * Resource-specific post ownership is not available to extension handlers,
 * so generic posts.edit requires at least the publication's editor role.
 */
export function canAccessExtensionAdminRoute(
  permissions: readonly string[] | undefined,
  globalRoles: readonly string[] | undefined,
  publicationRole: string | null | undefined,
  required: PluginAdminPermission,
): boolean {
  if (!permissions || !globalRoles) return false;
  const isManager = publicationRole === "owner" || publicationRole === "admin";
  const isEditor = isManager || publicationRole === "editor";
  const isReader = isEditor || publicationRole === "author" || publicationRole === "contributor";
  const locallyAllowed = required === "plugins.manage"
    ? isManager
    : required === "plugins.read" || required === "posts.edit"
      ? isEditor
      : required === "posts.read" && isReader;
  // Both independent gates are mandatory. A global owner bypass is permitted
  // by hasPermission only AFTER publication-local role eligibility passed.
  return Boolean(locallyAllowed && hasPermission([...permissions], required, [...globalRoles]));
}
