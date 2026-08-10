# Member API

Namespace: `/api/members/v1` (separate from `/api/admin/v1` and `/api/content/v1`).

All member endpoints are unauthenticated where noted, or require the `vibress_member_session` cookie.

## Auth

### `POST /auth/request`

Unified signup/login. Body: `{ "email": string }`.

Response (always, enumeration-safe):
```json
{ "message": "If this email can receive a sign-in link, we have sent one." }
```

Rate-limited by IP. Never reveals whether the email exists.

### `POST /auth/verify`

Body: `{ "token": string }`. Verifies the magic link, creates a member session, sets the `vibress_member_session` cookie.

Response 200:
```json
{
  "member": { "id": "...", "email": "...", "name": null, "emailVerified": true, "createdAt": "..." }
}
```

Errors:
- 400 `AUTH_TOKEN_INVALID` — invalid/unknown token
- 400 `AUTH_TOKEN_EXPIRED` — token past expiry
- 400 `AUTH_TOKEN_USED` — token already consumed
- 401 `MEMBER_DISABLED` — account disabled

### `GET /auth/verify?token=...`

Browser-navigation convenience; same semantics as POST. Sets the cookie and returns the member.

### `POST /auth/logout`

Revokes the current member session and clears the cookie. Idempotent. Returns `{ "success": true }`.

## Member

### `GET /me`

Requires member session. Returns `MemberSelfDTO`:
```json
{ "member": { "id": "...", "email": "...", "name": null, "emailVerified": true, "createdAt": "..." } }
```

401 `MEMBER_AUTH_REQUIRED` when unauthenticated (including with only a Staff cookie).

### `PATCH /me`

Requires member session. Body: `{ "name": string|null }` (max 200 chars, control chars rejected).

Returns updated `MemberSelfDTO`.

## Error Semantics

All errors: `{ "errors": [{ "code", "message", "requestId" }] }`.

Stable codes: `MEMBER_AUTH_REQUIRED`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_USED`, `MEMBER_DISABLED`, `VALIDATION_ERROR`.
