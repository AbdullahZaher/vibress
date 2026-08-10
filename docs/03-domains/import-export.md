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
