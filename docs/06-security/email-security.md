# Email Security

## Header Injection

- Domain validation rejects control characters (CR/LF) in newsletter names,
  sender names, and sender emails at create/update time.
- The SMTP adapter additionally strips `\r\n"<>` from display names before
  constructing headers.

## XSS

- Email content is rendered from canonical Studio documents via
  `@vibress/studio-renderer` with `target: 'email'` — the renderer escapes
  text nodes and sanitizes URLs. Arbitrary Web HTML is never the email source.
- Unsubscribe URLs are constructed server-side from trusted configuration.

## Unsubscribe Tokens

- HMAC-SHA256 signed (`base64url(memberId:sendId).<hmac>`), verified with
  timing-safe comparison.
- Forged/expired tokens → `INVALID_UNSUBSCRIBE_TOKEN`, no member state changes.
- Scoped: a token can only unsubscribe its own member from the send's
  newsletter.
- Tokens are never logged and never stored in plaintext beyond the recipient
  row (which is required for link rendering).

## Email Bombing / Test-Send Abuse

- Test email: staff-only (`newsletters.send`), explicit recipients only,
  max 10 recipients per call, rate limited (10/min, 100/min in test).
- Send creation is rate limited; membership changes are snapshotted so a
  campaign cannot be re-audienced mid-flight.
- No unauthenticated send paths exist.

## Provider Webhooks

- Signature verification is the sole authentication (no cookie auth).
- Raw-body verification via scoped buffer parser (no re-serialization).
- `provider_events` dedup: `UNIQUE(provider, provider_event_id)`; replays and
  duplicates are idempotent.
- Payload cap 256 KB; invalid signatures return 400.
- Webhook logs contain provider, event ID, type, result — never the signature
  secret, unsubscribe tokens, or raw payloads.

## Secret Handling

`EMAIL_WEBHOOK_SECRET`, `NEWSLETTER_UNSUBSCRIBE_SECRET`, and SMTP credentials
are environment configuration. Never logged, never in API responses, never in
audit payloads, never in error messages.

## Duplicate-Send Prevention

- Recipient status guard: only `pending` recipients are sent (worker-side),
  so retried jobs cannot double-send.
- BullMQ job IDs are stable per send/batch, making queue retries idempotent.
- `UNIQUE(member_id, send_id)` prevents duplicate recipient rows.
