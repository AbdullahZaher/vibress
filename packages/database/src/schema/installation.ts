import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * First-run installation state. A single singleton row (id='singleton') is
 * created by the migration and MUST always exist before setup traffic can
 * reach the API, so setup transactions can safely `SELECT ... FOR UPDATE`
 * against a guaranteed row.
 *
 * `installed` is the only persistent state: a crash before the setup
 * transaction commits leaves it false (UNINSTALLED); a successful commit
 * sets it true (INSTALLED). There is deliberately no intermediate state —
 * an in-flight installation is represented by the database row lock.
 */
export const installation = pgTable(
  "installation",
  {
    id: text("id").primaryKey(),
    installed: boolean("installed").notNull().default(false),
    installedAt: timestamp("installed_at", { withTimezone: true }),
    installedVersion: text("installed_version"),
    installationSource: text("installation_source").notNull().default("fresh"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      installedIdx: index("installation_installed_idx").on(table.installed),
    };
  },
);

export type InstallationRow = typeof installation.$inferSelect;
export type NewInstallationRow = typeof installation.$inferInsert;
