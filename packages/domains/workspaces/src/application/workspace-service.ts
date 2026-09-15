import {
  Workspace,
  WorkspaceMember,
  Publication,
  PublicationMembership,
  WorkspaceContext,
  TenantContext,
  TenantAccessDeniedError,
  WorkspaceRole,
  PublicationRole,
} from "../domain/workspace";

export interface WorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findBySlug(slug: string): Promise<Workspace | null>;
  create(workspace: Omit<Workspace, "createdAt" | "updatedAt">): Promise<Workspace>;
  addMember(member: Omit<WorkspaceMember, "createdAt" | "updatedAt">): Promise<WorkspaceMember>;
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  listUserWorkspaces(userId: string): Promise<Array<{ workspace: Workspace; role: WorkspaceRole }>>;
}

export interface PublicationRepository {
  findById(id: string): Promise<Publication | null>;
  findBySlug(workspaceId: string, slug: string): Promise<Publication | null>;
  findByDomain(domain: string): Promise<Publication | null>;
  listByWorkspace(workspaceId: string): Promise<Publication[]>;
  create(publication: Omit<Publication, "createdAt" | "updatedAt">): Promise<Publication>;
  addMember(member: Omit<PublicationMembership, "createdAt" | "updatedAt">): Promise<PublicationMembership>;
  getMembership(publicationId: string, userId: string): Promise<PublicationMembership | null>;
  listUserPublications(userId: string): Promise<Array<{ publication: Publication; role: PublicationRole }>>;
}

export class WorkspaceService {
  constructor(
    private repo: WorkspaceRepository,
    private pubRepo?: PublicationRepository,
  ) {}

  async getWorkspaceForUser(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspace: Workspace; role: WorkspaceRole }> {
    const membership = await this.repo.getMembership(workspaceId, userId);
    if (!membership) {
      throw new TenantAccessDeniedError(
        `User ${userId} does not have access to workspace ${workspaceId}`,
      );
    }

    const workspace = await this.repo.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    return { workspace, role: membership.role };
  }

  async switchWorkspace(
    targetWorkspaceId: string,
    userId: string,
  ): Promise<TenantContext> {
    const { workspace, role } = await this.getWorkspaceForUser(
      targetWorkspaceId,
      userId,
    );
    return {
      workspaceId: workspace.id,
      userId,
      role,
    };
  }

  async switchPublication(
    targetPublicationId: string,
    userId: string,
    currentTenant: TenantContext,
  ): Promise<TenantContext> {
    if (!this.pubRepo) {
      return { ...currentTenant, publicationId: targetPublicationId };
    }

    const publication = await this.pubRepo.findById(targetPublicationId);
    if (!publication) {
      throw new Error(`Publication ${targetPublicationId} not found`);
    }

    if (publication.workspaceId !== currentTenant.workspaceId) {
      throw new TenantAccessDeniedError(
        `Publication ${targetPublicationId} belongs to workspace ${publication.workspaceId}, not active workspace ${currentTenant.workspaceId}`,
      );
    }

    const membership = await this.pubRepo.getMembership(targetPublicationId, userId);
    if (!membership && currentTenant.role !== "owner" && currentTenant.role !== "admin") {
      throw new TenantAccessDeniedError(
        `User ${userId} lacks permission to access publication ${targetPublicationId}`,
      );
    }

    return {
      ...currentTenant,
      publicationId: targetPublicationId,
    };
  }

  /**
   * Authoritative server-side resolution of Staff publication context.
   * Client-requested publication ID is strictly verified against memberships.
   */
  async resolveStaffPublicationContext(
    userId: string,
    requestedPublicationId?: string,
    globalUserRoles: string[] = [],
  ): Promise<{
    publicationId: string;
    workspaceId: string;
    actorId: string;
    actorType: "staff";
    role: string;
    isSystemOperation: boolean;
  }> {
    if (!this.pubRepo) {
      return {
        publicationId: requestedPublicationId || "pub_default",
        workspaceId: "ws_default",
        actorId: userId,
        actorType: "staff",
        role: "owner",
        isSystemOperation: false,
      };
    }

    if (requestedPublicationId) {
      const pub = await this.pubRepo.findById(requestedPublicationId);
      if (!pub) {
        throw new TenantAccessDeniedError(
          `Publication ${requestedPublicationId} not found`,
        );
      }

      // Check explicit publication membership
      const membership = await this.pubRepo.getMembership(
        requestedPublicationId,
        userId,
      );
      if (membership) {
        return {
          publicationId: pub.id,
          workspaceId: pub.workspaceId,
          actorId: userId,
          actorType: "staff",
          role: membership.role,
          isSystemOperation: false,
        };
      }

      // Check workspace owner/admin membership
      const wsMembership = await this.repo.getMembership(
        pub.workspaceId,
        userId,
      );
      if (
        wsMembership &&
        (wsMembership.role === "owner" || wsMembership.role === "admin")
      ) {
        return {
          publicationId: pub.id,
          workspaceId: pub.workspaceId,
          actorId: userId,
          actorType: "staff",
          role: wsMembership.role,
          isSystemOperation: false,
        };
      }

      // System owner/admin fallback only for default publication if unassigned
      if (
        globalUserRoles.includes("owner") ||
        globalUserRoles.includes("administrator")
      ) {
        if (pub.id === "pub_default") {
          return {
            publicationId: pub.id,
            workspaceId: pub.workspaceId,
            actorId: userId,
            actorType: "staff",
            role: "owner",
            isSystemOperation: false,
          };
        }
      }

      // Safe rejection: user cannot access requested publication
      throw new TenantAccessDeniedError(
        `User ${userId} lacks permission to access publication ${requestedPublicationId}`,
      );
    }

    // No specific publication requested: resolve user's primary/default publication
    const userPubs = await this.pubRepo.listUserPublications(userId);
    if (userPubs.length > 0 && userPubs[0]) {
      const first = userPubs[0];
      return {
        publicationId: first.publication.id,
        workspaceId: first.publication.workspaceId,
        actorId: userId,
        actorType: "staff",
        role: first.role,
        isSystemOperation: false,
      };
    }

    // Check workspace memberships
    const userWorkspaces = await this.repo.listUserWorkspaces(userId);
    for (const uw of userWorkspaces) {
      const wsPubs = await this.pubRepo.listByWorkspace(uw.workspace.id);
      if (wsPubs.length > 0 && wsPubs[0]) {
        return {
          publicationId: wsPubs[0].id,
          workspaceId: uw.workspace.id,
          actorId: userId,
          actorType: "staff",
          role: uw.role,
          isSystemOperation: false,
        };
      }
    }

    // Default fallback for bootstrap system owner
    const defaultPub = await this.pubRepo.findById("pub_default");
    if (defaultPub) {
      return {
        publicationId: defaultPub.id,
        workspaceId: defaultPub.workspaceId,
        actorId: userId,
        actorType: "staff",
        role: globalUserRoles.includes("owner") ? "owner" : "editor",
        isSystemOperation: false,
      };
    }

    throw new TenantAccessDeniedError(`No active publication found for user ${userId}`);
  }

