# Newsletters

## Model

`newsletters` holds durable newsletter definitions with stable keys and
archival semantics (never hard-deleted — historical sends reference them).

| Field                                       | Notes                                                       |
| ------------------------------------------- | ----------------------------------------------------------- |
| `key`                                       | Stable identifier, unique, lowercase alphanumeric + hyphens |
| `name` / `description`                      | Display metadata                                            |
| `sender_name` / `sender_email` / `reply_to` | Used on every send                                          |
| `status`                                    | `active` / `archived`                                       |

Validation: key syntax, name length, sender email format, and **control
characters are rejected** in name/sender fields (header-injection guard at the
domain boundary; the SMTP adapter additionally strips CR/LF at send time).

## Member Preferences

`newsletter_preferences` maps members to newsletters with
`UNIQUE(member_id, newsletter_id)`.

- Subscribe/unsubscribe is explicit; profile edits never silently resubscribe.
- Unsubscribed members keep their preference row (explicit `subscribed=false`),
  so the exclusion is durable and idempotent.
- Events: `member.newsletter_subscribed`, `member.newsletter_unsubscribed`.

## Sends (Campaigns)

`newsletter_sends` snapshots everything needed for delivery:

| Field                                       | Notes                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `subject`, `content`, `content_version`     | Studio document snapshot (canonical JSON)                                     |
| `sender_name` / `sender_email` / `reply_to` | Snapshot from the newsletter                                                  |
| `audience`                                  | Snapshot of the audience definition (`all` / `paid` / `free`, product filter) |
| `scheduled_at`                              | Durable schedule (DB, restart-safe)                                           |
| `status`                                    | `draft` / `scheduled` / `sending` / `sent` / `failed` / `cancelled`           |
| counters                                    | `total_recipients`, `sent_recipients`, `failed_recipients`                    |

Delivery never depends on mutable source content — recipients and content are
snapshotted when the send starts.

## Audience Resolution

Deterministic baseline (`NewslettersService.computeAudience`):

```text
active members (status=active, email verified)
  ∩ subscribed to the newsletter (preference row, subscribed=true)
  ∩ not suppressed (email domain policy)
  ∩ paid/free filter (has active/trialing paid subscription)
  ∩ product filter (subscription on the given product)
```

No segmentation DSL in v1. Recipients are snapshotted into `email_recipients`
before delivery so mid-send membership changes cannot corrupt the campaign.
The paid/free filter is enforced in the audience repository and re-checked in
the domain (defense in depth).

## Delivery Pipeline

```text
Staff send/schedule
  → validate + snapshot audience definition
  → (worker scheduler or API enqueuer) resolve audience → create email_recipients
  → enqueue BullMQ batches (vibress-email-delivery)
  → worker sends via EmailProvider
  → provider result persisted (provider_message_id)
  → provider webhooks update recipient state (delivered/bounced/…)
```

## Unsubscribe

Cryptographically signed, scoped, idempotent tokens:

```text
token = base64url(memberId:sendId) + "." + HMAC-SHA256(secret, "unsub:" + payload)
```

- No member login required.
- Scoped: a token can only unsubscribe the member it was issued for.
- Idempotent: already-unsubscribed is a no-op success.
- Tokens are never logged; the secret is environment configuration.

## Test Email

Authorized staff (`newsletters.send`) can send test emails to explicit
recipients. Test sends:

- never mark a real send complete,
- never mutate audience membership or recipient state,
- are rate limited (10/min, 100/min in test),
- produce a safe audit-visible result list.
