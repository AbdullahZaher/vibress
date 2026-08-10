# Staff Identity, Authentication, and Authorization Foundation (Batch 1)

## Overview

Vibress Batch 1 establishes the staff identity, session-based authentication, RBAC permission model, security baseline, and initial owner bootstrap mechanism.

## Data Model

- **users**: Staff identities with normalized emails, password hashes, and statuses (`active`, `disabled`).
- **roles**: System and custom role definitions (`owner`, `administrator`, `editor`, `author`, `contributor`).
- **permissions**: System action keys (`users.read`, `roles.read`, `settings.edit`, etc.).
- **user_roles**: Many-to-many relationship linking users to assigned roles.
- **role_permissions**: Many-to-many relationship linking roles to granted permissions.
- **sessions**: Server-managed session records storing hashed tokens (`token_hash`), IP address, user agent, expiration, and revocation timestamp.
- **audit_events**: Append-only security audit log recording administrative and authentication events.

## Password Security

- **Algorithm**: Argon2id (`argon2` package).
- **Password Policy**: Minimum 12 characters, maximum 128 characters.
- **Account Enumeration Protection**: Unauthenticated login failures return generic `INVALID_CREDENTIALS` error code. Non-existent email lookups trigger `dummyVerifyPassword()` to normalize response time.

## Session Model

- **Token Generation**: 256-bit cryptographically secure opaque token (`crypto.randomBytes(32)`).
- **Token Hashing**: SHA-256 (`hashToken`). Database stores ONLY `token_hash`. Raw tokens are never stored in PostgreSQL.
- **Cookie Security**: `HttpOnly = true`, `SameSite = Lax`, `Path = /`, `Secure` in production.
- **Revocation**: Logout immediately revokes the session in the database (`revoked_at`). Disabling a user invalidates all active sessions for that user upon resolution.

## Authorization & Owner Semantics

- **RBAC Engine**: Permissions resolved via `user → user_roles → roles → role_permissions → permissions`.
- **Owner Role**: The `owner` role key bypasses permission lookup and grants full administrative access.
- **Last-Owner Invariant**: The system prevents disabling or removing the `owner` role from the last active owner (`countActiveOwners() <= 1`).

## Bootstrap Process

- **Command**: `pnpm bootstrap:owner` or `pnpm owner:create`.
- **Precondition**: Operates ONLY when `countActiveOwners() === 0`.
