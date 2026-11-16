# W1-T06 — Worker, Recovery and Observability Evidence

**Owner:** Agent 04 (AI-assisted specialist engineering; independent Agent 06 review required).  
**Review date:** 2026-11-16. **Integration PR:** #176. **Specialist PR:** #174.  
**Current certification:** BLOCKED for production; scope-limited disposable tests require final CI evidence on exact checked-out merge SHA.

## 1. Actual runtime path now under test

The initial 38 operations in disposable Redis and S3 proved resource permissions, but **did not execute Vibress workers**.

Additional changes:
- `packages/queue/src/index.ts` exports `getQueueIsolationOptions()`; when `VIBRESS_REQUIRE_INSTALLATION_ISOLATION=1`, it requires a syntactically valid `VIBRESS_INSTALLATION_ID` and a namespace ending in `:<installationId>:bull`. Missing/mismatched values cause an exception before enqueuing or starting a worker. No implicit `bull` fallback under isolation mode.
- Existing direct API/Worker BullMQ Queue and Worker constructors now pass `...getQueueIsolationOptions()`. The default mode remains backward-compatible with the existing single-installation topology.
- `scripts/platform/resource-isolation/worker-boundary.ts` starts **real Node 24 processes**, uses `@vibress/queue` `createQueue` and `createWorker` against restricted Redis ACL principals, and executes `WebhookDeliveryWorker` from the actual application Worker package while replacing its external delivery side effect with a non-networked sentinel.
- Each installation's producer and Worker use separate Redis ACL accounts. The cross-installation attempts intentionally use one installation's credentials with the other installation's namespace; these must fail on Redis rather than merely on a prefix-string assertion.
- Tests cover own enqueue/consumption, cross enqueue/read/consumption denial, retry, replay deduplication by job ID, poison job failed state, and failed-list cross-installation denial.

**Not yet covered:** complete live `apps/worker/src/main.ts` bootstrap, real DB-backed webhook delivery, plugin event receipt/authorization across two installations, actual installation binding for every producer/worker type, privileged jobs, production secret manager access and real upstream provider delivery. The forced namespace config is a **deployment control**, not cryptographic authorization. Redis ACL is the authority for resource keys.

## 2. Disposable resource recovery proof

The same throwaway Compose lab contains:
- pinned Redis 7.4.11 with separate A/B producer/worker identities;
- pinned MinIO-compatible S3 server with A/B/backup-only/restoration identities and per-installation buckets;
- pinned PostgreSQL 16.16 with separate non-superuser installation database owners, workers and backup reader.

S3 restoration: backup-only A reads own source object; a separate restricted recovery identity writes an isolated restore bucket; SHA-256 matches; foreign B objects are absent; cross-bucket reads and backup-to-restoration reads are denied. Duration and backup age are measured, **without treating them as an owner-approved RPO/RTO**.

PostgreSQL restoration: two test installation databases and non-superuser worker roles are provisioned. Negative `CONNECT` tests must fail across databases. Backup-only A reads own table, cannot read B or change A, dumps an own table with `pg_dump`, and an operator restores its data into a new database; row identity and B-data absence are checked. **This is a single-table SQL recovery drill only**, not a full platform migration/restore/PITR drill. Full migration journal, media manifests, encryption master key, compatibility, DNS, provider integrations, worker idempotency and staged cutover are not exercised.

The self-describing JSON report includes `recovery_metrics`, `pg_recovery_metrics` and `failure_stage`. If any step fails, the entire run remains FAIL and every unexecuted case is listed. No report contains keys, passwords, webhook payload, presigned URL, or SQL dumps.

## 3. Current status and criteria

| Gate | To claim VERIFIED | Current certification |
| --- | --- | --- |
| Redis/S3 primitive boundary | Previously executed 38/38, exact run/commit | DISPOSABLE LAB VERIFIED on CI #43870171678 (user-provided baseline; reconcile merge SHA) |
| Live Worker/Queue execution | Node process uses actual package Worker and restricted ACL, negative codes recorded, code compiled | **PENDING FINAL HEAD CI EVIDENCE** |
| Actual webhook domain Worker | `WebhookDeliveryWorker` starts with separate identities, one mocked delivery per authorized job | **PENDING FINAL HEAD CI EVIDENCE** |
| S3 recovery | Bucket restoration checksum and negative IAM verification with measured duration | **PENDING FINAL HEAD CI EVIDENCE** |
| PostgreSQL role and table restore | Actual SQL ROLE/CONNECT and dump/restore tests; both deny and success verified | **PENDING FINAL HEAD CI EVIDENCE** |
| Full production-shaped multi-service restore | Run application against two real provisioned DBs, Redis, S3 and real jobs, then failover | BLOCKED |
| Staging | Dedicated approved staging identities; no shared/production resources | NOT EXECUTED |
| Production | Operational sign-off and controlled rollout | NOT EXECUTED |

