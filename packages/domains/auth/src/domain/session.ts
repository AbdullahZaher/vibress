export class AuthDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthDomainError";
    this.code = code;
  }
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateSessionData {
  id?: string | undefined;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}
