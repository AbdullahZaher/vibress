# Infrastructure Deployment and Recovery Runbook — Vibress Universal Platform

**Status:** DRAFT / NONPRODUCTION ONLY. **Agent 04:** 2026-11-16. **Release gate:** NO-GO unless the final build and all required reviewers are approved.

## Scope / authority boundaries

Use this runbook for disposable rehearsals or as a proposed operator procedure. Do not execute against production or shared cloud resources without a recorded risk assessment, least-privilege operation scope, independent specialist + Agent 06 concurrence, verified backup, rehearsed rollback and owner authorization. Database migration, IAM privilege changes, shared secret rotation and deletes are **sensitive**.

Do not paste credentials, signed URLs or complete connection strings in terminals, tickets, PR comments or reports. Use an approved secret store and mask telemetry.

## A. Reproduce W1-T06 denial tests (safe local CI sandbox)

Prerequisites: Docker Compose v2; Python 3.12+; `redis==6.4.0` and `boto3==1.40.0`; 2 GB free memory; a fresh ephemeral machine, not a shared development Redis or S3 server.

```bash
python3 -m venv /tmp/w1t06-venv
/tmp/w1t06-venv/bin/pip install redis==6.4.0 boto3==1.40.0
/tmp/w1t06-venv/bin/python -m py_compile scripts/platform/resource-isolation/verify.py
/tmp/w1t06-venv/bin/python scripts/platform/resource-isolation/verify.py --self-test

W1T06_DISPOSABLE=I_ACKNOWLEDGE_DISPOSABLE_ONLY \
W1T06_REPORT=artifacts/w1t06-resource-isolation.json \
/tmp/w1t06-venv/bin/python scripts/platform/resource-isolation/verify.py
```

The Python harness creates a fresh random Compose project, binds Redis and S3 exclusively to random **127.0.0.1** ports, generates runtime credentials, provisions four separate Redis client users plus operator, three S3 identities (A/B/backup A), two buckets and independent IAM policies. The sandbox is destroyed by `docker compose down --volumes --remove-orphans` in `finally`. It attempts identity and policy teardown first and verifies both the removal and absence of running containers.

**Do not set the safety acknowledgement for any arbitrary endpoint:** this program cannot accept a Redis URL or S3 endpoint argument; it only launches its own Compose specification. It fails if published ports are not loopback. Root S3 credentials are randomly generated per invocation and exist only inside the disposable process/container environment. The MinIO administrative CLI necessarily receives its throwaway user password as a process argument inside the isolated container; never copy this mechanism to production. Use workload identity / secret manager APIs for production IAM provisioning.

Evidence is JSON, contains case IDs, observed allow/deny codes and cleanup status only. A real `PASS` requires every required case to appear, expected denials to be **observed** and cleanup success. No negative result is inferred from a source-only or static test.

## B. Rollout plan (requires authorizations before execution)

1. Freeze exact commit SHA, immutable build digest and dependency lockfile hash. Collect SAST/SCA/container findings. Validate no High/Critical exposure.
2. Obtain Agent 02 database verdict, Agent 03 app/worker verdict, Agent 05 IAM verdict and Agent 06 independent review, all on the exact build. Record conditions and expiry.
3. Provision **distinct** per-installation DBs and runtime/worker credentials, Redis ACL or instances, S3 IAM principals/buckets and backup principals. Verify effective grants and external access-denied results.
4. Back up database (including migration journal), object storage/media, and separately escrow encryption/signing key references. Sign manifests and measure restore checksums. Do not reuse the production environment as a test target.
5. Stage with immutable image digests; apply online expand/backfill/validate migration workflow using a short-lived provisioner role, never a serving role.
6. Deploy a canary, run authorized authenticated smoke tests, validate no unauthorized cross-installation access, worker queue processing, readiness and metrics.
7. Complete the predeclared monitoring window. The on-call incident commander alone may invoke rollback using the written change record. Owner retains GO/NO-GO authority.

## C. Backup & restore rehearsal (not yet evidenced)

Restorable set per installation:
- Consistent PostgreSQL full backup + WAL/PITR range if configured + migration history.
- Media in all local and S3-backed storage providers, versioning state and IAM ownership.
- Separate key material references to unlock encrypted data, without storing raw keys in backup artifacts.
- Immutable manifest with timestamp, build/migration SHA, content hashes, retention, RPO/RTO target and access policy.

