/** EXT-301 privileged iframe write admission.
 * A read-only Admin route permission is never a mutation grant, including
 * direct HTTP POSTs that bypass the browser's confirmation UI. */
export function isExtensionAdminWritePermission(
  permission: string | undefined,
): boolean {
  return permission === "plugins.manage" || permission === "posts.edit";
}
