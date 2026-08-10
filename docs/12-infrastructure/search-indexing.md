# Search Indexing (Infrastructure)

## Flow

```text
post.published → bridge → BullMQ `vibress-search` (op: upsert)
post.unpublished / post.deleted → bridge → queue (op: remove)
admin rebuild → queue (op: rebuild)
  → SearchIndexerWorker: verifies published+public, upserts into
    search_documents (pg_trgm GIN indexes on title + body_text)
```

## Safety

- The worker re-checks entity status/visibility before every upsert —
  restricted content can never enter the index.
- Rebuild clears the index and re-indexes only published, public content.
