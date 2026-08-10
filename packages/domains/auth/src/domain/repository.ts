import { Session, CreateSessionData } from './session';

export interface SessionRepository {
  createSession(data: CreateSessionData): Promise<Session>;
  findActiveSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
  updateLastSeen(sessionId: string): Promise<void>;
}
