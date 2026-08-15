import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./users";

export const publications = pgTable(
  "publications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    domain: text("domain"),
    primaryLocale: text("primary_locale").notNull().default("en"),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceSlugIdx: uniqueIndex("publications_workspace_slug_idx").on(
      table.workspaceId,
      table.slug,
    ),
    domainIdx: index("publications_domain_idx").on(table.domain),
  }),
);

export type PublicationRow = typeof publications.$inferSelect;
export type NewPublicationRow = typeof publications.$inferInsert;

export const publicationMemberships = pgTable(
  "publication_memberships",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("editor"), // "owner" | "admin" | "editor" | "author" | "contributor"
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userPublicationIdx: uniqueIndex("pub_memberships_pub_user_idx").on(
      table.publicationId,
      table.userId,
    ),
  }),
);

export type PublicationMembershipRow = typeof publicationMemberships.$inferSelect;
export type NewPublicationMembershipRow = typeof publicationMemberships.$inferInsert;
