# Worker Tenant Context Matrix

## 1. Overview & Architectural Policy

In Vibress's multi-publication architecture, background workers must never execute cross-tenant operations or rely on ambient un-scoped database queries. Every asynchronous queue message, scheduled sweep, and background job must explicitly resolve, validate, and bind its execution to a specific `publication_id`.

No worker may process records or dispatch events without verifiable tenant isolation.

---

## 2. Worker Tenant Context Matrix

| Job | Queue | Entity | Publication Source | Current Context | Required Context | Retry Behavior | Idempotency | Risk Level |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ContentSchedulerWorker` | Process Timer (`worker.scheduler`) | `posts`, `pages` | Row `post.publication_id`, `page.publication_id` | Global query on `scheduled_at <= now` without publication filter | Scoped per publication or sweep must retain row's `publication_id` and pass into `publishPost(id, actorId, publicationId)` | In-memory loop with error logging per item; continues next cycle | Target state is checked; if status is already `published`, operation is a no-op | **Medium**: Accidental publication across boundaries if publish logic lacks publication assertion |
| `SearchIndexJob` | `vibress-search` | `search_documents`, `posts`, `pages`, `tags` | Originating entity's `publication_id` | `{ op, doc?, entityType?, entityId? }` (No `publicationId`) | `{ op, publicationId, entityType, entityId, doc? }` | 3 BullMQ attempts with exponential backoff | Upsert on `(publication_id, entity_type, entity_id)` | **P0 / High**: Cross-tenant search document pollution; search queries leaking content across publications |
| `SearchRebuildJob` | `vibress-search` | `search_documents` | Selected `publication_id` or sequential per publication | Global rebuild across all posts/pages/tags in entire DB | Rebuild job MUST carry `publicationId`: `{ op: "rebuild", publicationId: string }` | Job-level BullMQ retry | Per-publication purge and reindex | **P0 / High**: Un-scoped rebuild wipes or mixes index entries across publications |
| `WorkerSearchContentSource` | In-process (Worker) | `posts`, `pages`, `tags` | Query parameters | Global `postRepo.list({ publishedOnly: true })` | `postRepo.list({ publicationId, publishedOnly: true })` | Inherited from `SearchRebuildJob` | Pure read source for reindex | **P0 / High**: Feeds global rows into search index if un-scoped |
| `AutomationRunJob` | `vibress-automations-run` | `automation_runs`, `automations` | `automations.publication_id` | `{ runId }` (derivable via `automation_runs -> automations`) | `{ runId, publicationId }` validated against `automation.publication_id` | 5 BullMQ attempts with exponential backoff | State machine: completed steps are never re-executed | **Medium**: Automation runner could execute against unintended publication if run lookup lacks tenant check |
| `AutomationDelayedStepJob` | `vibress-automations-run` | `automation_runs`, `automations` | `automations.publication_id` | `{ runId, stepIndex, resumeAt }` | `{ runId, publicationId, stepIndex, resumeAt }` | 5 BullMQ attempts with exponential backoff | Step index validation; resumes exact waiting step | **Medium**: Resumed job executing in wrong publication context |
| `AutomationActionExecutor` | In-process (Worker) | `members`, `newsletters`, `webhooks` | Automation run context | Global domain service calls | Injected `publicationId` passed to all target domain service invocations | Governed by `AutomationRunnerWorker` | Action state machine records step execution status | **P1 / High**: Cross-tenant side-effects (e.g. sending email from Publication A using Publication B's member list) |
| `EmailDeliveryJob` | `vibress-email-delivery` | `email_recipients`, `newsletters`, `members` | `newsletters.publication_id` | `{ sendId, recipientBatch }` | `{ sendId, publicationId, recipientBatch }` | Up to 3 attempts per recipient batch with backoff | Checks `sentAt` timestamp in `email_recipients` before sending | **P0 / High**: Cross-tenant email dispatch or leakage of member email addresses |
| `NewsletterSendSchedulerWorker` | Process Timer | `newsletter_sends`, `newsletters` | `newsletters.publication_id` via `send.newsletterId` | Polling `findDueScheduledSends(now)` without publication scoping | Sweeps due sends; extracts `publication_id` from send; passes `publicationId` into `startSendAndEnqueue` | State machine transitions (`draft` -> `scheduling` -> `sending` -> `sent`) | State check prevents duplicate send batch creation | **P1 / High**: Multiple publications' scheduled sends triggered without tenant isolation |
| `WebhookDeliveryJob` | `vibress-webhook-delivery` | `webhook_endpoints`, `webhook_deliveries` | `webhook_endpoints.publication_id` | `{ deliveryId, endpointId }` | `{ deliveryId, endpointId, publicationId }` | Bounded retries with exponential backoff | `webhook_deliveries.status` updated transactionally | **Medium**: Endpoint secret or payload dispatch could cross publication boundaries |
| `AnalyticsJob` | `vibress-analytics` | `analytics_events` | `event.context.publicationId` | `{ event: IngestEventData }` (where `publicationId` is optional) | `publication_id` must be mandatory on `event` and `analytics_events` table | Non-fatal: logged and dropped on validation failure | Unique `event_id` prevents duplicate insertion | **Low**: Analytics is an append-only log, but un-scoped data leaks metrics into global rollups |
| `AnalyticsRetentionSweeper` | Process Timer | `analytics_events` | System maintenance | Deletes traffic events older than 90 days globally | System-level maintenance sweeper; safe to run globally or scoped per publication retention policy | Non-fatal catch block | Idempotent time-range deletion | **Low**: Maintenance sweeper only touches raw traffic events (`post.view`, `page.view`) |
| `OutboxDispatcherWorker` | Polling Loop / Worker | `outbox_events` | `outbox_events.payload.publicationId` | `{ eventType, payload }` relayed to queue without validating tenant envelope | Envelope parser MUST assert `publicationId`; passes `publicationId` into destination queue jobs | Polling loop with exponential backoff on database error | Transactional `processed = true` update on `outbox_events` | **P0 / High**: Core event bus; failure to propagate `publicationId` leads to un-scoped downstream worker jobs |

---

## 3. Worker Implementation Rules for Phase 8–11

1. **Mandatory Envelope Property**:
   All BullMQ jobs processed by `vibress-search`, `vibress-automations-run`, `vibress-email-delivery`, and `vibress-webhook-delivery` MUST include `publicationId: string` as a top-level payload field.
2. **Pre-Execution Tenant Assertion**:
   Before initiating business logic or database writes, the processor must assert:
   ```ts
   if (!job.data.publicationId) {
     throw new UnrecoverableWorkerError("Missing mandatory publicationId in worker payload");
   }
   ```
3. **Anti-Forgery Entity Ownership Verification (MANDATORY)**:
   A mandatory `publicationId` field is necessary but insufficient.
   Every worker must verify:
   ```ts
   if (entity.publicationId !== job.data.publicationId) {
     throw new ForgedTenantContextError(
       `Tenant mismatch: entity ${entity.id} belongs to publication ${entity.publicationId}, but job specified ${job.data.publicationId}`
     );
   }
   ```
   A forged or cross-wired payload such as:
   ```json
   {
     "publicationId": "publication-A",
     "entityId": "entity-owned-by-publication-B"
   }
   ```
   **MUST fail closed immediately** without executing any downstream actions, indexing, email dispatch, or webhook invocation.
4. **Repository Scoping in Workers**:
   Workers must not instantiate un-scoped repositories. Repositories must query with `WHERE publication_id = :publicationId AND id = :entityId`. If the entity belongs to another publication, the query returns `null` (not found), safely preventing cross-tenant operations.
5. **Outbox Envelope Propagation**:
   The `OutboxDispatcherWorker` must extract `publicationId` from the domain event and inject it into the BullMQ job payload. Jobs without a valid `publicationId` must be routed to a dead-letter queue and flagged for administrative inspection.
