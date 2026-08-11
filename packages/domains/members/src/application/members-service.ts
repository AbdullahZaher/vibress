import { MemberRepository, MemberSessionRepository } from '../domain/repository';
import { Member, UpdateMemberData, ListMembersFilter, normalizeMemberEmail } from '../domain/member';
import { domainEvents } from '@vibress/events';
import { runInTransaction } from '@vibress/database';

export class MemberNotFoundError extends Error {
  code = 'MEMBER_NOT_FOUND';
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
    private sessionRepo: MemberSessionRepository
  ) {}

  async findById(id: string): Promise<Member | null> {
    return this.memberRepo.findById(id);
  }

  async findByEmail(email: string): Promise<Member | null> {
    return this.memberRepo.findByEmailNormalized(normalizeMemberEmail(email));
  }

  async updateProfile(memberId: string, data: { name?: string | null | undefined }): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new MemberNotFoundError();

    const update: UpdateMemberData = {};
    if (data.name !== undefined) {
      const name = typeof data.name === 'string' ? data.name.trim() : null;
      if (name && name.length > 200) {
        throw new MemberStateError('VALIDATION_ERROR', 'Name is too long');
      }
      if (name && name.split('').some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
        throw new MemberStateError('VALIDATION_ERROR', 'Name contains invalid characters');
      }
      update.name = name;
    }

    const updated = await this.memberRepo.update(memberId, update);
    domainEvents.emit('member.profile.updated', { memberId });
    return updated;
  }

  async disableMember(memberId: string, actorId: string | null): Promise<Member> {
    return runInTransaction(() => this.disableMemberTx(memberId, actorId));
  }

  private async disableMemberTx(memberId: string, actorId: string | null): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new MemberNotFoundError();
    if (member.status === 'disabled') {
      throw new MemberStateError('MEMBER_ALREADY_DISABLED', 'Member is already disabled');
    }

    const now = new Date();
    const updated = await this.memberRepo.update(memberId, {
      status: 'disabled',
      disabledAt: now,
    });

    // Disable → revoke active sessions (race-safe: future validations fail on status).
    await this.sessionRepo.revokeAllForMember(memberId);

    domainEvents.emit('member.disabled', { memberId, actorId });
    return updated;
  }

  async enableMember(memberId: string, actorId: string | null): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new MemberNotFoundError();
    if (member.status === 'active') {
      throw new MemberStateError('MEMBER_ALREADY_ACTIVE', 'Member is already active');
    }

    const updated = await this.memberRepo.update(memberId, {
      status: 'active',
      disabledAt: null,
    });

    domainEvents.emit('member.enabled', { memberId, actorId });
    return updated;
  }

  async listMembers(filter?: ListMembersFilter): Promise<{ members: Member[]; total: number }> {
    return this.memberRepo.list(filter);
  }

  async countActiveSessions(memberId: string): Promise<number> {
    return this.memberRepo.countActiveSessions(memberId);
  }

  async revokeAllSessionsForMember(memberId: string): Promise<number> {
    return this.sessionRepo.revokeAllForMember(memberId);
  }
}
