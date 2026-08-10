import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

export const members = pgTable('members', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  emailNormalized: text('email_normalized').notNull().unique(),
  name: text('name'),
  status: text('status').notNull().default('active'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    emailNormalizedIdx: index('members_email_normalized_idx').on(table.emailNormalized),
    statusIdx: index('members_status_idx').on(table.status),
  };
});

export type MemberRow = typeof members.$inferSelect;
export type NewMemberRow = typeof members.$inferInsert;

export const memberAuthTokens = pgTable('member_auth_tokens', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  purpose: text('purpose').notNull().default('authenticate'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
}, (table) => {
  return {
    memberIdIdx: index('member_auth_tokens_member_id_idx').on(table.memberId),
    tokenHashIdx: index('member_auth_tokens_token_hash_idx').on(table.tokenHash),
  };
});

export type MemberAuthTokenRow = typeof memberAuthTokens.$inferSelect;
export type NewMemberAuthTokenRow = typeof memberAuthTokens.$inferInsert;

export const memberSessions = pgTable('member_sessions', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
}, (table) => {
  return {
    memberIdIdx: index('member_sessions_member_id_idx').on(table.memberId),
    tokenHashIdx: index('member_sessions_token_hash_idx').on(table.tokenHash),
  };
});

export type MemberSessionRow = typeof memberSessions.$inferSelect;
export type NewMemberSessionRow = typeof memberSessions.$inferInsert;
