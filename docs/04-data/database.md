# Database Architecture

## Primary database

Vibress uses PostgreSQL as the primary relational database.

Recommended ORM/query layer: Drizzle.

## Package layout

```text
packages/database/
├── src/
│   ├── client/
│   │   ├── postgres.ts
│   │   └── transaction.ts
│   │
│   ├── schema/
│   │   ├── users.ts
│   │   ├── roles.ts
│   │   ├── permissions.ts
│   │   ├── posts.ts
│   │   ├── pages.ts
│   │   ├── tags.ts
│   │   ├── members.ts
│   │   ├── media.ts
│   │   ├── comments.ts
│   │   ├── subscriptions.ts
│   │   ├── newsletters.ts
│   │   ├── analytics.ts
│   │   ├── integrations.ts
│   │   └── settings.ts
│   └── index.ts
├── migrations/
├── seeds/
├── fixtures/
├── drizzle.config.ts
└── package.json
```

## Database rules

- Use UUID/ULID strategy consistently.
- Use UTC timestamps.
- Use explicit foreign keys.
- Prefer soft deletion only for entities where historical retention is required.
- Avoid database cascades unless lifecycle semantics are unambiguous.
- Use numeric/decimal columns for money, never binary floating point.
- Keep external provider identifiers unique within the correct tenant/provider scope.
- Store credentials encrypted, not hashed, when they must be recoverable.

## Transactions

Any multi-record state transition must be atomic.

Examples:

- publishing a post and writing its revision
- creating a subscription and entitlement
- completing a media upload and finalizing metadata

## Migrations

Migration files are immutable after release.

CI should:

- verify migration ordering
- reject modified released migrations
- run migration tests against a clean database
- run upgrade tests from supported previous versions
