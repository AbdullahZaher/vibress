# Member Authentication & Security

## Passwordless Flow

```
Enter email
  → POST /api/members/v1/auth/request
  → generic response ("If this email can receive a sign-in link, we've sent one.")
  → short-lived magic link emailed
  → open link → token verified
  → member session created (HttpOnly cookie)
  → redirect /portal/account
```

## Token Security

- Tokens generated with `crypto.randomBytes(32)` (`generateOpaqueToken`).
- Database stores `SHA-256(token)` only (`hashToken`).
- 15-minute expiry (configurable within safe bounds).
- Single-use: consumed atomically (`used_at` compare-and-set); a second use fails with `AUTH_TOKEN_USED`.
- Parallel consumption race: exactly one request succeeds (DB row lock on update).
- Latest valid token wins: requesting a new link invalidates prior outstanding tokens for that member.
- Raw tokens never appear in logs, audit events, or URLs after verification (URL is cleaned client-side).

## Enumeration Resistance

- Unknown and existing emails produce byte-identical responses (same status, shape, message).
- Disabled members receive the same generic response but no usable token is issued.
- Signup-disabled mode still returns the generic response for unknown emails.

## Session Security

- Opaque random session token, stored hashed (SHA-256).
- Cookie: `vibress_member_session`, `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`.
- 30-day expiry. Logout revokes the current session. Admin disable revokes all sessions and invalidates future validation.
- Re-enable does NOT resurrect revoked sessions; the member signs in again.
- Sessions are never stored in localStorage/sessionStorage/IndexedDB.

## Staff/Member Isolation

- `requireMemberSession()` only reads the member cookie; a Staff cookie yields 401 `MEMBER_AUTH_REQUIRED` on member endpoints.
- `requireStaffSession()` only reads the staff cookie; a member cookie yields 401 on admin endpoints.
- Both cookies can coexist in the same browser independently.

## Abuse Protection

- `POST /auth/request`: rate-limited by IP (10/min, 100/min in test env).
- `POST|GET /auth/verify`: rate-limited (20/min).
- Resend cooldown enforced client-side (30s).

## CSRF

- State-changing member endpoints require a same-site `Origin`/`Referer` when cookie-authenticated (`validateMemberOrigin`).
- JSON `Content-Type` for mutations; no permissive credentialed CORS.

## Magic-Link URL

- Built from trusted `PORTAL_URL` / `SITE_URL` configuration — never from request `Host`.
- Link format: `{portalBase}/portal/auth/verify?token=...`.

## Email Delivery Failure

- Mailer failure throws `MAIL_DELIVERY_FAILED`; the client receives the same generic response.
- No authenticated session is created; the short-lived token may remain but expires quickly.
- Failure is logged without the token.

## Cookie Namespace

- Staff: `vibress_session`
- Member: `vibress_member_session`

Never shared.
