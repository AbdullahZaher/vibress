# Data Lifecycle, Privacy and Operational Readiness Contract (Proposed)

> **Planned security and operational controls, not legal advice, live compliance certification or deployed code.** Applicable privacy, retention and consumer rights obligations depend on geography, customer agreements, data categories and product features; obtain qualified compliance/legal review before claiming conformance.

## Ownership and data classification

Each installation defines app owners and a data controller/processor arrangement as applicable. Distinguish **application business data**, **platform account records**, **tenant-scoped files**, **auth/session/audit logs**, **analytics**, **event/outbox**, **search indexes**, **cached copies**, **backup snapshots** and **deployed code/build artifacts**. Give each classification a documented retention owner and policy, and document cross-tenant derived data flows.

Do not assume `delete tenant rows` is sufficient: the same subject or object may remain in S3, email delivery records, queue payloads, backups, search, logs and external payment providers.

## v1 minimum lifecycle flows

| Flow | Required design/verification |
| --- | --- |
| Tenant offboarding | Owner authorization and hold checks; suspend writes/jobs, revoke sessions/keys/tokens, export needed data, delete scoped live rows and dependent storage, purge/mark search/cache/queue artifacts. |
| Subject access/export | Verify requester's authority and tenant scope; produce bounded portable machine-readable export with expiry, audit and no cross-tenant content. |
| Erasure/retention | Account for financial/statutory holds and legitimate audit retention; redact or delete reachable copies with time-bounded completion plan. |
| Backups | Document encrypted snapshot retention, key management, immutable restore evidence and **deferred removal in expired backups** when immediate record-level deletion is not feasible; do not promise instant backup erasure. |
| Audit trails | Restrict append/write and reader roles, redact secrets/PII, define retention and export rights; log sensitive platform operator access. |
| External providers | Inventory data transfer, webhook/email/payment recipients, deletion or de-identification responsibilities, region and contractual approval. |
| Disaster recovery | Restore a representative installation, confirm tenant boundaries/data integrity and measure **observed** RPO/RTO including storage/queue side effects. |

## Operational SLO/SLI design and support tiers

Define SLOs using **measured baselines** rather than invented values. At M00 choose for the claimed v1 product: availability at an API edge, p95 request latency for fixed benchmark queries, queued job delay, migration success rate, successful restores and incident detection/response. Assign an owner and decision rule for error budgets. Staging and self-hosted environments may have different guarantees; state those boundaries in release docs.

Before a GA promise, test load with two tenant scopes and representative relational joins, uploads, webhook jobs and session invalidation. For failure testing include partial network failure, stale authorization, queue replay, expired credentials, object-storage outage, database connection exhaustion and restore from compromised/stale backup.

## Governance gates and evidence

- **M00:** nominate app/data ownership and required legal/contractual review; define data classes, operational SLI and measurable budgets.
- **M02:** tenant export/deletion authorization, safe revocation, least-privileged service actor and side-channel verification.
- **M06:** event/queue retention, versioning, deduplication, dead letters/replay and PII minimization.
- **M08:** publish versioned retention/incident/support/backup policies and test results for mandatory CMS+CRM cases. Missing legal sign-off must be identified explicitly.
- **M11:** managed Cloud must separate control-plane access from runtime personal data; operator impersonation/break-glass and data-location choices require explicit audit.

**No universal compliance claim:** A completed roadmap and self-hostable deployment do not prove any specific jurisdiction's legal compliance. Product owners must establish compliance requirements per use case and deployment.
