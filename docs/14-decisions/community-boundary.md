# ADR-016: Community Boundary

**Status:** Accepted
**Date:** Batch 11

## Context

Vibress needs a v1 engagement layer (comments, notifications, recommendations).
Without clear boundaries, staff/member identity would become entangled,
notifications would couple to email transport, and recommendation URL handling
could become an SSRF vector.

## Decision

1. **Comments belong to `member.id`.** Staff moderation is a separate
   capability exercised through RBAC permissions (`comments.read`,
   `comments.moderate`); no hidden coupling between Staff and Member
   identities.

2. **Plain-text comments only.** Comment bodies are sanitized to plain text
   before storage — no raw untrusted HTML ever renders. Threading is bounded
   (`MAX_COMMENT_DEPTH = 5`) with parent validation (same post, published,
   depth cap) and tombstone deletion semantics that preserve thread
   integrity.

3. **Notifications are durable and transport-independent.** The
   `NotificationSink` interface lets the Comments domain emit notification
   intents without touching email. Email delivery (Batch 10) may subscribe
   via events later; never called directly from Comments. Members are never
   notified about their own actions.

4. **Recommendations are managed records with SSRF-hardened URLs.** URLs are
   validated at create time (http/https only, no localhost/private IPs). Any
   outbound metadata fetch uses the hardened client in `@vibress/security`
   (`safeFetch`) with DNS-rebinding guards, redirect re-validation, timeouts,
   and size limits. Attribution is lightweight event counting only.

5. **Likes/reports are database-uniqueness-protected.** One like per member
   per comment and one report per member per comment are enforced by unique
   constraints, making toggles and report spam safe under concurrency.

## Consequences

- Community features remain bounded (no DMs, chat, feeds, or forum engine).
- Moderation actions are auditable and reversible (hide/restore, report
  resolution).
- Member notification isolation is structural (recipient scoping server-side),
  not UI-dependent.
