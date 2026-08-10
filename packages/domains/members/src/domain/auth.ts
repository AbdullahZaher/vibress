export interface MemberAuthToken {
  id: string;
  memberId: string;
  tokenHash: string;
  purpose: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface CreateMemberAuthTokenData {
  id?: string | undefined;
  memberId: string;
  tokenHash: string;
  purpose?: string | undefined;
  expiresAt: Date;
  userAgent?: string | null | undefined;
  ipAddress?: string | null | undefined;
}

export interface MemberSession {
  id: string;
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface CreateMemberSessionData {
  id?: string | undefined;
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null | undefined;
  ipAddress?: string | null | undefined;
}
