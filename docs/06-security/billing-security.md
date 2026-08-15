# Billing Security

## Identity Boundary

- Subscriptions belong to `member.id`. Staff identity, email, and sessions are
  never subscription identity.
- Member billing data is only reachable by the authenticated owning member and
  by staff with `subscriptions.read`/`subscriptions.manage`.

## IDOR Protection

Every member subscription operation loads the subscription server-side and
verifies `subscription.memberId === req.member.id` before acting (view,
cancel, resume). Cross-member access returns 404 (not 403) to avoid leaking
existence. Covered by integration and E2E tests.

## CSRF

All cookie-authenticated state-changing billing endpoints
(checkout, portal, cancel, resume) use the Batch 8 member origin validation.
Requests without a valid `Origin`/`Referer` are rejected with 403.

## Webhooks

- Signature verification is the sole authentication (no cookie auth).
- Verification happens on the raw received body before any parsing.
- Event IDs are deduplicated durably; replays cannot change state twice.
- Payload size capped at 256 KB; invalid signatures return 400.

## Payment Data

- Vibress never handles raw card data (PAN). Checkout is provider-hosted.
- Provider secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) never reach
  browsers, logs, audit payloads, error messages, or API responses.
- No raw provider payloads are stored; only hashes and safe normalized data.

## Rate Limits

| Endpoint                            | Limit                      |
| ----------------------------------- | -------------------------- |
| checkout / portal / cancel / resume | 10/min (100/min in test)   |
| webhook endpoint                    | 600/min (1000/min in test) |
| auth verify                         | 20/min (200/min in test)   |

## Open Redirects

Checkout success/cancel and billing-portal return URLs are constructed only
from trusted `PORTAL_URL` configuration plus fixed internal paths. Host header,
Origin, Referer, and user-provided URLs are never used in redirects.

## Error Model

Client-visible billing errors use the stable envelope:

```json
{
  "errors": [
    { "code": "SUBSCRIPTION_NOT_FOUND", "message": "...", "requestId": "..." }
  ]
}
```

Provider errors are mapped inside the adapter to `BILLING_PROVIDER_UNAVAILABLE`
/ `BILLING_CONFIGURATION_ERROR`; raw Stripe errors never reach clients.
