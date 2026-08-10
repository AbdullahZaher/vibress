# Members Domain

## Overview

Batch 8 introduces the Member identity system: a separate security principal from Staff users. Members sign in to the Portal via passwordless email magic links and will become the foundation for subscriptions, billing, and newsletter preferences in later batches.

**Core invariant**: A Staff user and a Member are different principals. They may share an email address, but they are NOT the same account, NOT the same session, and NOT the same authorization model.

```
Staff User  → users table → staff sessions → RBAC → Admin
Member      → members table → member sessions → Portal
```

## Member vs Staff

| | Staff | Member |
|---|---|---|
| Table | `users` | `members` |
| Sessions | `sessions` | `member_sessions` |
| Auth tokens | staff password/session | passwordless magic links |
| Cookie | `vibress_session` | `vibress_member_session` |
| Middleware | `requireStaffSession` | `requireMemberSession` |
| Permissions | Staff RBAC | none (member identity only) |

No `member` role was added to Staff RBAC. `members.read` / `members.manage` are Staff permissions that protect Admin member-management routes.

## Schema

### `members`

| Column | Purpose |
|--------|---------|
| `id` | opaque UUID (stable, future FK target for subscriptions) |
| `email` | display email |
| `email_normalized` | unique canonical email (trim + lowercase) |
| `name` | optional profile name |
| `status` | `active` \| `disabled` |
| `email_verified_at` | set on first successful magic-link verification |
| `last_seen_at` | optional |
| `disabled_at` | set when disabled |
| `created_at` / `updated_at` | UTC timestamps |

### `member_auth_tokens`

Passwordless magic-link challenges. Stores **SHA-256 hash only** — never the raw token.

| Column | Purpose |
|--------|---------|
| `member_id` | owning member |
| `token_hash` | SHA-256(token) |
| `purpose` | `authenticate` |
| `expires_at` | 15 minutes |
| `used_at` | single-use marker (atomic compare-and-set) |

### `member_sessions`

Opaque session tokens, hashed. 30-day expiry, revocable.

## Email Normalization

- Trim whitespace.
- Lowercase the full address (including domain).
- Case-insensitive uniqueness enforced by DB unique index on `email_normalized`.
- Deliberately does NOT strip `+` aliases or Gmail dots — those can merge distinct identities.

## Lifecycle

1. `POST /api/members/v1/auth/request` with email.
2. Unknown email → member created (if signup enabled) with `email_verified_at = null`; a magic link is emailed.
3. Known email → new magic link; previous outstanding tokens invalidated (latest wins).
4. Member opens link → token verified (single-use, race-safe) → `email_verified_at = now` → member session created → cookie set.
5. Disabled members: no usable token is issued; existing sessions are invalidated on disable.
6. `POST /api/members/v1/auth/logout` revokes the current session.

## Future Compatibility

- Subscriptions (Batch 9) will reference `member.id` — never email or Staff user IDs.
- Newsletter consent (Batch 10) is separate; sign-in does not imply marketing consent.

## Domain Events

`member.created`, `member.email_verified`, `member.authenticated`, `member.logged_out`, `member.auth.requested`, `member.disabled`, `member.enabled`, `member.profile.updated`, `member.auth.mail_failed`.
