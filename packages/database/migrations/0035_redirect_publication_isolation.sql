-- Existing global redirects were historically managed by the default publication.
-- Keep their IDs and source URLs; never copy cross-publication routing rules.
ALTER TABLE "redirects"
  ADD COLUMN "publication_id" text NOT NULL DEFAULT 'pub_default';
ALTER TABLE "redirects"
  ADD CONSTRAINT "redirects_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;
ALTER TABLE "redirects" DROP CONSTRAINT "redirects_source_unique";
CREATE UNIQUE INDEX "redirects_publication_source_idx"
  ON "redirects" ("publication_id", "source");
CREATE INDEX "redirects_publication_enabled_idx"
  ON "redirects" ("publication_id", "enabled");
