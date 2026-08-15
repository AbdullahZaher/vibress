# ADR-012: Database transaction strategy (AsyncLocalStorage unit of work)

**Status:** Accepted (H1, post-v1 hardening)

**Decision:** Use an AsyncLocalStorage-based transaction context in
`@vibress/database`. Application use cases wrap multi-record workflows in
`runInTransaction(work)`, and `getDb()` transparently returns the
transaction-scoped executor while a transaction is active. Nested
`runInTransaction` calls reuse the current transaction; no savepoints are
created.

**Reason:** Virtually every repository in the workspace accesses the database
through `getDb()`. Threading Drizzle transaction objects through every domain
API would leak infrastructure types into public domain contracts and require
widespread signature churn. The ALS approach makes all existing repositories
join the active transaction automatically, so atomicity is achieved by
wrapping the use case once, with zero repository changes.

**Consequences:**

- Drizzle transaction types do not leak into domain public APIs.
- Atomic workflows covered so far: Posts and Pages full lifecycle,
  `setPostAuthors` / `setPageAuthors`, media reference replacement.
- Failure injection tests in `tests/integration/transactions.test.ts` prove
  full rollback when audit/revision/tag/media inserts fail.
- Every logical operation that must commit atomically must be wrapped by the
  application service layer — the runner does not infer boundaries by itself.
- Remaining domains (billing, storage, newsletters, community, settings,
  automations, import) are scheduled in batch H1B.
