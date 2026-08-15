# Plugin & Webhook Security

## Plugin Security

- **Trusted code only**: bundled plugins from controlled sources; no runtime
  npm install, no arbitrary uploaded packages, no remote code.
- **Manifest validation**: incompatible `vibressApiVersion` and unknown
  capabilities are rejected before registration (`INVALID_MANIFEST`).
- **SDK boundary**: plugins import only `@vibress/plugin-sdk`; private
  internals (database schema, repositories, security key material) are never
  exposed to plugins.
- **Secret handling**: plugin secrets are encrypted at rest, masked on read
  (read APIs return `••••••••`), never logged, and replace-only on update.
  Verified by integration tests (secret value absent from both API responses
  and database rows).
- **Failure isolation**: activation failure marks the plugin `error` and
  throws a domain error; core functionality continues.

## API Key Security

- Raw secrets are never stored — only SHA-256 hashes; the full raw secret is
  shown exactly once at creation.
- Revoked keys rejected; expired keys rejected; unknown keys rejected — all
  with the same generic `401` response (no enumeration).
- Exact scope enforcement with `403 SCOPE_DENIED`.
- Machine auth is fully separate from Staff/Member sessions.

## Webhook Security

- **SSRF**: endpoint URLs validated at registration (`isSafeUrl`) AND every
  delivery goes through the hardened `safeFetch` client (private-IP blocking,
  DNS-rebinding guards, socket-level checks, redirect rejection for POST,
  timeouts, size bounds). localhost/private/link-local/169.254 addresses are
  blocked. Verified by integration + E2E tests.
- **Signing**: every delivery carries `X-Vibress-Signature:
sha256=<HMAC-SHA256(secret, payload)>` plus stable event ID/timestamp.
- **Replay/dedup**: `UNIQUE(endpoint_id, event_id)` — a repeated event cannot
  create a duplicate delivery.
- **Retry idempotency**: retries reuse the same event identity.
- **Secret handling**: webhook signing secrets encrypted at rest, masked in
  DTOs, never logged.

## Inbound Webhook Framework

The existing inbound webhook plumbing (raw body preserved, signature
verification, durable event dedup, safe ACK, payload limits) remains in place
for billing and email providers — unchanged and regression-tested. Outbound
delivery does not weaken any inbound guarantees.
