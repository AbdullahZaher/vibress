import {
  getDb,
  workspaces,
  workspaceMembers,
  publications,
  publicationMemberships,
  eq,
  and,
} from "@vibress/database";
import crypto from "node:crypto";

import {
  Workspace,
  WorkspaceMember,
  Publication,
  PublicationMembership,
  WorkspaceRole,
  PublicationRole,
} from "../domain/workspace";
import {
  WorkspaceRepository,
  PublicationRepository,
} from "../application/workspace-service";

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  async findById(id: string): Promise<Workspace | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      domain: r.domain,
      settings: (r.settings as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      domain: r.domain,
      settings: (r.settings as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async create(
    workspace: Omit<Workspace, "createdAt" | "updatedAt">,
  ): Promise<Workspace> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(workspaces)
      .values({
        id: workspace.id || crypto.randomUUID(),
        name: workspace.name,
        slug: workspace.slug,
        domain: workspace.domain || null,
        settings: workspace.settings || {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert workspace");
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      domain: row.domain,
      settings: (row.settings as Record<string, unknown>) || {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async addMember(
    member: Omit<WorkspaceMember, "createdAt" | "updatedAt">,
  ): Promise<WorkspaceMember> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(workspaceMembers)
      .values({
        id: member.id || crypto.randomUUID(),
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to add workspace member");
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role as WorkspaceRole,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      role: r.role as WorkspaceRole,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      role: r.role as WorkspaceRole,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async listUserWorkspaces(
    userId: string,
  ): Promise<Array<{ workspace: Workspace; role: WorkspaceRole }>> {
    const db = getDb();
    const rows = await db
      .select({
        wm: workspaceMembers,
        w: workspaces,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId));

    return rows.map(({ wm, w }) => ({
      workspace: {
        id: w.id,
        name: w.name,
        slug: w.slug,
        domain: w.domain,
        settings: (w.settings as Record<string, unknown>) || {},
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      },
      role: wm.role as WorkspaceRole,
    }));
  }
}

export class DrizzlePublicationRepository implements PublicationRepository {
  async findById(id: string): Promise<Publication | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      domain: r.domain,
      primaryLocale: r.primaryLocale,
      settings: (r.settings as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findBySlug(
    workspaceId: string,
    slug: string,
  ): Promise<Publication | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.workspaceId, workspaceId),
          eq(publications.slug, slug),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      domain: r.domain,
      primaryLocale: r.primaryLocale,
      settings: (r.settings as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findByDomain(domain: string): Promise<Publication | null> {
    const db = getDb();
    const cleanDomain = domain.toLowerCase().trim();
    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.domain, cleanDomain))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      domain: r.domain,
      primaryLocale: r.primaryLocale,
      settings: (r.settings as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async listByWorkspace(workspaceId: string): Promise<Publication[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.workspaceId, workspaceId));
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      domain: r.domain,
      primaryLocale: r.primaryLocale,
      settings: (r.settings as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async create(
    publication: Omit<Publication, "createdAt" | "updatedAt">,
  ): Promise<Publication> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(publications)
      .values({
        id: publication.id || crypto.randomUUID(),
        workspaceId: publication.workspaceId,
        name: publication.name,
        slug: publication.slug,
        description: publication.description || null,
        domain: publication.domain || null,
        primaryLocale: publication.primaryLocale || "en",
        settings: publication.settings || {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert publication");
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      domain: row.domain,
      primaryLocale: row.primaryLocale,
      settings: (row.settings as Record<string, unknown>) || {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async addMember(
    member: Omit<PublicationMembership, "createdAt" | "updatedAt">,
  ): Promise<PublicationMembership> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(publicationMemberships)
      .values({
        id: member.id || crypto.randomUUID(),
        publicationId: member.publicationId,
        userId: member.userId,
        role: member.role,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to add publication member");
    return {
      id: row.id,
      publicationId: row.publicationId,
      userId: row.userId,
      role: row.role as PublicationRole,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getMembership(
    publicationId: string,
    userId: string,
  ): Promise<PublicationMembership | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(publicationMemberships)
      .where(
        and(
          eq(publicationMemberships.publicationId, publicationId),
          eq(publicationMemberships.userId, userId),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      publicationId: r.publicationId,
      userId: r.userId,
      role: r.role as PublicationRole,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async listUserPublications(
    userId: string,
  ): Promise<Array<{ publication: Publication; role: PublicationRole }>> {
    const db = getDb();
    const rows = await db
      .select({
        pm: publicationMemberships,
        p: publications,
      })
      .from(publicationMemberships)
      .innerJoin(
        publications,
        eq(publicationMemberships.publicationId, publications.id),
      )
      .where(eq(publicationMemberships.userId, userId));

    return rows.map(({ pm, p }) => ({
      publication: {
        id: p.id,
        workspaceId: p.workspaceId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        domain: p.domain,
        primaryLocale: p.primaryLocale,
        settings: (p.settings as Record<string, unknown>) || {},
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
      role: pm.role as PublicationRole,
    }));
  }
}
