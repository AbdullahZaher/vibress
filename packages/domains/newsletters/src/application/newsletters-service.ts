import { NewsletterRepository } from '../domain/repository';
import { Newsletter, CreateNewsletterData, UpdateNewsletterData, NewsletterPreference, NewsletterPreferenceRepository } from '../domain/newsletter';
import { SendRepository, NewsletterSend, CreateSendData, SendStatus, AudienceDefinition } from '../domain/send';
import { domainEvents } from '@vibress/events';
import { runInTransaction } from '@vibress/database';
import crypto from 'node:crypto';
import { renderStudioDocumentToHtml, renderStudioDocumentToPlainText } from '@vibress/studio-renderer';

export class NewsletterDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function assertNoControlChars(value: string, field: string): void {
  // Header-injection guard: reject CR/LF and other control characters in
  // any value that may flow into email headers.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) {
      throw new NewsletterDomainError('VALIDATION_ERROR', `${field} must not contain control characters`);
    }
  }
}

export interface AudienceMember {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  status: string;
  hasPaidSubscription: boolean;
}

export interface MemberAudienceRepository {
  listAudienceMembers(filter: 'all' | 'paid' | 'free', productId: string | null): Promise<AudienceMember[]>;
}

export interface NewsletterServiceDeps {
  newsletterRepo: NewsletterRepository;
  preferenceRepo: NewsletterPreferenceRepository;
  sendRepo: SendRepository;
  audienceRepo: MemberAudienceRepository;
  isMemberSuppressed: (email: string) => Promise<boolean>;
  unsubscribeSecret: string;
  portalUrl: string;
}