## 4. Monitoring and rollback requirements

Signal classes requiring operator-set thresholds before any release:
- Redis ACL `NOPERM` and rejected auth attempts by installation/identity (alerts must not include secrets).
- Cross-installation S3 403 events, unexpected bucket listing results, unauthorized presigned URL use, revoked credential reuse.
- BullMQ unauthorized enqueue attempts, job failures/retry storms, failed-job count, stalled/poison jobs and unexpected processing of a foreign installation's job.
- Worker database authorization failures, non-owner privilege drift, RLS bypass attempts, missing backups and failed restoration checks.
- Service readiness, 5xx, p95/p99 latency, queue lag, DB health and capacity headroom.

Operators must set SLO and alert thresholds, define routing/on-call, choose monitoring window and automatic rollback criteria **before** production. Any unexpected cross-installation permit is a release block / incident, not a tolerable error-rate regression.

Safe rollback: stop canary and pause worker producers; revert only the immutable application image to a schema-compatible digest; do not automatically down-migrate a populated schema. Restore only into a new audited target, validate integrity, and switch over with logged approval. Revoke leaked identities narrowly and expire new temporary grants after the drill.

## 5. Exact staging authorization packet — decision requested, NOT granted

**Purpose:** Reproduce W1-T06 across actual API, Worker, PG, Redis and S3 execution boundaries and prove recovery in a nonproduction staging tenancy.

**Resources (new, disposable, short-lived only):**
1. One independent staging sandbox / project, with two logically isolated installations `A` and `B`; two PostgreSQL 16 databases and their worker/runtime non-superuser roles plus a separately scoped provisioner and backup-only reader.
2. Redis 7.4.11+ test instance (or explicitly reviewed ACL partition): two producer IDs, two Worker IDs, one short-lived operator identity; ACL patterns are limited to `<test-run>:a:*` or `<test-run>:b:*`.
3. Two empty staging S3 buckets with separate A/B IAM identities; backup-read-only A and scoped restoration-writer identity for a third empty destination bucket.
4. Temporary isolated secrets for every service identity, supplied by a staging secret manager/workload identity; no production or shared root/admin keys in the application environment.
5. Read-only log/metrics access to the staging service boundary, non-sensitive job receipts, backup metadata and restore evidence.

**Operations:** create/test/revoke only these named throwaway identities/resources; API and Worker isolated deployments; negative `CONNECT`, `NOPERM`, `403` tests; enqueue/consume/retry/replay/DLQ checks; full backup + restore into a fresh sandbox; alerting and non-destructive rollback drill.

**Duration:** single scheduled maintenance drill, **maximum 4 hours after authorization**, automatically expire temporary principal grants; owner/operator to set exact date and credential TTL. The 4-hour maximum is a request, not an approved window.

**Safety:** no production data, no shared-service policy edits, no customer messages, no secrets in logs/artifacts, no IAM privilege expansion of pre-existing accounts, no production key rotation. A disposable stack can be destroyed only after verifying it belongs uniquely to this experiment. The shared/production estate remains read-only.

**Recovery:** record source/target digests, backup hashes, service and migration SHAs, observed RTO/RPO and owner-approved targets, the tested rollback path and cleanup proof. If a denial unexpectedly allows access, immediately stop, isolate only disposable test identities and mark NO-GO.

**Approvals:** Agent 02 (DB), Agent 03 (AppSec), Agent 05 (IAM), Agent 06 (independent), infrastructure operator and Owner's sensitive-change decision, if any. A request or an AI-generated report does **not** constitute authorization.

## 6. Evidence required to close Issue #175

Final SHA, CI `github.sha` checkout/merge SHA, PR head SHA, scripts and container image digests, sanitized denial outputs, actual Worker and PG tests, S3 restore checksum, cleanup verification, approved RPO/RTO, staging environment identifier, application smoke tests, alerts, rollback, reviewer sign-offs.

## External sources (consulted 2026-11-16)

- Redis 7.4.11 ACL security fixes: https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisce-7.4-release-notes/
- Redis ACL key access rules: https://redis.io/docs/latest/manual/security/acl/
- BullMQ Redis connections / worker retries: https://docs.bullmq.io/guide/connections
- BullMQ retry behavior: https://docs.bullmq.io/guide/retrying-failing-jobs
- PostgreSQL 16 pg_dump and limitations: https://www.postgresql.org/docs/16/app-pgdump.html
- NIST SP 800-34 Rev 1 contingency planning: https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
