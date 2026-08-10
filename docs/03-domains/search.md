# Search

## Scope

Posts, Pages, Tags (Authors = staff users who author content, indexed via the
users table in a future iteration). Public search must exclude drafts,
scheduled/private/unpublished content, and anything the requester cannot
access.

## Backend

PostgreSQL with `pg_trgm` (trigram GIN indexes on `title` and `body_text`).
No external search cluster. The `SearchService` domain boundary keeps the
backend swappable.

## Index

`search_documents`: `UNIQUE(entity_type, entity_id)`, `searchable` flag,
`title`, `body_text`, `slug`, `url`.

## Lifecycle (event-driven + queued)

```text
publish   → post.published   → upsert
unpublish → post.unpublished → remove
delete    → post.deleted     → remove
rebuild   → admin triggers   → clear + re-index (worker)
```

Jobs are idempotent (upsert/remove are upserts). Defense in depth: the
worker re-verifies each entity is `published` + `public` before indexing —
restricted (members/paid) content is **never** searchable, even if a stale
event arrives.

## Query

`GET /api/content/v1/search?q=...&limit=&offset=`

- Query length bound (100 chars), pagination, result limit (max 50).
- Rate limited (30/min; 200/min in test).
- Pathological wildcard-only queries rejected.
- Ranking: title matches > slug matches > body matches, then trigram
  similarity, then recency.
- Results contain safe DTOs (title, excerpt ≤200 chars, URL) — never raw
  snippets of restricted content.

## Rebuild

`POST /api/admin/v1/search/rebuild` (`search.manage`) enqueues a full rebuild
job to the worker. `GET /api/admin/v1/search/index-count` reports index size.
