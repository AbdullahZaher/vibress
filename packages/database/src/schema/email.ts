import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { members } from "./members";

export const newsletters = pgTable("newsletters", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  senderName: text("sender_name").notNull(),
  senderEmail: text("sender_email").notNull(),
  replyTo: text("reply_to"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export type NewsletterRow = typeof newsletters.$inferSelect;
export type NewNewsletterRow = typeof newsletters.$inferInsert;

export const newsletterPreferences = pgTable(
  "newsletter_preferences",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    newsletterId: text("newsletter_id")
      .notNull()
      .references(() => newsletters.id, { onDelete: "cascade" }),
    subscribed: boolean("subscribed").notNull().default(true),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      uniqueMemberNewsletterIdx: uniqueIndex(
        "newsletter_prefs_member_newsletter_idx",
      ).on(table.memberId, table.newsletterId),
      memberIdx: index("newsletter_prefs_member_idx").on(table.memberId),
    };
  },
);

export type NewsletterPreferenceRow = typeof newsletterPreferences.$inferSelect;
export type NewNewsletterPreferenceRow =
  typeof newsletterPreferences.$inferInsert;

export const newsletterSends = pgTable(
  "newsletter_sends",
  {
    id: text("id").primaryKey(),
    newsletterId: text("newsletter_id")
      .notNull()
      .references(() => newsletters.id, { onDelete: "restrict" }),
    subject: text("subject").notNull(),
    contentVersion: integer("content_version").notNull().default(1),
    content: jsonb("content").notNull(),
    senderName: text("sender_name").notNull(),
    senderEmail: text("sender_email").notNull(),
    replyTo: text("reply_to"),
    audience: jsonb("audience").notNull(),
    createdBy: text("created_by"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    totalRecipients: integer("total_recipients").notNull().default(0),
    sentRecipients: integer("sent_recipients").notNull().default(0),
    failedRecipients: integer("failed_recipients").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      statusIdx: index("newsletter_sends_status_idx").on(table.status),
      scheduledAtIdx: index("newsletter_sends_scheduled_at_idx").on(
        table.scheduledAt,
      ),
      newsletterIdx: index("newsletter_sends_newsletter_idx").on(
        table.newsletterId,
      ),
    };
  },
);

export type NewsletterSendRow = typeof newsletterSends.$inferSelect;
export type NewNewsletterSendRow = typeof newsletterSends.$inferInsert;

export const emailRecipients = pgTable(
  "email_recipients",
  {
    id: text("id").primaryKey(),
    sendId: text("send_id")
      .notNull()
      .references(() => newsletterSends.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    name: text("name"),
    status: text("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      sendIdx: index("email_recipients_send_idx").on(table.sendId),
      statusIdx: index("email_recipients_status_idx").on(table.status),
      sendStatusIdx: index("email_recipients_send_status_idx").on(
        table.sendId,
        table.status,
      ),
      uniqueMemberSendIdx: uniqueIndex("email_recipients_member_send_idx").on(
        table.memberId,
        table.sendId,
      ),
    };
  },
);

export type EmailRecipientRow = typeof emailRecipients.$inferSelect;
export type NewEmailRecipientRow = typeof emailRecipients.$inferInsert;

export const emailEvents = pgTable(
  "email_events",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => emailRecipients.id, { onDelete: "cascade" }),
    sendId: text("send_id").references(() => newsletterSends.id, {
      onDelete: "cascade",
    }),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    provider: text("provider"),
    providerEventId: text("provider_event_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      recipientIdx: index("email_events_recipient_idx").on(table.recipientId),
      sendIdx: index("email_events_send_idx").on(table.sendId),
    };
  },
);

export type EmailEventRow = typeof emailEvents.$inferSelect;
export type NewEmailEventRow = typeof emailEvents.$inferInsert;

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      uniqueEmailIdx: uniqueIndex("email_suppressions_email_reason_idx").on(
        table.email,
        table.reason,
      ),
      emailIdx: index("email_suppressions_email_idx").on(table.email),
    };
  },
);

export type EmailSuppressionRow = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppressionRow = typeof emailSuppressions.$inferInsert;

export const providerEvents = pgTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("received"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => {
    return {
      uniqueProviderEventIdx: uniqueIndex(
        "provider_events_provider_event_idx",
      ).on(table.provider, table.providerEventId),
    };
  },
);

export type ProviderEventRow = typeof providerEvents.$inferSelect;
export type NewProviderEventRow = typeof providerEvents.$inferInsert;
