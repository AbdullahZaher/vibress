export type ActorType = "staff" | "member" | "system" | "worker" | "public";

export interface PublicationContext {
  publicationId: string;
  workspaceId: string;
  actorId?: string | null;
  actorType: ActorType;
  role?: string | null;
  permissions?: string[];
  isSystemOperation?: boolean;
}

export class PublicationAccessDeniedError extends Error {
  code = "PUBLICATION_ACCESS_DENIED";
  constructor(message = "Access denied: cross-publication operation prohibited") {
    super(message);
    this.name = "PublicationAccessDeniedError";
  }
}

export function assertPublicationAccess(
  context: PublicationContext,
  targetPublicationId: string,
): void {
  if (context.isSystemOperation) {
    return;
  }
  if (!context.publicationId || context.publicationId !== targetPublicationId) {
    throw new PublicationAccessDeniedError(
      `Cross-publication access violation: active publication is '${context.publicationId}' but target resource is '${targetPublicationId}'`,
    );
  }
}

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
  /** Active publication context of the actor */
  publicationId?: string | null | undefined;
  /** Publication owning the target resource */
  resourcePublicationId?: string | null | undefined;
  isSystemOperation?: boolean | undefined;
}

/**
 * Checks whether an actor has capability to mutate or delete a specific resource.
 * Enforces strict publication isolation: cross-publication access is rejected regardless of role.
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
    publicationId,
    resourcePublicationId,
    isSystemOperation = false,
  } = context;

  // 0. Hard tenant boundary: if both publication identities are present and mismatch, reject unless system operation
  if (
    !isSystemOperation &&
    publicationId &&
    resourcePublicationId &&
    publicationId !== resourcePublicationId
  ) {
    return false;
  }

  // 1. Owner & Administrator roles possess bypass only WITHIN the authorized publication
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

  // 4. Elevated roles or management permissions (e.g. 'editor', 'posts.manage') can mutate any resource within tenant
  const domainPrefix = requiredPermission.split(".")[0];
  if (
    userRoles.includes("editor") ||
    userPermissions.includes(`${domainPrefix}.manage`) ||
    userPermissions.includes(`${domainPrefix}.edit.all`) ||
    userPermissions.includes(`${domainPrefix}.delete.all`)
  ) {
    return true;
  }

  // 5. For authors/contributors without management permissions, enforce resource ownership
  const isPrimaryAuthor =
    resourceOwnerId !== undefined &&
    resourceOwnerId !== null &&
    resourceOwnerId === actorId;
  const isCoAuthor = Array.isArray(resourceAuthorIds) && resourceAuthorIds.includes(actorId);

  return isPrimaryAuthor || isCoAuthor;
}

