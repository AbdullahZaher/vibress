export type MemberStatus = 'active' | 'disabled';

export interface Member {
  id: string;
  email: string;
  emailNormalized: string;
  name: string | null;
  status: MemberStatus;
  emailVerifiedAt: Date | null;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemberData {
  id?: string | undefined;
  email: string;
  emailNormalized: string;
  name?: string | null | undefined;
  status?: MemberStatus | undefined;
  emailVerifiedAt?: Date | null | undefined;
}

export interface UpdateMemberData {
  name?: string | null | undefined;
  status?: MemberStatus | undefined;
  emailVerifiedAt?: Date | null | undefined;
  lastSeenAt?: Date | null | undefined;
  disabledAt?: Date | null | undefined;
}

export interface ListMembersFilter {
  search?: string | undefined;
  status?: MemberStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function normalizeMemberEmail(email: string): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}
