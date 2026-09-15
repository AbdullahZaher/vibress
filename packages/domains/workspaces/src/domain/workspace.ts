export interface Workspace {
  id: string;
  name: string;
  slug: string;
  domain?: string | null | undefined;
  settings?: Record<string, unknown> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceRole = "owner" | "admin" | "editor" | "author" | "contributor";
export type PublicationRole = "owner" | "admin" | "editor" | "author" | "contributor";

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface Publication {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null | undefined;
  domain?: string | null | undefined;
  primaryLocale: string;
  settings?: Record<string, unknown> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicationMembership {
  id: string;
  publicationId: string;
  userId: string;
  role: PublicationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantContext {
  workspaceId: string;
  publicationId?: string | undefined;
  userId?: string | undefined;
  role?: WorkspaceRole | undefined;
}

export interface WorkspaceContext extends TenantContext {
  workspaceSlug?: string | undefined;
}

export class TenantAccessDeniedError extends Error {
  code = "TENANT_ACCESS_DENIED";
  constructor(message = "Access denied: cross-tenant operation prohibited") {
    super(message);
    this.name = "TenantAccessDeniedError";
  }
}

export class PublicationNotFoundError extends Error {
  code = "PUBLICATION_NOT_FOUND";
  constructor(message = "Publication not found") {
    super(message);
    this.name = "PublicationNotFoundError";
  }
}

export type { ActorType, PublicationContext } from "@vibress/security";

