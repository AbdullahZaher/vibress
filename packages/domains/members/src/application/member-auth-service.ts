import {
  MemberRepository,
  MemberAuthTokenRepository,
  MemberSessionRepository,
} from "../domain/repository";
import { Member, normalizeMemberEmail } from "../domain/member";
import { MemberAuthMailer } from "../domain/mailer";
import { generateOpaqueToken, hashToken } from "@vibress/security";
import { domainEvents } from "@vibress/events";
import { runInTransaction } from "@vibress/database";
import { getConfig } from "@vibress/config";
import crypto from "node:crypto";

export interface MemberAuthContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string;
}

export class MemberAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemberAuthError";
    this.code = code;
  }
}

const AUTH_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface RequestAuthLinkResult {
  sent: boolean;
  memberId?: string;
}

export class MemberAuthService {
  constructor(
    private memberRepo: MemberRepository,
    private tokenRepo: MemberAuthTokenRepository,
    private sessionRepo: MemberSessionRepository,
    private mailer: MemberAuthMailer,
    private signupEnabled: () => boolean = () => true,
  ) {}

  async requestAuthLink(
    emailInput: string,
    context: MemberAuthContext = {},
    publicationId?: string,
  ): Promise<RequestAuthLinkResult> {
    const emailNormalized = normalizeMemberEmail(emailInput);
    if (!emailNormalized) {
      throw new MemberAuthError(
        "VALIDATION_ERROR",
        "A valid email is required",
      );
    }

    const pubId = publicationId || "pub_default";
    let member = await this.memberRepo.findByEmailNormalized(emailNormalized, pubId);

    if (!member) {
      if (!this.signupEnabled()) {
        // Signup disabled: same external behavior, but no account is created.
        return { sent: false };
      }
      member = await this.memberRepo.create({
        email: emailInput.trim(),
        emailNormalized,
        publicationId: pubId,
        status: "active",
        emailVerifiedAt: null,
      });
      domainEvents.emit("member.created", {
        memberId: member.id,
        emailNormalized,
        publicationId: pubId,
      });
    }

    if (member.status === "disabled") {
      // Do not issue usable tokens for disabled members; keep external behavior generic.
      return { sent: false, memberId: member.id };
    }

    // Latest valid token wins: invalidate previous outstanding tokens.
    await this.tokenRepo.invalidateForMember(member.id, "authenticate");

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MS);

    await this.tokenRepo.create({
      memberId: member.id,
      tokenHash,
      purpose: "authenticate",
      expiresAt,
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null,
    });

    const magicLinkUrl = this.buildMagicLinkUrl(rawToken);
    domainEvents.emit("member.auth.requested", {
      memberId: member.id,
      requestId: context.requestId,
    });

    try {
      await this.mailer.sendMagicLink({
        to: member.email,
        magicLinkUrl,
        expiresInMinutes: AUTH_TOKEN_TTL_MS / 60000,
      });
    } catch {
      // Mail delivery failure: keep the short-lived token but report failure safely.
      domainEvents.emit("member.auth.mail_failed", {
        memberId: member.id,
        requestId: context.requestId,
      });
      throw new MemberAuthError(
        "MAIL_DELIVERY_FAILED",
        "Unable to send sign-in email",
      );
    }

