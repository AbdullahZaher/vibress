# Webhook Security

Outbound webhook delivery is a high-risk SSRF surface. See
`docs/06-security/plugin-security.md` for the full security model. This file
documents the outbound-specific guarantees.

## SSRF Protections (all layers)

1. **Registration**: `isSafeUrl` rejects non-http(s), localhost, private and
   reserved IP literals.
2. **Delivery**: the centralized `safeFetch` client:
   - resolves DNS and blocks private/reserved ranges,
   - re-checks the connected socket IP (DNS rebinding guard),
   - rejects redirects for POST (no credential/body exfiltration via
     redirect),
   - enforces timeout (10s) and response-size (256 KB) bounds.

## Signing Algorithm

```
signature = HMAC-SHA256(secret, canonicalPayload)
canonicalPayload = JSON.stringify({ id: eventId, type: eventType, timestamp })
headers:
  X-Vibress-Event-Id
  X-Vibress-Event-Type
  X-Vibress-Timestamp
  X-Vibress-Signature: sha256=<hex>
```

Receivers verify by recomputing the HMAC with their shared secret.

## Idempotency

- `webhook_deliveries.UNIQUE(endpoint_id, event_id)` prevents duplicate
  delivery rows for replayed events.
- Retries reuse the same `event_id` and payload.
- Worker re-delivery cannot double-send: the delivery row is the source of
  truth and status transitions are monotonic (`pending → delivered/failed →
  dead_letter`).

## Retry / Dead Letter

- Transient failures retry with bounded backoff (max 5 attempts).
- After exhaustion the delivery is marked `dead_letter` and remains visible
  in admin delivery history with `last_error`.
- Configuration failures (invalid URL shape) fail visibly at registration.
