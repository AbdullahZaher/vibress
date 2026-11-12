-- Migration 0052: scope newsletter sends to their publication.
--
-- Sends previously inherited their tenant only through newsletter_id, which
-- let publication-scoped staff read, cancel, or enqueue another publication's
-- send by ID. Persist the owning publication on the send itself so every
-- repository query can enforce the tenant boundary directly.

ALTER TABLE "newsletter_sends" ADD COLUMN "publication_id" text;

UPDATE "newsletter_sends" AS send
SET "publication_id" = newsletter."publication_id"
FROM "newsletters" AS newsletter
WHERE send."newsletter_id" = newsletter."id";

-- Refuse to guess an owner for a send whose newsletter cannot be resolved.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "newsletter_sends" WHERE "publication_id" IS NULL) THEN
    RAISE EXCEPTION 'newsletter_sends rows without a resolvable publication';
  END IF;
END $$;

ALTER TABLE "newsletter_sends" ALTER COLUMN "publication_id" SET NOT NULL;

ALTER TABLE "newsletter_sends"
  ADD CONSTRAINT "newsletter_sends_publication_id_publications_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications" ("id")
  ON DELETE CASCADE;

CREATE INDEX "newsletter_sends_publication_id_idx"
  ON "newsletter_sends" ("publication_id");