    return { sent: true, memberId: member.id };
  }

  async verifyAndCreateSession(
    rawToken: string,
    context: MemberAuthContext = {},
  ): Promise<{
    member: Member;
    sessionToken: string;
    sessionExpiresAt: Date;
  }> {
    return runInTransaction(() =>
      this.verifyAndCreateSessionTx(rawToken, context),
    );
  }

  private async verifyAndCreateSessionTx(
    rawToken: string,
    context: MemberAuthContext = {},
  ): Promise<{
    member: Member;
    sessionToken: string;
    sessionExpiresAt: Date;
  }> {
    if (!rawToken) {
      throw new MemberAuthError(
        "AUTH_TOKEN_INVALID",
        "Invalid or missing token",
      );
    }

    const tokenHash = hashToken(rawToken);
    const token = await this.tokenRepo.findByTokenHash(tokenHash);

    if (!token) {
      throw new MemberAuthError(
        "AUTH_TOKEN_INVALID",
        "Invalid or missing token",
      );
    }
    if (token.usedAt) {
      throw new MemberAuthError(
        "AUTH_TOKEN_USED",
        "This sign-in link has already been used",
      );
    }
    if (token.expiresAt.getTime() < Date.now()) {
      throw new MemberAuthError(
        "AUTH_TOKEN_EXPIRED",
        "This sign-in link has expired",
      );
    }

    // Race-safe single-use consumption (atomic compare-and-set on usedAt).
    const consumed = await this.tokenRepo.markUsed(token.id, new Date());
    if (!consumed) {
      throw new MemberAuthError(
        "AUTH_TOKEN_USED",
        "This sign-in link has already been used",
      );
    }

    const member = await this.memberRepo.findById(token.memberId);
    if (!member) {
      throw new MemberAuthError(
        "AUTH_TOKEN_INVALID",
        "Invalid or missing token",
      );
    }
    if (member.status === "disabled") {
      throw new MemberAuthError("MEMBER_DISABLED", "This account is disabled");
    }

    let verifiedMember = member;
    if (!member.emailVerifiedAt) {
      verifiedMember = await this.memberRepo.update(member.id, {
        emailVerifiedAt: new Date(),
      });
      domainEvents.emit("member.email_verified", { memberId: member.id });
    }

    // Create fresh opaque session token.
    const sessionToken = generateOpaqueToken();
    const sessionTokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessionRepo.create({
      memberId: member.id,
      tokenHash: sessionTokenHash,
      expiresAt,
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null,
    });

    domainEvents.emit("member.authenticated", { memberId: member.id });

    return {
      member: verifiedMember,
      sessionToken,
      sessionExpiresAt: expiresAt,
    };
  }

  async resolveSession(rawSessionToken: string): Promise<Member | null> {
    if (!rawSessionToken) return null;
    const tokenHash = hashToken(rawSessionToken);
    const session = await this.sessionRepo.findByTokenHash(tokenHash);

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;

    const member = await this.memberRepo.findById(session.memberId);
    if (!member) return null;
    if (member.status === "disabled") return null;

    return member;
  }

  async logout(rawSessionToken: string): Promise<void> {
    if (!rawSessionToken) return;
    const tokenHash = hashToken(rawSessionToken);
    const session = await this.sessionRepo.findByTokenHash(tokenHash);
    if (session) {
      await this.sessionRepo.revoke(session.id);
      domainEvents.emit("member.logged_out", { memberId: session.memberId });
    }
  }

  async revokeAllSessions(memberId: string): Promise<number> {
    return this.sessionRepo.revokeAllForMember(memberId);
  }

  async requestEmailChange(
    memberId: string,
    newEmailInput: string,
    context: MemberAuthContext = {},
    publicationId?: string,
  ): Promise<{ sent: boolean }> {
    const newEmailNormalized = normalizeMemberEmail(newEmailInput);
    if (!newEmailNormalized) {
      throw new MemberAuthError(
        "VALIDATION_ERROR",
        "A valid new email address is required",
      );
    }

    const member = await this.memberRepo.findById(memberId, publicationId);
    if (!member || member.status === "disabled") {
      throw new MemberAuthError("MEMBER_NOT_FOUND", "Member not found");
    }

    if (member.emailNormalized === newEmailNormalized) {
      throw new MemberAuthError(
        "VALIDATION_ERROR",
        "New email must be different from current email",
      );
    }

    const pubId = publicationId || member.publicationId || "pub_default";
    const existing = await this.memberRepo.findByEmailNormalized(
      newEmailNormalized,
      pubId,
    );
    if (existing && existing.id !== memberId) {
      throw new MemberAuthError(
        "EMAIL_IN_USE",
        "This email address is already in use by another account",
      );
    }

    // Invalidate existing pending change_email tokens
    await this.tokenRepo.invalidateForMember(memberId, "change_email");

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MS);

    await this.tokenRepo.create({
      memberId: member.id,
      tokenHash,
      purpose: `change_email:${newEmailNormalized}`,
      expiresAt,
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null,
    });

    const portalBase = getConfig().site.portalUrl;
    const verifyUrl = `${portalBase}/portal/#/auth/verify-email-change?token=${encodeURIComponent(rawToken)}`;

    if (this.mailer.sendEmailChangeVerification) {
      await this.mailer.sendEmailChangeVerification({
        to: newEmailInput.trim(),
        verifyUrl,
        expiresInMinutes: 15,
      });
    }

    if (this.mailer.sendEmailChangeNotice) {
      await this.mailer.sendEmailChangeNotice({
        to: member.email,
        newEmail: newEmailInput.trim(),
      }).catch(() => undefined);
    }

    domainEvents.emit("member.email_change_requested", {
      memberId: member.id,
      oldEmailNormalized: member.emailNormalized,
      newEmailNormalized,
      publicationId: pubId,
    });

    return { sent: true };
  }

  async confirmEmailChange(
    rawToken: string,
    context: MemberAuthContext = {},
  ): Promise<{ member: Member; newEmail: string }> {
    if (!rawToken || typeof rawToken !== "string") {
      throw new MemberAuthError("AUTH_TOKEN_INVALID", "Invalid or missing token");
    }

    const tokenHash = hashToken(rawToken);
    const token = await this.tokenRepo.findByTokenHash(tokenHash);

    if (!token) {
      throw new MemberAuthError("AUTH_TOKEN_INVALID", "Invalid token");
    }

    if (!token.purpose.startsWith("change_email:")) {
      throw new MemberAuthError("AUTH_TOKEN_INVALID", "Invalid token purpose");
    }

    if (token.usedAt) {
      throw new MemberAuthError("AUTH_TOKEN_USED", "This email change link has already been used");
    }

    if (token.expiresAt.getTime() < Date.now()) {
      throw new MemberAuthError("AUTH_TOKEN_EXPIRED", "This email change link has expired");
    }

    const newEmailNormalized = token.purpose.slice("change_email:".length);
    const member = await this.memberRepo.findById(token.memberId);
    if (!member || member.status === "disabled") {
      throw new MemberAuthError("MEMBER_DISABLED", "Member is disabled or not found");
    }

    const updatedMember = await runInTransaction(async () => {
      const marked = await this.tokenRepo.markUsed(token.id, new Date());
      if (!marked) {
        throw new MemberAuthError("AUTH_TOKEN_USED", "This email change link has already been used");
      }

      return this.memberRepo.update(member.id, {
        email: newEmailNormalized,
        emailNormalized: newEmailNormalized,
        emailVerifiedAt: new Date(),
      }, member.publicationId);
    });

    domainEvents.emit("member.email_changed", {
      memberId: member.id,
      oldEmailNormalized: member.emailNormalized,
      newEmailNormalized,
      publicationId: member.publicationId,
    });

    return { member: updatedMember, newEmail: newEmailNormalized };
  }

  private buildMagicLinkUrl(rawToken: string): string {
    const normalizedBase = getConfig().site.portalUrl;
    return `${normalizedBase}/portal/#/auth/verify?token=${encodeURIComponent(rawToken)}`;
  }
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}
