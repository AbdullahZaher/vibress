import { SessionRepository } from '../domain/repository';
import { UserRepository, normalizeEmail } from '@vibress/users';
import { RoleRepository } from '@vibress/roles';
import { PermissionRepository } from '@vibress/permissions';
import { AuditRepository } from '@vibress/audit';
import {
  hashToken,
  generateOpaqueToken,
  verifyPassword,
  dummyVerifyPassword,
} from '@vibress/security';
import { Session, AuthDomainError } from '../domain/session';

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export class AuthService {
  constructor(
    private sessionRepo: SessionRepository,
    private userRepo: UserRepository,
    private roleRepo: RoleRepository,
    private permRepo: PermissionRepository,
    private auditRepo: AuditRepository,
    private sessionTtlDays = 7
  ) {}

  async loginStaff(
    emailInput: string,
    passwordInput: string,
    context: RequestContext = {}
  ) {
    const normalizedEmail = normalizeEmail(emailInput);
    const user = await this.userRepo.findByEmail(normalizedEmail);

    const ipAddress = context.ipAddress ?? null;
    const userAgent = context.userAgent ?? null;
    const requestId = context.requestId ?? null;

    if (!user) {
      await dummyVerifyPassword();
      await this.auditRepo.record({
        action: 'auth.login.failed',
        ipAddress,
        userAgent,
        requestId,
        metadata: { email: normalizedEmail, reason: 'user_not_found' },
      });
      throw new AuthDomainError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const isValidPassword = await verifyPassword(user.passwordHash, passwordInput);
    if (!isValidPassword) {
      await this.auditRepo.record({
        actorUserId: user.id,
        action: 'auth.login.failed',
        ipAddress,
        userAgent,
        requestId,
        metadata: { email: normalizedEmail, reason: 'invalid_password' },
      });
      throw new AuthDomainError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    if (user.status === 'disabled') {
      await this.auditRepo.record({
        actorUserId: user.id,
        action: 'auth.login.failed',
        ipAddress,
        userAgent,
        requestId,
        metadata: { email: normalizedEmail, reason: 'user_disabled' },
      });
      throw new AuthDomainError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const sessionToken = generateOpaqueToken();
    const tokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1000);

    const session = await this.sessionRepo.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress,
      userAgent,
    });

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });

    await this.auditRepo.record({
      actorUserId: user.id,
      action: 'auth.login.succeeded',
      ipAddress,
      userAgent,
      requestId,
      metadata: { sessionId: session.id },
    });

    const roles = await this.roleRepo.getUserRoleKeys(user.id);
    const permissions = await this.permRepo.getUserPermissionKeys(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        slug: user.slug ?? null,
        status: user.status,
      },
      sessionToken,
      session,
      roles,
      permissions,
    };
  }

  async logoutStaff(sessionToken: string, context: RequestContext = {}) {
    if (!sessionToken) return;
    const tokenHash = hashToken(sessionToken);
    const session = await this.sessionRepo.findActiveSessionByTokenHash(tokenHash);

    if (session) {
      await this.sessionRepo.revokeSession(session.id);
      await this.auditRepo.record({
        actorUserId: session.userId,
        action: 'auth.logout',
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
        metadata: { sessionId: session.id },
      });
    }
  }

  async resolveSession(sessionToken: string) {
    if (!sessionToken) return null;
    const tokenHash = hashToken(sessionToken);
    const session = await this.sessionRepo.findActiveSessionByTokenHash(tokenHash);

    if (!session) return null;

    const user = await this.userRepo.findById(session.userId);
    if (!user || user.status === 'disabled' || user.deletedAt) {
      return null;
    }

    const roles = await this.roleRepo.getUserRoleKeys(user.id);
    const permissions = await this.permRepo.getUserPermissionKeys(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        slug: user.slug ?? null,
        status: user.status,
      },
      roles,
      permissions,
      session,
    };
  }

  async revokeSession(sessionId: string, actorUserId?: string) {
    await this.sessionRepo.revokeSession(sessionId);
    await this.auditRepo.record({
      actorUserId: actorUserId || null,
      action: 'auth.session.revoked',
      metadata: { sessionId },
    });
  }

  async revokeAllUserSessions(userId: string, actorUserId?: string) {
    await this.sessionRepo.revokeAllUserSessions(userId);
    await this.auditRepo.record({
      actorUserId: actorUserId || null,
      action: 'auth.sessions.revoked_all',
      targetType: 'user',
      targetId: userId,
    });
  }
}
