# Email Delivery (Infrastructure)

## Queue

- BullMQ queue `vibress-email-delivery` (Redis via `getBullMqRedisConnection` —
  `maxRetriesPerRequest: null` per BullMQ requirement).
- Jobs: `{ sendId, recipientIds }` with stable IDs `send-<sendId>-batch-<i>`.
- Defaults: 5 attempts, exponential backoff from 5s.

## Worker

`apps/worker/src/processors/email-delivery-worker.ts`

- Consumes batches with concurrency 4.
- Per recipient: only `pending` rows are sent (idempotency), suppression
  re-checked, `renderEmailHtml` → SMTP send → `markSent` + `email.sent` event.
- After a batch: send counters are updated from recipient statuses; when
  `sent + failed == total_recipients`, the send is marked `sent`.
- Job exhaustion marks remaining pending recipients `failed` (visible).

## Scheduled Sends

`apps/worker/src/schedules/newsletter-send-scheduler.ts` polls the database
for due `scheduled` sends (5s sweep) and enqueues their batches. Schedules are
durable in PostgreSQL — worker restarts never lose a scheduled send.

## API Enqueuer

`apps/api/src/newsletter-send-enqueuer.ts` provides the same snapshot +
enqueue path for `send-now` requests. The worker and the API share recipient
status guards, so dual processing cannot double-send.

## Restart Recovery

- Scheduled sends: persisted in `newsletter_sends` (`scheduled` + `scheduled_at`).
- In-flight batches: BullMQ jobs retry with backoff; recipients already `sent`
  are skipped by the status guard.
- A retried job cannot double-send the same recipient.
