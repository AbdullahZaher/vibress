import { describe, it, expect } from "vitest";
import {
  workspaces,
  workspaceMembers,
} from "../index";

describe("Multi-Publication Workspaces Schema", () => {
  it("defines workspaces table with slug and domain columns", () => {
    expect(workspaces.id).toBeDefined();
    expect(workspaces.name).toBeDefined();
    expect(workspaces.slug).toBeDefined();
    expect(workspaces.domain).toBeDefined();
    expect(workspaces.settings).toBeDefined();
  });

  it("defines workspace_members table with role and user references", () => {
    expect(workspaceMembers.id).toBeDefined();
    expect(workspaceMembers.workspaceId).toBeDefined();
    expect(workspaceMembers.userId).toBeDefined();
    expect(workspaceMembers.role).toBeDefined();
  });
});
