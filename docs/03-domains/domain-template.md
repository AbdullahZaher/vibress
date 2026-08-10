# Domain Package Template

Each domain should follow a consistent layout.

Example: `packages/domains/posts`

```text
posts/
├── src/
│   ├── domain/
│   │   ├── post.entity.ts
│   │   ├── post.types.ts
│   │   ├── post.events.ts
│   │   ├── post.errors.ts
│   │   └── post.repository.ts
│   │
│   ├── application/
│   │   ├── create-post.ts
│   │   ├── update-post.ts
│   │   ├── publish-post.ts
│   │   ├── schedule-post.ts
│   │   ├── unpublish-post.ts
│   │   └── delete-post.ts
│   │
│   ├── queries/
│   │   ├── get-post.ts
│   │   ├── list-posts.ts
│   │   └── search-posts.ts
│   │
│   ├── infrastructure/
│   │   └── drizzle-post.repository.ts
│   │
│   └── index.ts
│
├── tests/
└── package.json
```

## Layer definitions

### `domain/`
Pure business rules, entities, value objects, errors, domain events, and repository interfaces.

### `application/`
Use cases and orchestration of domain behavior.

### `queries/`
Read-oriented operations. These may use optimized read models when necessary.

### `infrastructure/`
Concrete adapters for persistence or external services.

## Command flow

```text
HTTP Controller
    ↓
Application Use Case
    ↓
Domain
    ↓
Repository Interface
    ↓
Infrastructure Adapter
    ↓
PostgreSQL
```

## Transaction rule

A use case that changes multiple records atomically must own the transaction boundary at application-service level.
