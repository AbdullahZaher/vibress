import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      actorUserIdIdx: index("audit_events_actor_user_id_idx").on(
        table.actorUserId,
      ),
      actionIdx: index("audit_events_action_idx").on(table.action),
      createdAtIdx: index("audit_events_created_at_idx").on(table.createdAt),
    };
  },
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
