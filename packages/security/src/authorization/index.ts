export function hasPermission(
  userPermissions: string[],
  requiredPermission: string,
  userRoles: string[] = [],
): boolean {
  if (userRoles.includes("owner")) {
    return true;
  }
  return userPermissions.includes(requiredPermission);
}

export function isOwner(userRoles: string[]): boolean {
  return userRoles.includes("owner");
}
