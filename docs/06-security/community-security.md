# Community Security

## Member IDOR

- Comments: every edit/delete validates `comment.memberId === session.member.id`
  server-side; cross-member access returns 403 (`FORBIDDEN`).
- Notifications: all list/read operations are scoped to the session member's
  `recipientId`.
- Verified by integration and E2E tests (Member B cannot edit/delete Member A
  comments; Member B cannot see Member A notifications).

## Staff RBAC

- `comments.read` — list comments/reports.
- `comments.moderate` — hide/restore/delete comments, resolve reports.
- `recommendations.read` / `recommendations.manage` — recommendation management.
- Unauthenticated → 401; authenticated without permission → 403. Verified.

## CSRF

All member cookie-authenticated state-changing endpoints (comment create/edit/
delete, like, report, notification read) use the member origin validation
middleware. Requests without a valid Origin are rejected with 403. Verified.

## Stored XSS

Comment bodies are sanitized to plain text (HTML tags and control characters
stripped) before storage and rendered as text. Verified by integration tests
(`<script>` payloads are stripped).

## Rate Limits

- Comment creation: 20/min (100/min in test).
- Likes: 50/min (200/min in test).
- Reports: 10/min (50/min in test) — plus one-report-per-comment-per-member
  database uniqueness as report-spam protection.

## SSRF

Recommendation URLs are validated at create time (http/https only, no
localhost/private IPs). Any metadata fetch uses the hardened client with DNS
rebinding protection, redirect validation, timeouts, and size limits.

## Hidden-Data Leakage

Public comment API returns only `published` comments; hidden/deleted comments
and moderation metadata are never exposed. Verified by integration tests.

## Unsafe Redirects

No user-controlled redirect endpoints exist in the community surface.
Recommendation links point to validated external URLs (never internal).
