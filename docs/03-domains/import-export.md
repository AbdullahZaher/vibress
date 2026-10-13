# Import / Export

## Format

Versioned Vibress-native envelope (`format: 'vibress'`, `version: 1`).
Arbitrary object shapes are rejected; wrong format names and unsupported
versions fail validation.

## Import Safety

- File-size limits (50 MB), MIME/type validation via envelope shape.
- Zip-slip defense: `assertSafeArchivePath` rejects absolute paths, drive
  letters, and `..` traversal.
- Zip-bomb defense: bounded entry counts (2000) and uncompressed totals.
- Transactional boundaries: each entity imports independently; failures are
  reported per-item and the job is marked failed with an error summary.
- Imported content passes the same rendering/security rules as normal
  content; imported plugins/themes are never installed automatically.

## Import Scope (v1)

Safe portable data: redirects and non-secret settings. Posts/pages/tags
envelope support is validated; content import flows through the content
domain. No external CMS importers.

## Export

Asynchronous jobs produce portable data (settings without secrets,
redirects). Excluded: session tokens, API key secrets, Stripe/provider
secrets, S3 secrets, email/webhook secrets, and `VIBRESS_ENCRYPTION_KEY`.

## Jobs

`import_export_jobs` persists `type`, `status` (pending/running/completed/
failed/cancelled), `progress`, `errorSummary`, `artifactKey`,
`artifactExpiresAt` (24h retention). Artifact download requires
`exports.manage` and enforces expiry.

## Publication isolation (migration 0034)

Import/export jobs are owned by a non-nullable `publication_id` foreign key;
existing jobs are attributed to `pub_default` on upgrade. The authenticated
staff publication determines ownership when a job is created; job ID alone does
not authorize access. Job lists, artifact retrieval, and status updates are
publication-scoped. Cross-publication artifact IDs return 404.

The job's persisted publication travels into import/export processors. Settings
are written/read only for that publication, with no caller-supplied tenant ID in
the import/export envelope. Public response envelopes and the version 1 file
format are unchanged. Export artifact keys retain the historical `exports/<jobId>.json` format;
publication authorization is enforced on job and artifact lookups.

After migration 0035, redirects are publication-owned. Imports write
redirects only to the job's publication, and exports collect redirects only
from that publication; secondary publications can safely round-trip their
own rules. Version-1 envelopes and job artifact keys remain unchanged.
Imported secret/internal settings and executable `code` settings are rejected
by the processor rather than bypassing permission restrictions.

The HTTP API continues to require staff sessions, permission checks and origin
validation on mutating endpoints. Publication-owned redirect rules are enforced by migration 0035 and the
redirects domain.
