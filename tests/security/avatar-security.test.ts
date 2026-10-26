import { describe, it, expect } from "vitest";
import {
  MEMBER_AVATAR_KEYS,
  MemberAvatarKeySchema,
  isMemberAvatarKey,
  resolveDeterministicAvatar,
  getAvatarUrl,
} from "@vibress/api-contracts";
import { MemberProfileUpdateSchema } from "@vibress/api-contracts";
import { MembersService } from "@vibress/members";
import type { MemberRepository } from "@vibress/members";

describe("Avatar System Security & Input Validation", () => {
  it("strictly validates allowed avatar keys", () => {
    expect(MEMBER_AVATAR_KEYS.length).toBe(18);

    for (const key of MEMBER_AVATAR_KEYS) {
      expect(isMemberAvatarKey(key)).toBe(true);
      expect(MemberAvatarKeySchema.safeParse(key).success).toBe(true);
      expect(getAvatarUrl(key)).toBe(`/avatars/${key}.svg`);
    }
  });

  it("rejects path traversal, injection, and invalid keys", () => {
    const maliciousPayloads = [
      "../etc/passwd",
      "..\\..\\windows\\system32",
      "%2e%2e%2f",
      "/avatars/atlas.svg",
      "atlas.svg",
      "default\0.svg",
      "<script>alert(1)</script>",
      "atlas; DROP TABLE members;--",
      "__proto__",
      "constructor",
      "",
      "   ",
      "unknown_avatar",
    ];

    for (const payload of maliciousPayloads) {
      expect(isMemberAvatarKey(payload)).toBe(false);
      expect(MemberAvatarKeySchema.safeParse(payload).success).toBe(false);
      // getAvatarUrl must never resolve to an unapproved path or reflect unvalidated input
      const resolved = getAvatarUrl(payload);
      expect(resolved).toBe("/avatars/default.svg");
    }
  });

  it("safely handles deterministic avatar resolution with hostile or empty seeds", () => {
    // Standard seeds
    const res1 = resolveDeterministicAvatar("user1@example.com");
    const res2 = resolveDeterministicAvatar("user1@example.com");
    expect(res1).toBe(res2);
    expect(isMemberAvatarKey(res1)).toBe(true);

    // Hostile seeds must not crash or escape the allowed key set
    const weirdSeeds = [
      "",
      " ",
      "\0\0\0",
      "🚀🔥🎉",
      "A".repeat(10000),
      // @ts-expect-error test runtime robustness
      null,
      // @ts-expect-error test runtime robustness
      undefined,
      // @ts-expect-error test runtime robustness
      12345,
    ];

    for (const seed of weirdSeeds) {
      const key = resolveDeterministicAvatar(seed as string);
      expect(isMemberAvatarKey(key)).toBe(true);
      expect(getAvatarUrl(null, seed as string)).toBe(`/avatars/${key}.svg`);
    }
  });

  it("MemberProfileUpdateSchema enforces avatar validation contract", () => {
    const valid = MemberProfileUpdateSchema.safeParse({
      name: "Alice",
      avatar: "summit",
    });
    expect(valid.success).toBe(true);

    const invalid = MemberProfileUpdateSchema.safeParse({
      name: "Alice",
      avatar: "invalid_key",
    });
    expect(invalid.success).toBe(false);

    // Strips unexpected extra fields
    const withExtra = MemberProfileUpdateSchema.safeParse({
      name: "Alice",
      avatar: "summit",
      role: "admin",
      status: "active",
      publicationId: "pub_hacked",
    });
    expect(withExtra.success).toBe(true);
    // @ts-expect-error checking stripped keys
    expect(withExtra.data?.role).toBeUndefined();
    // @ts-expect-error checking stripped keys
    expect(withExtra.data?.publicationId).toBeUndefined();
  });

  it("MembersService.updateProfile rejects invalid avatars and enforces publication scoping", async () => {
    let capturedPublicationId: string | undefined;
    let capturedUpdateData: Record<string, unknown> | undefined;

    const mockRepo: MemberRepository = {
      create: async () => { throw new Error("not implemented"); },
      findById: async (id: string, pubId?: string) => {
        capturedPublicationId = pubId;
        return {
          id,
          publicationId: "pub_tenant_1",
          email: "member@example.com",
          emailNormalized: "member@example.com",
          name: "Original Name",
          avatar: "default",
          status: "active",
          emailVerifiedAt: new Date(),
          lastSeenAt: null,
          disabledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      findByEmail: async () => null,
      update: async (id: string, data: Record<string, unknown>, pubId?: string) => {
        capturedPublicationId = pubId;
        capturedUpdateData = data;
        return {
          id,
          publicationId: "pub_tenant_1",
          email: "member@example.com",
          emailNormalized: "member@example.com",
          name: (data.name as string) || "Original Name",
          avatar: (data.avatar as string) || "default",
          status: "active",
          emailVerifiedAt: new Date(),
          lastSeenAt: null,
          disabledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      list: async () => ({ members: [], total: 0 }),
      countActiveSessions: async () => 0,
      revokeAllSessions: async () => {},
    };

    const service = new MembersService(mockRepo);

    // 1. Invalid avatar key must throw VALIDATION_ERROR
    await expect(
      service.updateProfile("mem_1", { avatar: "hacked_avatar" }, "pub_tenant_1"),
    ).rejects.toThrow("Invalid avatar key");

    // 2. Valid avatar key updates cleanly and passes publicationId to repository
    const updated = await service.updateProfile(
      "mem_1",
      { name: "New Name", avatar: "summit" },
      "pub_tenant_1",
    );

    expect(updated.avatar).toBe("summit");
    expect(updated.name).toBe("New Name");
    expect(capturedPublicationId).toBe("pub_tenant_1");
    expect(capturedUpdateData?.avatar).toBe("summit");
  });
});
