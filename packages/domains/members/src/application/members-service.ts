import {
  MemberRepository,
  MemberSessionRepository,
} from "../domain/repository";
import {
  Member,
  UpdateMemberData,
  ListMembersFilter,
  normalizeMemberEmail,
} from "../domain/member";
import { domainEvents } from "@vibress/events";
import { runInTransaction } from "@vibress/database";

export class MemberNotFoundError extends Error {
  code = "MEMBER_NOT_FOUND";
}

export class MemberStateError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class MembersService {
  constructor(
    private memberRepo: MemberRepository,
    private sessionRepo: MemberSessionRepository,
  ) {}

  async findById(id: string, publicationId?: string): Promise<Member | null> {
    return this.memberRepo.findById(id, publicationId);
  }

  async findByEmail(email: string, publicationId?: string): Promise<Member | null> {
    return this.memberRepo.findByEmailNormalized(normalizeMemberEmail(email), publicationId);
  }

  async createMember(
    data: { email: string; name?: string | null | undefined; publicationId?: string },
  ): Promise<Member> {
    const emailNormalized = normalizeMemberEmail(data.email);
    return this.memberRepo.create({
      email: data.email,
      emailNormalized,
      name: data.name,
      publicationId: data.publicationId || "pub_default",
      status: "active",
    });
  }

  async updateProfile(
    memberId: string,
    data: { name?: string | null | undefined },
    publicationId?: string,
  ): Promise<Member> {
    const member = await this.memberRepo.findById(memberId, publicationId);
    if (!member) throw new MemberNotFoundError();

    const update: UpdateMemberData = {};
    if (data.name !== undefined) {
      const name = typeof data.name === "string" ? data.name.trim() : null;
      if (name && name.length > 200) {
        throw new MemberStateError("VALIDATION_ERROR", "Name is too long");
      }
      if (
        name &&
        name
          .split("")
          .some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
      ) {
        throw new MemberStateError(
          "VALIDATION_ERROR",
          "Name contains invalid characters",
        );
      }
      update.name = name;
    }

    const updated = await this.memberRepo.update(memberId, update, publicationId);
    domainEvents.emit("member.profile.updated", { memberId });
    return updated;
  }

  async disableMember(
    memberId: string,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Member> {
    return runInTransaction(() => this.disableMemberTx(memberId, actorId, publicationId));
  }

  private async disableMemberTx(
    memberId: string,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Member> {
    const member = await this.memberRepo.findById(memberId, publicationId);
    if (!member) throw new MemberNotFoundError();
    if (member.status === "disabled") {
      throw new MemberStateError(
        "MEMBER_ALREADY_DISABLED",
        "Member is already disabled",
      );
    }

    const now = new Date();
    const updated = await this.memberRepo.update(memberId, {
      status: "disabled",
      disabledAt: now,
    }, publicationId);

    // Disable → revoke active sessions (race-safe: future validations fail on status).
    await this.sessionRepo.revokeAllForMember(memberId);

    domainEvents.emit("member.disabled", { memberId, actorId });
    return updated;
  }

  async enableMember(
    memberId: string,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Member> {
    const member = await this.memberRepo.findById(memberId, publicationId);
    if (!member) throw new MemberNotFoundError();
    if (member.status === "active") {
      throw new MemberStateError(
        "MEMBER_ALREADY_ACTIVE",
        "Member is already active",
      );
    }

    const updated = await this.memberRepo.update(memberId, {
      status: "active",
      disabledAt: null,
    }, publicationId);

    domainEvents.emit("member.enabled", { memberId, actorId });
    return updated;
  }

  async listMembers(
    filter?: ListMembersFilter,
  ): Promise<{ members: Member[]; total: number }> {
    return this.memberRepo.list(filter);
  }

  async countActiveSessions(memberId: string): Promise<number> {
    return this.memberRepo.countActiveSessions(memberId);
  }

  async revokeAllSessionsForMember(memberId: string): Promise<number> {
    return this.sessionRepo.revokeAllForMember(memberId);
  }
}
