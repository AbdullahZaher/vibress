# Webhooks (Outbound)

## Model

`webhook_endpoints` — durable delivery endpoints.

| Field | Notes |
|---|---|
| `url` | http/https only, SSRF-validated |
| `secret_encrypted` | Per-endpoint signing secret, encrypted at rest |
| `enabled` | Delivery switch |
| `event_types` | Subscribed domain events (e.g. `comment.created`, `post.published`) |

`webhook_deliveries` — durable per-event delivery state.

| Field | Notes |
|---|---|
| `endpoint_id` FK | |
| `event_id` | Stable event identity (same across retries) |
| `payload_hash` | Event payload fingerprint |
| `status` | `pending` / `delivered` / `failed` / `dead_letter` |
| `attempt_count` / `last_error` / `response_status` | Delivery visibility |
| `UNIQUE(endpoint_id, event_id)` | Dedup — replays cannot duplicate |

## Signing

Each delivery is signed with the per-endpoint secret:

```
X-Vibress-Signature: sha256=<HMAC-SHA256(secret, canonical-event-payload)>
X-Vibress-Event-Id: <eventId>
X-Vibress-Event-Type: <eventType>
X-Vibress-Timestamp: <iso8601>
```

The canonical payload is stable for the event identity, so retries carry the
same signature inputs. Receivers verify by recomputing the HMAC with their
shared secret.

## SSRF Hardening

All outbound requests use the centralized `safeFetch` client
(`packages/security/src/http/safe-fetch.ts`):

- http/https allowlist only (no file://, ftp://, etc.)
- private/reserved IP blocking (RFC1918, loopback, link-local, CGNAT, IPv6)
- DNS rebinding protection: IPs validated at resolution AND on the connected
  socket
- redirect destination validation; POST redirects rejected outright
- timeouts (10s) and response-size bounds (256 KB)

Registration-time `isSafeUrl` rejects localhost/private/non-http URLs.

## Delivery Pipeline

```text
domain event emitted (EventBus)
  → WebhookEventBridge (API process) subscribes to subscribed events
  → WebhooksService.dispatchEvent persists deliveries + enqueues BullMQ
  → Worker (WebhookDeliveryWorker) delivers via safeFetch
  → 2xx → delivered; other → bounded retry (max 5)
  → attempts exhausted → dead_letter (visible in admin)
```

Retries reuse the same `event_id` (idempotent) and re-enqueue with backoff.
No domain transaction is held open across the network call.