  /**
   * Authoritative Public Web publication resolution.
   * Hostname -> publication. Unknown hostname -> 404.
   * Fallback to pub_default is permitted ONLY if isDevFallbackAllowed is explicitly true.
   */
  async resolvePublicPublicationContext(params: {
    host?: string | null;
    isDevFallbackAllowed?: boolean;
  }): Promise<{
    publicationId: string;
    workspaceId: string;
    actorType: "public";
    isSystemOperation: boolean;
  }> {
    if (!this.pubRepo) {
      return {
        publicationId: "pub_default",
        workspaceId: "ws_default",
        actorType: "public",
        isSystemOperation: false,
      };
    }

    if (params.host) {
      // Strip port (e.g., example.com:3000 -> example.com)
      const cleanHost = params.host.split(":")[0]?.toLowerCase().trim() || "";
      if (cleanHost && cleanHost !== "localhost" && cleanHost !== "127.0.0.1") {
        const pub = await this.pubRepo.findByDomain(cleanHost);
        if (pub) {
          return {
            publicationId: pub.id,
            workspaceId: pub.workspaceId,
            actorType: "public",
            isSystemOperation: false,
          };
        }
        // Explicit unmapped host must never silently fall back to pub_default
        throw new Error(
          `Publication not found for hostname: ${params.host}`,
        );
      }
    }

    // If host was localhost or not specified:
    if (params.isDevFallbackAllowed) {
      const defaultPub = await this.pubRepo.findById("pub_default");
      if (defaultPub) {
        return {
          publicationId: defaultPub.id,
          workspaceId: defaultPub.workspaceId,
          actorType: "public",
          isSystemOperation: false,
        };
      }
    }

    // In production, unmapped host is a hard 404 (no silent fallback to pub_default)
    throw new Error(
      `Publication not found for hostname: ${params.host || "unknown"}`,
    );
  }

  /**
   * Authoritative Worker/Queue publication resolution.
   * Explicit scope: "publication" requires publicationId; "system" requires explicit declaration.
   */
  async resolveWorkerPublicationContext(params: {
    scope: "publication" | "system";
    publicationId?: string | null;
  }): Promise<{
    publicationId: string;
    workspaceId: string;
    actorType: "worker" | "system";
    isSystemOperation: boolean;
  }> {
    if (params.scope === "system") {
      return {
        publicationId: "system",
        workspaceId: "system",
        actorType: "system",
        isSystemOperation: true,
      };
    }

    if (!params.publicationId) {
      throw new Error(
        "Invalid job: publication-scoped job must provide a publicationId",
      );
    }

    if (this.pubRepo) {
      const pub = await this.pubRepo.findById(params.publicationId);
      if (!pub) {
        throw new Error(
          `Job rejected: target publication ${params.publicationId} does not exist`,
        );
      }
      return {
        publicationId: pub.id,
        workspaceId: pub.workspaceId,
        actorType: "worker",
        isSystemOperation: false,
      };
    }

    return {
      publicationId: params.publicationId,
      workspaceId: "ws_default",
      actorType: "worker",
      isSystemOperation: false,
    };
  }

  /**
   * Asserts that a target entity belongs to the active tenant context.
   */
  assertTenantAccess(
    context: TenantContext,
    targetWorkspaceId: string,
    targetPublicationId?: string,
  ): void {
    if (!context.workspaceId || context.workspaceId !== targetWorkspaceId) {
      throw new TenantAccessDeniedError(
        `Cross-tenant access violation: active workspace is '${context.workspaceId}' but resource belongs to '${targetWorkspaceId}'`,
      );
    }
    if (
      targetPublicationId &&
      context.publicationId &&
      context.publicationId !== targetPublicationId
    ) {
      throw new TenantAccessDeniedError(
        `Cross-publication access violation: active publication is '${context.publicationId}' but resource belongs to '${targetPublicationId}'`,
      );
    }
  }
}

