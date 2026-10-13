# Redirects

## Model

`publicationId` (non-null FK to publications), `source` (unique per publication), `destination`, `statusCode` (301/302/307/308
only), `enabled`, `sortOrder`.

## Rules

- Sources must be relative paths; protected route prefixes (`/api`, `/admin`,
  `/portal`, `/health`, `/content`, `/assets`) can never be hijacked.
- External destinations: http/https only; javascript/data schemes rejected;
  open-redirect abuse prevented.
- Loop prevention: `resolve()` follows a bounded chain (max 10 hops) and
  detects cycles.
- Public Web remains route owner; themes are presentation-only.

## Publication isolation (migration 0035)

Existing redirects are assigned to `pub_default` on upgrade; IDs, sources,
targets, and enabled flags are preserved. New rules belong to the authorized
staff publication. Repository reads, creates, updates, deletes and enabled
resolution are always constrained by `publication_id`; a redirect ID is not
authorization. Different publications can use the same source without conflict.

Public consumers use the hostname-derived publication context through
`GET /api/content/v1/redirects/resolve?path=/old`. Unmapped hosts return
404 and never fall back in production. The Next.js public middleware applies
returned 301/302/307/308 redirects, preserving a source query string when
the destination has no query. Protected system paths are excluded. Rules
remain host-local; no theme/plugin needs private database access.

Portable version-1 import/export envelopes are unchanged; redirects are now
imported/exported for the job's publication, including secondary publications.
