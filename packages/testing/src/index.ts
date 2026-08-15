import { randomUUID } from "node:crypto";

export interface TestUserOptions {
  id?: string;
  email?: string;
  name?: string;
  status?: string;
}

export function createMockUser(overrides: TestUserOptions = {}) {
  const id = overrides.id || randomUUID();
  return {
    id,
    email: overrides.email || `user-${id.slice(0, 8)}@vibress.test`,
    name: overrides.name || "Test User",
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    status: overrides.status || "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export interface TestPostOptions {
  id?: string;
  title?: string;
  slug?: string;
  status?: "draft" | "scheduled" | "published";
  authorId?: string;
}

export function createMockPost(overrides: TestPostOptions = {}) {
  const id = overrides.id || randomUUID();
  return {
    id,
    title: overrides.title || "Test Post Title",
    slug: overrides.slug || `test-post-${id.slice(0, 8)}`,
    status: overrides.status || "draft",
    visibility: "public",
    content: {
      schema: "vibress-studio",
      version: 1,
      root: { type: "root", children: [] },
    },
    primaryAuthorId: overrides.authorId || randomUUID(),
    createdBy: overrides.authorId || randomUUID(),
    updatedBy: overrides.authorId || randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export interface TestMemberOptions {
  id?: string;
  email?: string;
  name?: string;
  status?: "active" | "disabled";
}

export function createMockMember(overrides: TestMemberOptions = {}) {
  const id = overrides.id || randomUUID();
  return {
    id,
    email: overrides.email || `member-${id.slice(0, 8)}@vibress.test`,
    name: overrides.name || "Test Member",
    status: overrides.status || "active",
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export interface PoolQueryClient {
  query(sql: string): Promise<unknown>;
}

export async function truncateAllTestTables(
  pool: PoolQueryClient,
): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE outbox_events, automations, automation_runs, search_documents,
    comments, comment_likes, comment_reports, notifications, recommendations,
    newsletters, newsletter_preferences, newsletter_sends, email_recipients,
    email_events, email_suppressions, member_sessions, member_auth_tokens, members,
    subscriptions, billing_customers, billing_plan_mappings, billing_events,
    audit_events, sessions, media_references, media_assets, revisions, post_tags,
    post_authors, page_authors, tags, pages, posts, users CASCADE;
  `);
}

export async function withMockEnv<T>(
  env: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalEnv = { ...process.env };
  try {
    Object.assign(process.env, env);
    return await fn();
  } finally {
    process.env = originalEnv;
  }
}
