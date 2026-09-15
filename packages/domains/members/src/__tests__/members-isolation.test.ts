import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications } from "@vibress/database";
import { DrizzleMemberRepository } from "../infrastructure/drizzle-member-repository";
import { MembersService, MemberNotFoundError } from "../application/members-service";

describe("Members Multi-Publication Isolation", () => {
  let memberRepo: DrizzleMemberRepository;
  let membersService: MembersService;

  const mockSessionRepo = {
    create: async () => {},
    findByTokenHash: async () => null,
    revoke: async () => {},
    revokeAllForMember: async () => 1,
    deleteExpired: async () => 0,
  } as any;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();
  });

  beforeEach(() => {
    memberRepo = new DrizzleMemberRepository();
    membersService = new MembersService(memberRepo, mockSessionRepo);
  });

  it("permits identical member emails across distinct publications (Same-email requirement)", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";
    const commonEmail = "subscriber@example.com";

    const memberA = await membersService.createMember({
      email: commonEmail,
      name: "Subscriber Alpha",
      publicationId: pubA,
    });

    const memberB = await membersService.createMember({
      email: commonEmail,
      name: "Subscriber Beta",
      publicationId: pubB,
    });

    expect(memberA.publicationId).toBe(pubA);
    expect(memberB.publicationId).toBe(pubB);
    expect(memberA.emailNormalized).toBe("subscriber@example.com");
    expect(memberB.emailNormalized).toBe("subscriber@example.com");
    expect(memberA.id).not.toBe(memberB.id);

    // Lookups are publication-scoped
    const foundA = await membersService.findByEmail(commonEmail, pubA);
    const foundB = await membersService.findByEmail(commonEmail, pubB);

    expect(foundA?.id).toBe(memberA.id);
    expect(foundB?.id).toBe(memberB.id);
  });

  it("denies cross-publication read via non-disclosing null/404", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const memberA = await membersService.createMember({
      email: "secret.member@example.com",
      publicationId: pubA,
    });

    const foundFromB = await membersService.findById(memberA.id, pubB);
    expect(foundFromB).toBeNull();
  });

  it("denies cross-publication updates and disablement", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const memberA = await membersService.createMember({
      email: "victim@example.com",
      name: "Victim Original",
      publicationId: pubA,
    });

    await expect(
      membersService.updateProfile(memberA.id, { name: "Attacker Edit" }, pubB),
    ).rejects.toThrow(MemberNotFoundError);

    await expect(
      membersService.disableMember(memberA.id, "usr_attacker", pubB),
    ).rejects.toThrow(MemberNotFoundError);

    const intactA = await membersService.findById(memberA.id, pubA);
    expect(intactA?.name).toBe("Victim Original");
    expect(intactA?.status).toBe("active");
  });

  it("filters member listings strictly by publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    await membersService.createMember({
      email: "list.a@example.com",
      publicationId: pubA,
    });
    await membersService.createMember({
      email: "list.b@example.com",
      publicationId: pubB,
    });

    const listA = await membersService.listMembers({ publicationId: pubA });
    const listB = await membersService.listMembers({ publicationId: pubB });

    expect(listA.members.every((m) => m.publicationId === pubA)).toBe(true);
    expect(listB.members.every((m) => m.publicationId === pubB)).toBe(true);
  });
});
