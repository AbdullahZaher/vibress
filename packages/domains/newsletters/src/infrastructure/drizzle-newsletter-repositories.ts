import {
  getDb,
  newsletters,
  NewsletterRow,
  newsletterPreferences,
  NewsletterPreferenceRow,
  newsletterSends,
  NewsletterSendRow,
} from "@vibress/database";
import { eq, and, isNull, lte, count, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { NewsletterRepository } from "../domain/repository";
import {
  Newsletter,
  CreateNewsletterData,
  UpdateNewsletterData,
  NewsletterPreference,
  NewsletterPreferenceRepository,
} from "../domain/newsletter";
import {
  SendRepository,
  NewsletterSend,
  CreateSendData,
  SendStatus,
  AudienceDefinition,
} from "../domain/send";

export class DrizzleNewsletterRepository implements NewsletterRepository {
  async create(data: CreateNewsletterData): Promise<Newsletter> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(newsletters)
      .values({
        id: data.id || crypto.randomUUID(),
        key: data.key,
        name: data.name,
        description: data.description || null,
        senderName: data.senderName,
        senderEmail: data.senderEmail,
        replyTo: data.replyTo || null,
        status: data.status || "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert newsletter");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Newsletter | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletters)
      .where(eq(newsletters.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<Newsletter | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletters)
      .where(eq(newsletters.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateNewsletterData): Promise<Newsletter> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description;
    if (data.senderName !== undefined) payload.senderName = data.senderName;
    if (data.senderEmail !== undefined) payload.senderEmail = data.senderEmail;
    if (data.replyTo !== undefined) payload.replyTo = data.replyTo;
    const [row] = await db
      .update(newsletters)
      .set(payload)
      .where(eq(newsletters.id, id))
      .returning();
    if (!row) throw new Error(`Newsletter not found: ${id}`);
    return this.mapToDomain(row);
  }

  async archive(id: string): Promise<Newsletter> {
    const db = getDb();
    const [row] = await db
      .update(newsletters)
      .set({
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(newsletters.id, id))
      .returning();
    if (!row) throw new Error(`Newsletter not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(filter?: { includeArchived?: boolean }): Promise<Newsletter[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletters)
      .where(
        filter?.includeArchived ? undefined : isNull(newsletters.archivedAt),
      )
      .orderBy(newsletters.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: NewsletterRow): Newsletter {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description || null,
      senderName: row.senderName,
      senderEmail: row.senderEmail,
      replyTo: row.replyTo || null,
      status: row.status as Newsletter["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}

export class DrizzleNewsletterPreferenceRepository implements NewsletterPreferenceRepository {
  async setSubscription(
    memberId: string,
    newsletterId: string,
    subscribed: boolean,
  ): Promise<NewsletterPreference> {
    const db = getDb();
    const now = new Date();
    const existing = await db
      .select()
      .from(newsletterPreferences)
      .where(
        and(
          eq(newsletterPreferences.memberId, memberId),
          eq(newsletterPreferences.newsletterId, newsletterId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const [row] = await db
        .update(newsletterPreferences)
        .set({
          subscribed,
          subscribedAt: subscribed
            ? existing[0].subscribedAt || now
            : existing[0].subscribedAt,
          unsubscribedAt: subscribed ? null : now,
          updatedAt: now,
        })
        .where(eq(newsletterPreferences.id, existing[0].id))
        .returning();
      if (!row) throw new Error("Failed to update preference");
      return this.mapToDomain(row);
    }

    const [row] = await db
      .insert(newsletterPreferences)
      .values({
        id: crypto.randomUUID(),
        memberId,
        newsletterId,
        subscribed,
        subscribedAt: subscribed ? now : null,
        unsubscribedAt: subscribed ? null : now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert preference");
    return this.mapToDomain(row);
  }

  async get(
    memberId: string,
    newsletterId: string,
  ): Promise<NewsletterPreference | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletterPreferences)
      .where(
        and(
          eq(newsletterPreferences.memberId, memberId),
          eq(newsletterPreferences.newsletterId, newsletterId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async listForMember(memberId: string): Promise<NewsletterPreference[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletterPreferences)
      .where(eq(newsletterPreferences.memberId, memberId));
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: NewsletterPreferenceRow): NewsletterPreference {
    return {
      id: row.id,
      memberId: row.memberId,
      newsletterId: row.newsletterId,
      subscribed: row.subscribed,
      subscribedAt: row.subscribedAt,
      unsubscribedAt: row.unsubscribedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class DrizzleSendRepository implements SendRepository {
  async create(data: CreateSendData): Promise<NewsletterSend> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(newsletterSends)
      .values({
        id: data.id || crypto.randomUUID(),
        newsletterId: data.newsletterId,
        subject: data.subject,
        contentVersion: data.contentVersion || 1,
        content: data.content as object,
        senderName: data.senderName,
        senderEmail: data.senderEmail,
        replyTo: data.replyTo || null,
        audience: data.audience as object,
        createdBy: data.createdBy || null,
        scheduledAt: data.scheduledAt || null,
        status: data.status || "draft",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert send");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<NewsletterSend | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletterSends)
      .where(eq(newsletterSends.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async updateStatus(
    id: string,
    status: SendStatus,
    patch?: Partial<NewsletterSend>,
  ): Promise<NewsletterSend> {
    const db = getDb();
    const payload: Record<string, unknown> = { status, updatedAt: new Date() };
    if (patch) {
      if (patch.totalRecipients !== undefined)
        payload.totalRecipients = patch.totalRecipients;
      if (patch.sentRecipients !== undefined)
        payload.sentRecipients = patch.sentRecipients;
      if (patch.failedRecipients !== undefined)
        payload.failedRecipients = patch.failedRecipients;
      if (patch.startedAt !== undefined) payload.startedAt = patch.startedAt;
      if (patch.completedAt !== undefined)
        payload.completedAt = patch.completedAt;
      if (patch.lastError !== undefined) payload.lastError = patch.lastError;
    }
    const [row] = await db
      .update(newsletterSends)
      .set(payload)
      .where(eq(newsletterSends.id, id))
      .returning();
    if (!row) throw new Error(`Send not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(filter?: {
    status?: SendStatus;
    newsletterId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ sends: NewsletterSend[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter?.limit || 20, 100);
    const offset = filter?.offset || 0;
    const conditions = [];
    if (filter?.status)
      conditions.push(eq(newsletterSends.status, filter.status));
    if (filter?.newsletterId)
      conditions.push(eq(newsletterSends.newsletterId, filter.newsletterId));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db
      .select({ total: count() })
      .from(newsletterSends)
      .where(whereClause);
    const rows = await db
      .select()
      .from(newsletterSends)
      .where(whereClause)
      .orderBy(desc(newsletterSends.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      sends: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async findDueScheduled(now: Date, limit: number): Promise<NewsletterSend[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(newsletterSends)
      .where(
        and(
          eq(newsletterSends.status, "scheduled"),
          lte(newsletterSends.scheduledAt, now),
        ),
      )
      .orderBy(newsletterSends.scheduledAt)
      .limit(limit);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: NewsletterSendRow): NewsletterSend {
    return {
      id: row.id,
      newsletterId: row.newsletterId,
      subject: row.subject,
      contentVersion: row.contentVersion,
      content: row.content,
      senderName: row.senderName,
      senderEmail: row.senderEmail,
      replyTo: row.replyTo || null,
      audience: row.audience as AudienceDefinition,
      createdBy: row.createdBy || null,
      scheduledAt: row.scheduledAt,
      status: row.status as SendStatus,
      totalRecipients: row.totalRecipients,
      sentRecipients: row.sentRecipients,
      failedRecipients: row.failedRecipients,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
