# Vibress — Member Retention Policy Reconciliation

## Executive Summary

This document provides an entity-by-entity technical reconciliation between the
documented retention policy, the PostgreSQL schema constraints, application
service behavior, and post-deletion database state.

Authoritative Reference: `VIBRESS_MEMBER_DATA_RETENTION_MATRIX.md`\
Audit Date: September 20, 2026\
Auditor: Principal Security Architect & Production Auditor

---

## Technical Reconciliation Matrix

| Entity / Table               | Documented Policy     | Actual Schema / Service Behavior                                                          | Post-Deletion PII                                                                    | Audit Status |
| :--------------------------- | :-------------------- | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- | :----------- |
| **`members`**                | HARD-DELETE           | Explicit hard-delete via `MembersService.deleteMember()` in DB transaction                | Zero (`email`, `name`, `note`, `stripe_customer_id` removed)                         | **PASS**     |
| **`member_sessions`**        | HARD-DELETE / REVOKE  | PostgreSQL FK `ON DELETE CASCADE` + explicit session revocation in Redis                  | Zero (Session tokens and metadata purged)                                            | **PASS**     |
| **`member_auth_tokens`**     | HARD-DELETE / EXPIRE  | PostgreSQL FK `ON DELETE CASCADE` + Redis token cleanup                                   | Zero (Magic links and OTP tokens purged)                                             | **PASS**     |
| **`newsletter_preferences`** | HARD-DELETE           | PostgreSQL FK `ON DELETE CASCADE` (removes all subscriptions to newsletter IDs)           | Zero                                                                                 | **PASS**     |
| **`notifications`**          | HARD-DELETE           | PostgreSQL FK `ON DELETE CASCADE` (`notifications.member_id`)                             | Zero                                                                                 | **PASS**     |
| **`billing_customers`**      | HARD-DELETE / CANCEL  | Explicit transactional purge in `MembersService.deleteMember()` + Stripe cancellation     | Zero                                                                                 | **PASS**     |
| **`subscriptions`**          | HARD-DELETE / CANCEL  | Explicit transactional purge in `MembersService.deleteMember()` + Stripe cancellation     | Zero                                                                                 | **PASS**     |
| **`email_recipients`**       | ANONYMIZE / DETACH    | PostgreSQL FK `ON DELETE SET NULL` on `member_id`. Historical send log retained           | Zero direct member link (`member_id` set to `NULL`)                                  | **PASS**     |
| **`email_events`**           | DETACH / RETAIN       | Aggregated telemetry linked to `recipient_id`. Does not store foreign key to `members`    | Zero direct member link                                                              | **PASS**     |
| **`email_suppressions`**     | RETAIN (Compliance)   | Retains raw email string to protect future deliverability; `member_id` cascaded to `NULL` | Raw email string retained explicitly for bounce/complaint suppression list integrity | **PASS**     |
| **`comments`**               | HARD-DELETE / CASCADE | PostgreSQL FK `ON DELETE CASCADE` (`comments.member_id NOT NULL`)                         | Zero (Comment bodies and author references removed upon member deletion)             | **PASS**     |
| **`comment_likes`**          | HARD-DELETE           | PostgreSQL FK `ON DELETE CASCADE` (`comment_likes.member_id`)                             | Zero                                                                                 | **PASS**     |
| **`domain_events`**          | RETAIN (No PII)       | `member.deleted` event contains `{ memberId, publicationId, actorId }` only               | Zero PII                                                                             | **PASS**     |
| **`audit_logs`**             | RETAIN (Non-PII)      | Retains actor action metadata `{ action: "member.deleted", entityId: memberId }`          | Zero PII                                                                             | **PASS**     |
| **`outbox_events`**          | TRANSACTIONAL OUTBOX  | Persisted within DB transaction with payload `{ memberId, publicationId, actorId }`       | Zero PII                                                                             | **PASS**     |

---

## Detailed Policy Semantics

### 1. Email Suppressions Policy

- **Raw Email**: **RETAINED** (Necessary to prevent re-sending to hard bounces,
  spam complaints, and global unsubscribes across newsletter campaigns).
- **Normalized Email**: Derived on query/indexing.
- **Member ID**: **SET NULL / CASCADED** (Disassociates suppression record from
  deleted member entity).
- **Reason**: **RETAINED** (`bounce`, `complaint`, `manual`).
- **Created At**: **RETAINED** (Timestamp audit trail for ISP deliverability
  defense).

### 2. Comments & Community Content Policy

- `comments.member_id` is defined as
  `NOT NULL REFERENCES members(id) ON DELETE CASCADE`.
- Deleting a member immediately erases all associated comments and comment
  likes, completely purging author PII and comment content from the database.

### 3. Re-Registration Guarantee

- Deletion removes the unique index lock on `(publication_id, email)` in
  `members`.
- The deleted email address can immediately re-register as a brand new member
  with clean authentication state and empty preferences.
