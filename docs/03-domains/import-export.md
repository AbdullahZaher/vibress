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
format are unchanged. New export artifact keys are namespaced by publication,
while existing job IDs and legacy artifact metadata remain stored.

Redirects are currently global rather than publication-owned. To avoid
cross-publication side effects, only `pub_default` can import or export them;
secondary-publication exports include an empty `redirects` array, and jobs
trying to import non-empty global redirects from secondary publications fail.
Imported secret/internal settings and executable `code` settings are rejected
by the processor rather than bypassing permission restrictions.

The HTTP API continues to require staff sessions, permission checks and origin
validation on mutating endpoints. In a future release, fully publication-owned
redirects would require their own additive migration and service scoping.
