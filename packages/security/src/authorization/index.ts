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

export interface ResourceAuthContext {
  actorId: string;
  resourceOwnerId?: string | null | undefined;
  resourceAuthorIds?: string[] | undefined;
  userRoles?: string[] | undefined;
  userPermissions?: string[] | undefined;
}

/**
 * Checks whether an actor has capability to mutate or delete a specific resource.
 * If the actor has management capability (or elevated role/permission), they can mutate any resource.
 * Otherwise, they must possess the required permission AND be an owner/author of the resource.
 */
export function hasResourcePermission(
  requiredPermission: string,
  context: ResourceAuthContext,
): boolean {
  const {
    actorId,
    resourceOwnerId,
    resourceAuthorIds = [],
    userRoles = [],
    userPermissions = [],
  } = context;

  // 1. Owner & Administrator roles possess universal bypass through canonical resolution
  if (userRoles.includes("owner") || userRoles.includes("administrator")) {
    return true;
  }

  // 2. Programmatic/service invocation without explicit RBAC context: enforce direct resource ownership
  if (context.userRoles === undefined && context.userPermissions === undefined) {
    const isDirectOwner =
      resourceOwnerId !== undefined &&
      resourceOwnerId !== null &&
      resourceOwnerId === actorId;
    const isDirectCoAuthor =
      Array.isArray(resourceAuthorIds) && resourceAuthorIds.includes(actorId);
    return isDirectOwner || isDirectCoAuthor;
  }

  // 3. Actor must possess the requested capability (e.g. 'posts.edit', 'posts.delete')
  if (!hasPermission(userPermissions, requiredPermission, userRoles)) {
    return false;
  }

  // 4. Elevated roles or management permissions (e.g. 'editor', 'posts.manage') can mutate any resource
  const domainPrefix = requiredPermission.split(".")[0];
  if (
    userRoles.includes("editor") ||
    userPermissions.includes(`${domainPrefix}.manage`) ||
    userPermissions.includes(`${domainPrefix}.edit.all`) ||
    userPermissions.includes(`${domainPrefix}.delete.all`)
  ) {
    return true;
  }

  // 4. For authors/contributors without management permissions, enforce resource ownership
  const isPrimaryAuthor =
    resourceOwnerId !== undefined &&
    resourceOwnerId !== null &&
    resourceOwnerId === actorId;
  const isCoAuthor = Array.isArray(resourceAuthorIds) && resourceAuthorIds.includes(actorId);

  return isPrimaryAuthor || isCoAuthor;
}
