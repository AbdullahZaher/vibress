import {
  Member,
  CreateMemberData,
  UpdateMemberData,
  ListMembersFilter,
} from './member';
import {
  MemberAuthToken,
  CreateMemberAuthTokenData,
  MemberSession,
  CreateMemberSessionData,
} from './auth';

export interface MemberRepository {
  create(data: CreateMemberData): Promise<Member>;
  findById(id: string): Promise<Member | null>;
  findByEmailNormalized(emailNormalized: string): Promise<Member | null>;
  update(id: string, data: UpdateMemberData): Promise<Member>;
  list(filter?: ListMembersFilter): Promise<{ members: Member[]; total: number }>;
  countActiveSessions(memberId: string): Promise<number>;
}

export interface MemberAuthTokenRepository {
  create(data: CreateMemberAuthTokenData): Promise<MemberAuthToken>;
  findByTokenHash(tokenHash: string): Promise<MemberAuthToken | null>;
  invalidateForMember(memberId: string, purpose: string): Promise<void>;
  markUsed(tokenId: string, usedAt: Date): Promise<boolean>;
  deleteExpired(now?: Date): Promise<number>;
}

export interface MemberSessionRepository {
  create(data: CreateMemberSessionData): Promise<MemberSession>;
  findByTokenHash(tokenHash: string): Promise<MemberSession | null>;
  revoke(sessionId: string): Promise<void>;
  revokeAllForMember(memberId: string): Promise<number>;
  deleteExpired(now?: Date): Promise<number>;
}
