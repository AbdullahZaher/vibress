import { describe, it, expect } from "vitest";
import {
  WorkspaceService,
  WorkspaceRepository,
  TenantAccessDeniedError,
  Workspace,
  WorkspaceMember,
} from "../index";

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private workspaces = new Map<string, Workspace>();
  private members = new Map<string, WorkspaceMember>();

  async findById(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) || null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    for (const w of this.workspaces.values()) {
      if (w.slug === slug) return w;
    }
    return null;
  }

  async create(workspace: Omit<Workspace, "createdAt" | "updatedAt">): Promise<Workspace> {
    const now = new Date();
    const created: Workspace = { ...workspace, createdAt: now, updatedAt: now };
    this.workspaces.set(workspace.id, created);
    return created;
  }

  async addMember(member: Omit<WorkspaceMember, "createdAt" | "updatedAt">): Promise<WorkspaceMember> {
    const now = new Date();
    const created: WorkspaceMember = { ...member, createdAt: now, updatedAt: now };
    this.members.set(`${member.workspaceId}:${member.userId}`, created);
    return created;
  }

  async getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.members.get(`${workspaceId}:${userId}`) || null;
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return Array.from(this.members.values()).filter((m) => m.workspaceId === workspaceId);
  }
}

describe("Multi-Publication Workspaces & Cross-Tenant Isolation", () => {
  it("grants authorized access to workspace members with their designated role", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repo);

    await repo.create({
      id: "ws_tech",
      name: "Tech Journal",
      slug: "tech-journal",
    });

    await repo.addMember({
      id: "mem_1",
      workspaceId: "ws_tech",
      userId: "user_alice",
      role: "owner",
    });

    const result = await service.getWorkspaceForUser("ws_tech", "user_alice");
    expect(result.workspace.name).toBe("Tech Journal");
    expect(result.role).toBe("owner");
  });

  it("denies access to non-members attempting to access a different workspace", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repo);

    await repo.create({
      id: "ws_finance",
      name: "Finance Weekly",
      slug: "finance-weekly",
    });

    await expect(
      service.getWorkspaceForUser("ws_finance", "user_intruder"),
    ).rejects.toThrow(TenantAccessDeniedError);
  });

  it("prohibits cross-tenant data operations when context tenant mismatch is detected", () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());

    const activeContext = {
      workspaceId: "ws_publication_a",
      userId: "user_bob",
    };

    // Valid tenant operation
    expect(() =>
      service.assertTenantAccess(activeContext, "ws_publication_a"),
    ).not.toThrow();

    expect(() =>
      service.assertTenantAccess(activeContext, "ws_publication_b"),
    ).toThrow(TenantAccessDeniedError);
  });

  it("switches workspaces and verifies publication tenant boundary isolation", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repo);

    await repo.create({ id: "ws_alpha", name: "Alpha Publications", slug: "alpha" });
    await repo.addMember({ id: "mem_a", workspaceId: "ws_alpha", userId: "user_multi", role: "admin" });

    await repo.create({ id: "ws_beta", name: "Beta Publications", slug: "beta" });
    await repo.addMember({ id: "mem_b", workspaceId: "ws_beta", userId: "user_multi", role: "editor" });

    // Switch to Alpha
    const tenantAlpha = await service.switchWorkspace("ws_alpha", "user_multi");
    expect(tenantAlpha.workspaceId).toBe("ws_alpha");
    expect(tenantAlpha.role).toBe("admin");

    // Switch to Beta
    const tenantBeta = await service.switchWorkspace("ws_beta", "user_multi");
    expect(tenantBeta.workspaceId).toBe("ws_beta");
    expect(tenantBeta.role).toBe("editor");

    // Cross-tenant asserts on publications
    expect(() =>
      service.assertTenantAccess(
        { workspaceId: "ws_alpha", publicationId: "pub_1" },
        "ws_alpha",
        "pub_1",
      ),
    ).not.toThrow();

    // Mismatched publication under same workspace
    expect(() =>
      service.assertTenantAccess(
        { workspaceId: "ws_alpha", publicationId: "pub_1" },
        "ws_alpha",
        "pub_2",
      ),
    ).toThrow(TenantAccessDeniedError);

    // Mismatched workspace
    expect(() =>
      service.assertTenantAccess(
        { workspaceId: "ws_alpha", publicationId: "pub_1" },
        "ws_beta",
        "pub_1",
      ),
    ).toThrow(TenantAccessDeniedError);
  });
});
