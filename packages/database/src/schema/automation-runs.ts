import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id").notNull(),
    automationVersion: integer("automation_version").notNull().default(1),
    triggerType: text("trigger_type").notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed" | "cancelled"
    input: jsonb("input").default({}),
    output: jsonb("output").default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms").default(0),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    automationIdx: index("automation_runs_automation_idx").on(table.automationId),
    statusIdx: index("automation_runs_status_idx").on(table.status),
    startedAtIdx: index("automation_runs_started_at_idx").on(table.startedAt),
  }),
);

export type AutomationRunRow = typeof automationRuns.$inferSelect;
export type NewAutomationRunRow = typeof automationRuns.$inferInsert;

export const automationRunSteps = pgTable(
  "automation_run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stepName: text("step_name").notNull(),
    stepType: text("step_type").notNull(), // "trigger" | "condition" | "action"
    status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed" | "skipped"
    input: jsonb("input").default({}),
    output: jsonb("output").default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms").default(0),
  },
  (table) => ({
    runIdx: index("automation_run_steps_run_idx").on(table.runId),
    statusIdx: index("automation_run_steps_status_idx").on(table.status),
  }),
);

export type AutomationRunStepRow = typeof automationRunSteps.$inferSelect;
export type NewAutomationRunStepRow = typeof automationRunSteps.$inferInsert;