Restore drill:
1. Provision an **empty** isolated installation with distinct identities.
2. Retrieve a representative backup with **backup-only** grants; verify checksum, signature and encryption.
3. Restore DB and object storage with a recovery principal limited to this isolated target.
4. Verify migrations, integrity/FKs, RLS/tenant negative tests, objects and signed media access, outbox/job idempotency, and no B data visible to A.
5. Record measured snapshot age (achieved RPO) and end-to-end recovery duration (achieved RTO); compare to **owner-defined** targets (currently **NOT DEFINED**).
6. Destroy disposable drill target after audit evidence is committed and approved; never remove production backups as part of testing.

A successful `pg_dump` or a backup file alone is **not** sufficient evidence of a tested restore.

## D. Operational monitoring, rollback triggers and alerting

Prior to production rollout, assign concrete SLO numbers, an on-call owner, an agreed observation window and automatic rollback thresholds. Until then every numerical threshold below is **UNSET**, not an approved target.

| Signal | Detection | Response / rollback candidate |
| --- | --- | --- |
| Any cross-installation access unexpectedly allowed | Redis ACL/S3 IAM negative canary, app worker boundary tests | Immediate halt, isolate compromised identity, investigate; release gate NO-GO |
| Cross-installation job processed | Installation-signed queue envelope and worker audit | Disable affected worker, quarantine queue, prevent replay, incident escalation |
| Rate of Redis `NOPERM` / S3 `AccessDenied` anomalies | Provider audit logs tagged with installation/workload | Investigate privilege drift or attack; do **not** loosen ACL automatically |
| API or worker readiness fails | `/health/ready`, worker `/health/ready`, dependency probes | Stop canary; rollback image, not irreversible schema/data, when compatible |
| Queue latency, retries, dead-letter growth | BullMQ metrics, poison-job counts, retry counts | Pause producer or worker, preserve evidence, restore from accepted replay checkpoints |
| Unexplained DB errors / pool exhaustion / high 5xx | error budget, database telemetry | Halt rollout; roll back compatible code; check migration safety |
| Missing backup, checksum drift, expired key or restore failure | backup manifest validation, scheduled restore drill | Block release and escalate to DR owner |
| Storage abuse or key disclosure | secret manager audit, S3 access/expiry telemetry | Isolate and revoke narrowly with written sensitive-change record |

## E. Safe rollback and recovery precedence

- For app-only regressions: revert to last approved immutable digest while preserving database compatibility; immediately rerun smoke and isolation checks.
- For migration regressions: avoid destructive down migrations. Apply reviewed forward repair / restore into an isolated environment if necessary. Never run `DROP`, `TRUNCATE`, `down -v` or force ref updates against shared/production infrastructure.
- For leaked workload key: stop corresponding workload, issue new limited credential, confirm sessions are invalidated, retest denial; production key rotation requires its own written sensitive authorization and tested recovery.
- For Redis outage: bounded retries and backoff, no duplicate outbound side effects, don't silently replay untrusted cross-installation payloads.
- For S3 outage: queue or reject uploads safely, never fall back to an unrestricted root key.

## F. Release evidence record (complete prior to GO)

| Field | Required evidence | Current |
| --- | --- | --- |
| Commit and image digest | Exact immutable build, CI SHA and reviewed diff | Code baseline `a96ea073...`; new branch pending CI |
| Redis ACL | 4 identities; own allowed, cross `NOPERM`, rotation and cleanup | BLOCKED: no executed lab run |
| S3 IAM | 2 installations, separate backup, negative 403/expiry/revocation, cleanup | BLOCKED: no executed lab run |
| Worker E2E | Real BullMQ authentication, enqueue/retry/replay/DLQ and DB least privilege | BLOCKED |
| DR | Offsite or isolated restore, measured RPO/RTO | BLOCKED |
| Rollback | Tested, non-destructive, correlated to immutable digest | BLOCKED |
| Monitoring | Alert route, watch window, predeclared rollback thresholds | BLOCKED |
| Sign-off | Agent 02–06 written verdicts, owner decision record | BLOCKED |

**No production deployment, key rotation or risk acceptance authorized by this runbook.**

## G. Source references (checked 2026-11-16 UTC)

- Docker Compose down semantics: https://docs.docker.com/reference/cli/docker/compose/down
- Redis ACLs: https://redis.io/docs/latest/management/security/acl/
- MinIO user and policy management: https://docs.min.io/aistor/reference/cli/admin/mc-admin-user/
- AWS presigned URL security: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- NIST SP 800-34 Rev.1 (2010 / updated 2010): https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
