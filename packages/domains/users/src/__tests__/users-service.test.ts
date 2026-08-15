import { describe, it, expect, vi } from "vitest";
import { UsersService } from "../application/users-service";
import { UserRepository } from "../domain/repository";
import { normalizeEmail } from "../domain/user";

describe("Email Normalization", () => {
  it("normalizes email correctly", () => {
    expect(normalizeEmail("  OWNER@Example.COM  ")).toBe("owner@example.com");
    expect(normalizeEmail("User.Name@Domain.Org")).toBe("user.name@domain.org");
  });
});

describe("UsersService Invariants", () => {
  it("prevents disabling the last active owner", async () => {
    const mockRepo: UserRepository = {
      findById: vi.fn().mockResolvedValue({
        id: "owner-1",
        email: "owner@example.com",
        name: "Owner",
        passwordHash: "hash",
        status: "active",
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
      findByEmail: vi.fn(),
      findBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      listAll: vi.fn(),
      countActiveOwners: vi.fn().mockResolvedValue(1), // Only 1 active owner
    };

    const service = new UsersService(mockRepo);

    await expect(service.disableUser("owner-1")).rejects.toThrow(
      "Cannot disable the last active owner",
    );
  });
});
