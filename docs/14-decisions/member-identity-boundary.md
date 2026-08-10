# Member Identity Boundary (ADR)

**Status**: Accepted (Batch 8)

## Context

Vibress already has a Staff identity system (Batch 1): `users`, roles, permissions, staff sessions, RBAC. Batch 8 introduces Member accounts for the Portal. These must be structurally separate security principals that can coexist in the same browser and share the same email address without collision.

## Decision

### 1. Separate tables, sessions, and auth

- `members` table (not `users`), with its own opaque UUID PK.
- `member_sessions` (not `sessions`), token hashes, 30-day expiry, revocable.
- `member_auth_tokens` for passwordless magic-link challenges (15-min, single-use, hashed).
- Distinct cookies: `vibress_member_session` vs `vibress_session`.
- Distinct middleware: `requireMemberSession()` vs `requireStaffSession()`.

### 2. No RBAC reuse

No `member` role is added to Staff RBAC. `members.read` / `members.manage` are Staff permissions that guard Admin member-management routes. Member identity confers no Staff privileges and vice versa.

### 3. Email is a login identifier, not an identity

`members.email_normalized` is unique, but Member identity is `member.id`. Future subscriptions (Batch 9) reference `member.id`. Email changes later will not change identity.

### 4. Passwordless email auth

Primary authentication is short-lived magic links with hashed token storage, single-use atomic consumption, enumeration-safe responses, and IP rate limiting. No passwords in Batch 8.

### 5. Enrollment semantics

Unknown email → member created unverified → magic link success verifies email. Signup can be disabled via `MEMBERS_SIGNUP_ENABLED=false`; existing members may still sign in.

### 6. Disabled members

Disabling revokes all sessions and blocks new token issuance. Re-enabling does not resurrect old sessions.

## Consequences

- Staff and Member sessions can coexist in one browser without impersonation.
- Stable `member.id` becomes the durable FK anchor for subscriptions/billing.
- A future email-change flow can proceed without identity churn.
