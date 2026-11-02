import { execSync } from "node:child_process";

// Ensure staging seeding cannot modify production publications or real user data.
if (process.env.NODE_ENV === "production" && !process.env.ALLOW_EDITORIAL_SEED) {
  throw new Error("Editorial staging seeder cannot run in production environments.");
}

function runSql(sql: string) {
  execSync('docker exec -i vibress-postgres-1 psql -U vibress -d vibress', {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

const seedSql = `
BEGIN;

-- 1. Publication identity
UPDATE publications 
SET name = 'The Vibress Chronicle',
    description = 'An independent journal of architecture, design, and editorial craftsmanship.'
WHERE id = 'pub_default';

-- 2. Publication settings
UPDATE settings SET value = '"The Vibress Chronicle"' WHERE publication_id = 'pub_default' AND key = 'title';
UPDATE settings SET value = '"An independent journal of architecture, design, and editorial craftsmanship."' WHERE publication_id = 'pub_default' AND key = 'description';
UPDATE settings SET value = 'false' WHERE publication_id = 'pub_default' AND key = 'announcementEnabled';
UPDATE settings SET value = '""' WHERE publication_id = 'pub_default' AND key = 'announcementText';
UPDATE settings SET value = '""' WHERE publication_id = 'pub_default' AND key = 'headerCode';
UPDATE settings SET value = '""' WHERE publication_id = 'pub_default' AND key = 'footerCode';

-- 3. Authors
UPDATE users SET name = 'Elena Vance' WHERE id = '500bfa35-d947-437b-b4ae-87e75812b915';
UPDATE users SET name = 'Marcus Thorne' WHERE id = 'e60b1072-4c90-489d-b067-5c098ca4e6b1';
UPDATE users SET name = 'Julian Ross' WHERE id = '517cb15c-a6e8-4b45-af0d-89f411b43d59';
UPDATE users SET name = 'Sophia Chen' WHERE id = '8acc5bf6-41f5-43e2-8c61-936870c3836f';

-- 4. Editorial media assets
INSERT INTO media_assets (
  id, publication_id, storage_provider, storage_key, original_filename,
  display_name, mime_type, extension, size_bytes, checksum, asset_type, width, height, metadata
) VALUES
  ('asset-editorial-arch', 'pub_default', 'local', 'editorial/architecture.jpg', 'architecture.jpg',
   'Minimalist Architecture', 'image/jpeg', 'jpg', 234241, 'chk-arch-1200', 'image', 1200, 800, '{"url": "/editorial/architecture.jpg"}'),
  ('asset-editorial-typo', 'pub_default', 'local', 'editorial/typography.jpg', 'typography.jpg',
   'Editorial Typography', 'image/jpeg', 'jpg', 111039, 'chk-typo-1200', 'image', 1200, 800, '{"url": "/editorial/typography.jpg"}'),
  ('asset-editorial-work', 'pub_default', 'local', 'editorial/workspace.jpg', 'workspace.jpg',
   'Quiet Editorial Studio', 'image/jpeg', 'jpg', 128819, 'chk-work-1200', 'image', 1200, 800, '{"url": "/editorial/workspace.jpg"}'),
  ('asset-editorial-abstr', 'pub_default', 'local', 'editorial/abstract.jpg', 'abstract.jpg',
   'Kinetic Form and Color', 'image/jpeg', 'jpg', 64473, 'chk-abstr-1200', 'image', 1200, 800, '{"url": "/editorial/abstract.jpg"}')
ON CONFLICT (id) DO UPDATE SET
  storage_key = EXCLUDED.storage_key,
  display_name = EXCLUDED.display_name,
  metadata = EXCLUDED.metadata;

-- 5. Tags
INSERT INTO tags (id, publication_id, name, slug, description) VALUES
  ('tag-editorial-design', 'pub_default', 'Design Systems', 'design-systems', 'Interface architecture and design systems.'),
  ('tag-editorial-typo', 'pub_default', 'Typography', 'typography', 'Macro and micro-typography principles.'),
  ('tag-editorial-arch', 'pub_default', 'Architecture', 'architecture', 'Physical and digital spatial design.'),
  ('tag-editorial-craft', 'pub_default', 'Editorial Craft', 'editorial-craft', 'Publishing workflows and editorial standards.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug;

-- Clean up any test tags from previous test runs
DELETE FROM post_tags WHERE tag_id = '07c440a1-9824-42f8-9385-c21e035a0d1d';
DELETE FROM tags WHERE id = '07c440a1-9824-42f8-9385-c21e035a0d1d';

-- 6. Hide or unpublish any ad-hoc test posts
UPDATE posts SET status = 'draft' 
WHERE publication_id = 'pub_default' 
  AND id NOT IN (
    'bb46491c-dd25-492c-a035-89745ceffd6c',
    '18c6584c-385e-4340-ad06-4f3f6d4f74d4',
    'c9c5fe2b-1d2c-46cf-88dc-5ec3b6df26d7',
    'a1825127-6b22-4841-9152-4b37917d9501'
  );

-- 7. Polish the 4 primary editorial articles
UPDATE posts SET
  title = 'The Architecture of Quiet Interfaces',
  slug = 'the-architecture-of-quiet-interfaces',
  excerpt = 'How intentional whitespace, typographic restraint, and optical grid alignment elevate digital readability.',
  feature_image_id = 'asset-editorial-arch',
  primary_author_id = '500bfa35-d947-437b-b4ae-87e75812b915',
  featured = true,
  status = 'published',
  published_at = NOW() - interval '2 hours'
WHERE id = 'bb46491c-dd25-492c-a035-89745ceffd6c';

UPDATE posts SET
  title = 'Principles of Minimalist Typography',
  slug = 'principles-of-minimalist-typography',
  excerpt = 'The enduring principles of lead type continue to govern reading comfort on modern high-density displays.',
  feature_image_id = 'asset-editorial-typo',
  primary_author_id = 'e60b1072-4c90-489d-b067-5c098ca4e6b1',
  featured = false,
  status = 'published',
  published_at = NOW() - interval '1 day'
WHERE id = '18c6584c-385e-4340-ad06-4f3f6d4f74d4';

UPDATE posts SET
  title = 'Designing for Focus in the Modern Web',
  slug = 'designing-for-focus-in-the-modern-web',
  excerpt = 'Reclaiming human attention through calm, purposeful interface design and quiet digital architecture.',
  feature_image_id = 'asset-editorial-work',
  primary_author_id = '8acc5bf6-41f5-43e2-8c61-936870c3836f',
  featured = false,
  status = 'published',
  published_at = NOW() - interval '2 days'
WHERE id = 'c9c5fe2b-1d2c-46cf-88dc-5ec3b6df26d7';

UPDATE posts SET
  title = 'The Renaissance of Independent Media',
  slug = 'the-renaissance-of-independent-media',
  excerpt = 'Why focused, ad-free editorial publications are winning the attention of discerning readers worldwide.',
  feature_image_id = 'asset-editorial-abstr',
  primary_author_id = '517cb15c-a6e8-4b45-af0d-89f411b43d59',
  featured = false,
  status = 'published',
  published_at = NOW() - interval '3 days'
WHERE id = 'a1825127-6b22-4841-9152-4b37917d9501';

-- Link tags
DELETE FROM post_tags WHERE publication_id = 'pub_default';
INSERT INTO post_tags (post_id, tag_id, publication_id) VALUES
  ('bb46491c-dd25-492c-a035-89745ceffd6c', 'tag-editorial-design', 'pub_default'),
  ('18c6584c-385e-4340-ad06-4f3f6d4f74d4', 'tag-editorial-typo', 'pub_default'),
  ('c9c5fe2b-1d2c-46cf-88dc-5ec3b6df26d7', 'tag-editorial-arch', 'pub_default'),
  ('a1825127-6b22-4841-9152-4b37917d9501', 'tag-editorial-craft', 'pub_default');

COMMIT;
`;

console.log("Seeding editorial staging content...");
runSql(seedSql);
console.log("Staging content seeded successfully.");