export const UNSUBSCRIBE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export class NewslettersService {
  constructor(private deps: NewsletterServiceDeps) {}

  // ---------------- Newsletter CRUD ----------------

  async createNewsletter(data: CreateNewsletterData, actorId: string | null): Promise<Newsletter> {
    const key = data.key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
      throw new NewsletterDomainError('VALIDATION_ERROR', 'Newsletter key must be lowercase alphanumeric with hyphens');
    }
    if (data.name.trim().length > 100) {
      throw new NewsletterDomainError('VALIDATION_ERROR', 'Newsletter name is too long');
    }
    assertNoControlChars(data.name, 'Newsletter name');
    assertNoControlChars(data.senderName, 'Sender name');
    assertNoControlChars(data.senderEmail, 'Sender email');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.senderEmail)) {
      throw new NewsletterDomainError('VALIDATION_ERROR', 'Invalid sender email');
    }
    const existing = await this.deps.newsletterRepo.findByKey(key);
    if (existing) {
      throw new NewsletterDomainError('VALIDATION_ERROR', 'Newsletter key already exists');
    }
    const newsletter = await this.deps.newsletterRepo.create({ ...data, key });
    domainEvents.emit('newsletter.created', { newsletterId: newsletter.id, actorId });
    return newsletter;
  }

  async updateNewsletter(id: string, data: UpdateNewsletterData, actorId: string | null): Promise<Newsletter> {
    const existing = await this.deps.newsletterRepo.findById(id);
    if (!existing) throw new NewsletterDomainError('NEWSLETTER_NOT_FOUND', 'Newsletter not found');
    if (data.senderEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.senderEmail)) {
      throw new NewsletterDomainError('VALIDATION_ERROR', 'Invalid sender email');
    }
    if (data.senderName) assertNoControlChars(data.senderName, 'Sender name');
    if (data.senderEmail) assertNoControlChars(data.senderEmail, 'Sender email');
    const updated = await this.deps.newsletterRepo.update(id, data);
    domainEvents.emit('newsletter.updated', { newsletterId: id, actorId });
    return updated;
  }

  async archiveNewsletter(id: string, actorId: string | null): Promise<Newsletter> {
    const existing = await this.deps.newsletterRepo.findById(id);
    if (!existing) throw new NewsletterDomainError('NEWSLETTER_NOT_FOUND', 'Newsletter not found');
    const archived = await this.deps.newsletterRepo.archive(id);
    domainEvents.emit('newsletter.archived', { newsletterId: id, actorId });
    return archived;
  }

  async getNewsletter(id: string): Promise<Newsletter | null> {
    return this.deps.newsletterRepo.findById(id);
  }

  async listNewsletters(filter?: { includeArchived?: boolean }): Promise<Newsletter[]> {
    return this.deps.newsletterRepo.list(filter);
  }

  // ---------------- Preferences ----------------

  async setSubscription(memberId: string, newsletterId: string, subscribed: boolean): Promise<NewsletterPreference> {
    const newsletter = await this.deps.newsletterRepo.findById(newsletterId);
    if (!newsletter || newsletter.status === 'archived') {
      throw new NewsletterDomainError('NEWSLETTER_NOT_FOUND', 'Newsletter not found');
    }
    const pref = await this.deps.preferenceRepo.setSubscription(memberId, newsletterId, subscribed);
    domainEvents.emit(subscribed ? 'member.newsletter_subscribed' : 'member.newsletter_unsubscribed', {
      memberId,
      newsletterId,
    });
    return pref;
  }

  async listPreferencesForMember(memberId: string): Promise<NewsletterPreference[]> {
    return this.deps.preferenceRepo.listForMember(memberId);
  }

  // ---------------- Audience ----------------

  async resolveAudience(memberId: string, newsletterId: string): Promise<NewsletterPreference> {
    const pref = await this.deps.preferenceRepo.get(memberId, newsletterId);
    if (pref) return pref;
    return this.deps.preferenceRepo.setSubscription(memberId, newsletterId, true);
  }

  /**
   * Deterministic baseline audience: active members subscribed to the
   * newsletter, not suppressed, optional paid/free + product filters.
   */
  async computeAudience(
    newsletterId: string,
    definition: AudienceDefinition
  ): Promise<AudienceMember[]> {
    const all = await this.deps.audienceRepo.listAudienceMembers(definition.filter, definition.productId);
    const members: AudienceMember[] = [];
    for (const member of all) {
      if (member.status !== 'active' || !member.emailVerified) continue;
      // Defense in depth: enforce the paid/free filter in the domain too
      if (definition.filter === 'paid' && !member.hasPaidSubscription) continue;
      if (definition.filter === 'free' && member.hasPaidSubscription) continue;
      const suppressed = await this.deps.isMemberSuppressed(member.email);
      if (suppressed) continue;
      const pref = await this.deps.preferenceRepo.get(member.id, newsletterId);
      if (!pref || !pref.subscribed) continue;
      members.push(member);
    }
    return members;
  }

  // ---------------- Sends ----------------

  async createSend(data: CreateSendData, actorId: string | null): Promise<NewsletterSend> {
    const newsletter = await this.deps.newsletterRepo.findById(data.newsletterId);
    if (!newsletter || newsletter.status === 'archived') {
      throw new NewsletterDomainError('NEWSLETTER_NOT_FOUND', 'Newsletter not found');
    }
    if (!data.subject.trim()) {
      throw new NewsletterDomainError('VALIDATION_ERROR', 'Subject is required');
    }
    const send = await this.deps.sendRepo.create({ ...data, createdBy: actorId || undefined });
    if (send.status === 'scheduled') {
      domainEvents.emit('newsletter.send_scheduled', { sendId: send.id, newsletterId: send.newsletterId });
    }
    return send;
  }

  /**
   * Snapshots the audience into recipient rows and starts delivery.
   * Called by the worker for due scheduled sends and by the API for send-now.
   */
  async startSend(sendId: string, createRecipients: (rows: Array<{ memberId: string | null; email: string; name: string | null; unsubscribeToken: string }>) => Promise<number>): Promise<{ send: NewsletterSend; recipientCount: number }> {
    return runInTransaction(() => this.startSendTx(sendId, createRecipients));
  }

  private async startSendTx(sendId: string, createRecipients: (rows: Array<{ memberId: string | null; email: string; name: string | null; unsubscribeToken: string }>) => Promise<number>): Promise<{ send: NewsletterSend; recipientCount: number }> {
    const send = await this.deps.sendRepo.findById(sendId);
    if (!send) throw new NewsletterDomainError('SEND_NOT_FOUND', 'Send not found');
    if (send.status === 'sending' || send.status === 'sent') {
      return { send, recipientCount: send.totalRecipients };
    }

    const audience = await this.computeAudience(send.newsletterId, send.audience);

    // Snapshot recipients with per-recipient unsubscribe tokens
    const rows = audience.map((m) => ({
      memberId: m.id,
      email: m.email,
      name: m.name,
      unsubscribeToken: this.signUnsubscribeToken(m.id, send.id),
    }));

    const count = await createRecipients(rows);
    const updated = await this.deps.sendRepo.updateStatus(sendId, 'sending', {
      totalRecipients: count,
      startedAt: new Date(),
    });
    domainEvents.emit('newsletter.send_started', { sendId, newsletterId: send.newsletterId });
    return { send: updated, recipientCount: count };
  }

  async completeSend(sendId: string): Promise<NewsletterSend> {
    const send = await this.deps.sendRepo.findById(sendId);
    if (!send) throw new NewsletterDomainError('SEND_NOT_FOUND', 'Send not found');
    const updated = await this.deps.sendRepo.updateStatus(sendId, 'sent', { completedAt: new Date() });
    domainEvents.emit('newsletter.sent', { sendId, newsletterId: send.newsletterId });
    return updated;
  }

  async failSend(sendId: string, error: string): Promise<NewsletterSend> {
    const updated = await this.deps.sendRepo.updateStatus(sendId, 'failed', { lastError: error.slice(0, 500), completedAt: new Date() });
    domainEvents.emit('newsletter.send_failed', { sendId, newsletterId: updated.newsletterId, error });
    return updated;
  }

  async cancelSend(sendId: string): Promise<NewsletterSend> {
    const send = await this.deps.sendRepo.findById(sendId);
    if (!send) throw new NewsletterDomainError('SEND_NOT_FOUND', 'Send not found');
    if (send.status === 'sending' || send.status === 'sent') {
      throw new NewsletterDomainError('SEND_NOT_CANCELLABLE', 'Send is already in progress');
    }
    return this.deps.sendRepo.updateStatus(sendId, 'cancelled');
  }

  async getSend(sendId: string): Promise<NewsletterSend | null> {
    return this.deps.sendRepo.findById(sendId);
  }

  async listSends(filter?: { status?: SendStatus; newsletterId?: string; limit?: number; offset?: number }): Promise<{ sends: NewsletterSend[]; total: number }> {
    return this.deps.sendRepo.list(filter);
  }

  async findDueScheduledSends(now: Date, limit = 20): Promise<NewsletterSend[]> {
    return this.deps.sendRepo.findDueScheduled(now, limit);
  }

  // ---------------- Unsubscribe ----------------

  /**
   * HMAC-signed, scoped, idempotent unsubscribe token.
   * token = base64url(memberId:sendId) + "." + hmac(secret, "unsub:" + payload)
   */
  signUnsubscribeToken(memberId: string, sendId: string): string {
    const payload = Buffer.from(`${memberId}:${sendId}`, 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', this.deps.unsubscribeSecret).update(`unsub:${payload}`).digest('hex');
    return `${payload}.${sig}`;
  }

  /**
   * Unsubscribes a member from the send's newsletter using a signed token.
   * Scoped: a token can only unsubscribe the member it was issued for.
   * Idempotent: already-unsubscribed is a no-op success.
   */
  async unsubscribeWithToken(token: string): Promise<{ memberId: string; newsletterId: string }> {
    const claims = this.unwrapToken(token);
    if (!claims) throw new NewsletterDomainError('INVALID_UNSUBSCRIBE_TOKEN', 'Invalid or expired unsubscribe link');

    const send = await this.deps.sendRepo.findById(claims.sendId);
    if (!send) throw new NewsletterDomainError('SEND_NOT_FOUND', 'Send not found');
    const newsletterId = send.newsletterId;

    const pref = await this.deps.preferenceRepo.get(claims.memberId, newsletterId);
    if (!pref || pref.subscribed) {
      await this.deps.preferenceRepo.setSubscription(claims.memberId, newsletterId, false);
      domainEvents.emit('member.newsletter_unsubscribed', { memberId: claims.memberId, newsletterId });
    }
    return { memberId: claims.memberId, newsletterId };
  }

  private unwrapToken(token: string): { memberId: string; sendId: string } | null {
    if (!token || typeof token !== 'string' || token.length > 512) return null;
    const dot = token.lastIndexOf('.');
    if (dot < 1) return null;
    const payloadPart = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', this.deps.unsubscribeSecret).update(`unsub:${payloadPart}`).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      return null;
    }
    let decoded: string;
    try {
      decoded = Buffer.from(payloadPart, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const [memberId, sendId] = decoded.split(':');
    if (!memberId || !sendId) return null;
    return { memberId, sendId };
  }

  // ---------------- Rendering ----------------

  /**
   * Studio document (canonical) -> email-safe HTML with unsubscribe link.
   */
  renderEmailHtml(send: NewsletterSend, memberId: string, unsubscribeToken: string): { html: string; text: string } {
    const bodyHtml = renderStudioDocumentToHtml(send.content, { target: 'email' });
    const unsubscribeUrl = `${this.deps.portalUrl}/portal/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}`;
    const unsubscribeHtml = `<p style="font-size:12px;color:#888888;margin:32px 0 0 0;border-top:1px solid #eeeeee;padding-top:16px;">You are receiving this email because you subscribed. <a href="${unsubscribeUrl}" style="color:#888888;">Unsubscribe</a> from this newsletter.</p>`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222222;font-size:15px;line-height:1.6;">
    ${bodyHtml}
    ${unsubscribeHtml}
  </div>
</body>
</html>`;

    const textParts: string[] = [];
    const plain = renderStudioDocumentToPlainText(send.content);
    if (plain.trim()) textParts.push(plain.trim());
    textParts.push('---');
    textParts.push(`Unsubscribe: ${unsubscribeUrl}`);
    return { html, text: textParts.join('\n\n') };
  }
}
