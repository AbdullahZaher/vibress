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

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    visibility: text("visibility").notNull().default("public"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => {
    return {
      statusIdx: index("products_status_idx").on(table.status),
    };
  },
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    billingType: text("billing_type").notNull().default("recurring"),
    billingInterval: text("billing_interval"),
    intervalCount: integer("interval_count").notNull().default(1),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    trialDays: integer("trial_days").notNull().default(0),
    status: text("status").notNull().default("active"),
    visibility: text("visibility").notNull().default("public"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => {
    return {
      productIdIdx: index("plans_product_id_idx").on(table.productId),
      uniqueKeyPerProductIdx: uniqueIndex(
        "plans_unique_key_per_product_idx",
      ).on(table.productId, table.key),
    };
  },
);

export type PlanRow = typeof plans.$inferSelect;
export type NewPlanRow = typeof plans.$inferInsert;

export const offers = pgTable(
  "offers",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    planId: text("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    discountType: text("discount_type").notNull(),
    discountValue: integer("discount_value").notNull(),
    durationType: text("duration_type").notNull().default("once"),
    durationCycles: integer("duration_cycles"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    maxRedemptions: integer("max_redemptions"),
    redemptionCount: integer("redemption_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      planIdIdx: index("offers_plan_id_idx").on(table.planId),
      keyIdx: uniqueIndex("offers_key_idx").on(table.key),
    };
  },
);

export type OfferRow = typeof offers.$inferSelect;
export type NewOfferRow = typeof offers.$inferInsert;

export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      uniqueMemberProviderIdx: uniqueIndex(
        "billing_customers_member_provider_idx",
      ).on(table.memberId, table.provider),
      providerCustomerIdx: index("billing_customers_provider_customer_idx").on(
        table.provider,
        table.providerCustomerId,
      ),
    };
  },
);

export type BillingCustomerRow = typeof billingCustomers.$inferSelect;
export type NewBillingCustomerRow = typeof billingCustomers.$inferInsert;

export const billingPlanMappings = pgTable(
  "billing_plan_mappings",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerProductId: text("provider_product_id").notNull(),
    providerPriceId: text("provider_price_id").notNull(),
    providerMetadata: jsonb("provider_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      uniquePlanProviderIdx: uniqueIndex(
        "billing_plan_mappings_plan_provider_idx",
      ).on(table.planId, table.provider),
    };
  },
);

export type BillingPlanMappingRow = typeof billingPlanMappings.$inferSelect;
export type NewBillingPlanMappingRow = typeof billingPlanMappings.$inferInsert;

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    provider: text("provider"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerCustomerId: text("provider_customer_id"),
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    billingInterval: text("billing_interval").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    offerId: text("offer_id").references(() => offers.id, {
      onDelete: "set null",
    }),
    providerEventTimestamp: timestamp("provider_event_timestamp", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      memberIdIdx: index("subscriptions_member_id_idx").on(table.memberId),
      statusIdx: index("subscriptions_status_idx").on(table.status),
      providerSubIdx: index("subscriptions_provider_sub_idx").on(
        table.providerSubscriptionId,
      ),
      memberStatusIdx: index("subscriptions_member_status_idx").on(
        table.memberId,
        table.status,
      ),
    };
  },
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;

export const billingWebhookEvents = pgTable(
  "billing_webhook_events",
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
        "billing_webhook_events_provider_event_idx",
      ).on(table.provider, table.providerEventId),
    };
  },
);

export type BillingWebhookEventRow = typeof billingWebhookEvents.$inferSelect;
export type NewBillingWebhookEventRow =
  typeof billingWebhookEvents.$inferInsert;

export const billingEvents = pgTable(
  "billing_events",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    provider: text("provider"),
    providerEventId: text("provider_event_id"),
    type: text("type").notNull(),
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
      subscriptionIdx: index("billing_events_subscription_idx").on(
        table.subscriptionId,
      ),
      memberIdx: index("billing_events_member_idx").on(table.memberId),
    };
  },
);

export type BillingEventRow = typeof billingEvents.$inferSelect;
export type NewBillingEventRow = typeof billingEvents.$inferInsert;
