-- Migration 0053: scope email suppressions to their publication.
--
-- Suppressions were globally unique and exposed through a publication-scoped
-- staff API: any publication could enumerate or lift every other publication's
-- suppressed addresses. Persist the owning publication so listings and removals
-- enforce the tenant boundary. Existing rows stay global (publication_id NULL)
-- because the originating provider event carries no tenant attribution; global
-- suppressions remain honoured for delivery safety.

ALTER TABLE "email_suppressions" ADD COLUMN "publication_id" text
  REFERENCES "publications" ("id") ON DELETE CASCADE;

DROP INDEX IF EXISTS "email_suppressions_email_reason_idx";

CREATE UNIQUE INDEX "email_suppressions_global_email_reason_idx"
  ON "email_suppressions" ("email", "reason")
  WHERE "publication_id" IS NULL;

CREATE UNIQUE INDEX "email_suppressions_publication_email_reason_idx"
  ON "email_suppressions" ("publication_id", "email", "reason")
  WHERE "publication_id" IS NOT NULL;

CREATE INDEX "email_suppressions_publication_id_idx"
  ON "email_suppressions" ("publication_id");
