import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const activitypubMessages = pgTable(
  "activitypub_messages",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // "inbox" | "outbox"
    actor: text("actor").notNull(),
    activityType: text("activity_type").notNull(), // "Create" | "Update" | "Delete" | "Follow" | "Accept" | "Announce" | "Like"
    objectId: text("object_id"),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"), // "pending" | "processed" | "failed" | "dead_letter"
    retryCount: integer("retry_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    actorIdx: index("activitypub_messages_actor_idx").on(table.actor),
    statusIdx: index("activitypub_messages_status_idx").on(table.status),
    typeIdx: index("activitypub_messages_type_idx").on(table.type),
  }),
);

export type ActivitypubMessageRow = typeof activitypubMessages.$inferSelect;
export type NewActivitypubMessageRow = typeof activitypubMessages.$inferInsert;

export const activitypubBlockedDomains = pgTable(
  "activitypub_blocked_domains",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull().unique(),
    reason: text("reason"),
    blockedAt: timestamp("blocked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    blockedBy: text("blocked_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    domainIdx: uniqueIndex("activitypub_blocked_domains_domain_idx").on(table.domain),
  }),
);

export type ActivitypubBlockedDomainRow = typeof activitypubBlockedDomains.$inferSelect;
export type NewActivitypubBlockedDomainRow = typeof activitypubBlockedDomains.$inferInsert;

export const distributionCampaigns = pgTable(
  "distribution_campaigns",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").notNull(),
    contentType: text("content_type").notNull().default("post"),
    channels: jsonb("channels").notNull().default([]), // ["rss", "json_feed", "activitypub", "social"]
    customMessage: text("custom_message"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"), // "draft" | "scheduled" | "sent" | "failed"
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    contentIdx: index("distribution_campaigns_content_idx").on(table.contentId),
    statusIdx: index("distribution_campaigns_status_idx").on(table.status),
  }),
);

export type DistributionCampaignRow = typeof distributionCampaigns.$inferSelect;
export type NewDistributionCampaignRow = typeof distributionCampaigns.$inferInsert;
