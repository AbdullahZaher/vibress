import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    slug: text("slug").unique(),
    bio: text("bio"),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => {
    return {
      emailIdx: index("users_email_idx").on(table.email),
      slugIdx: index("users_slug_idx").on(table.slug),
      statusIdx: index("users_status_idx").on(table.status),
    };
  },
);

export const userInvitations = pgTable(
  "user_invitations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invitedBy: text("invited_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      tokenHashIdx: index("user_invitations_token_hash_idx").on(table.tokenHash),
      userIdIdx: index("user_invitations_user_id_idx").on(table.userId),
      emailIdx: index("user_invitations_email_idx").on(table.email),
      statusIdx: index("user_invitations_status_idx").on(table.status),
    };
  },
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      tokenHashIdx: index("password_reset_tokens_token_hash_idx").on(table.tokenHash),
      userIdIdx: index("password_reset_tokens_user_id_idx").on(table.userId),
      expiresAtIdx: index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
    };
  },
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserInvitationRow = typeof userInvitations.$inferSelect;
export type NewUserInvitationRow = typeof userInvitations.$inferInsert;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenRow = typeof passwordResetTokens.$inferInsert;
