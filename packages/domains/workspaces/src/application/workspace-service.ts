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
