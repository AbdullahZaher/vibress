# W1-T06 — Resource Isolation Verification (Agent 04)

**Assessment:** BLOCKED / NOT CERTIFIED. **Wave 1 recommendation:** NO-GO until reviewed live results exist.  
**Review date:** 2026-11-16 UTC. **Baseline:** PR #166 HEAD `a96ea073767e303b02121d87558adbd12ce111f3`.  
**Implementation:** branch `feat/w1-t06-resource-isolation-harness-20261116` (a separate, unmerged change).  
**Review nature:** AI-assisted infrastructure design and testing work, **not** independent Agent 06 concurrence or human sign-off.

## 1. Scope and inventory (observed in GitHub source)

| Asset | Observed implementation | Isolation gap |
| --- | --- | --- |
| Production Compose | `compose.prod.yml`: PostgreSQL 16, Redis 7, API, worker, migrate, frontend; backend internal network; API/worker use the same `&app-environment` | Redis connection `redis://redis:6379` has no installation-specific ACL principal; `api` and `worker` inherit the same DB URL and broad secret set |
| Development Compose | `compose.dev.yml`: Redis 7 and `pgsty/silo` MinIO-compatible server; MinIO root account is documented as a developer default | Dev root account cannot constitute an S3 least-privilege proof |
| Cache | `packages/cache/src/index.ts`: singleton `getRedisClient` and `getBullMqRedisConnection` consume the same configured `redis.url` | `pub:<publicationId>:...` and `sys:...` prefixes are conventions, not service permissions |
| Queue | `packages/queue/src/index.ts`: BullMQ queues use constant names; `createQueue`/`createWorker` share Redis URL | No install-scoped BullMQ `prefix`/restricted worker credential at this version; `assertJobScope` alone is payload validation |
| Storage | `packages/storage-s3/src/s3-storage-provider.ts`: configurable bucket and static S3 key pair | No verified per-installation IAM identity in the production deployment |
| Recovery | `scripts/backup.sh`, `scripts/s3-backup.mjs`, `docs/12-infrastructure/backup-restore.md` | Backup/restore paths exist, but cross-installation backup credentials, offsite restore drill, and measured RPO/RTO are unverified |
| Observability | `apps/worker/src/main.ts`, `docs/12-infrastructure/observability.md` | Health endpoints, logs and metrics documented; no measured resource-isolation alert SLO |
| CI | `.github/workflows/ci.yml` | Main CI checks do not establish independent Redis ACL + S3 IAM denial results |

These are source observations, **not** proof of current production configuration. Nonproduction and production credentials, ACLs, IAM policies, network rules, alert targets and backup inventory were not accessible for inspection.

## 2. Implemented disposable laboratory

Files:
- `scripts/platform/resource-isolation/compose.yml` — two logical installations over a **new** Redis and S3 server, loopback-only dynamic host bindings, random Compose project, throwaway state; **never** attaches to a shared service.
- `scripts/platform/resource-isolation/verify.py` — provisions separate Redis principals `a`, `b`, `worker-a`, `worker-b`, operator; separate S3 `a`, `b`, `backup-a` identities and two dedicated buckets. Credentials are generated per run and never reported.
- `.github/workflows/w1t06-resource-isolation.yml` — no production secrets, read-only GitHub token permissions, Python dependency pinning, reproducible run and short-lived sanitized evidence artifact.

Redis operator provisions `~t06:<run>:a:*` and `~t06:<run>:b:*` access patterns (cache, queue wait/retry/failed) and disables anonymous `default`. Explicitly denied enumeration, host-wide and ACL/configuration commands. Worker identities are distinct from request/producer identities.

S3 policies allow bucket list + object actions only on their **own** bucket; backup A is read-only on bucket A. Other buckets, global bucket listing and writes from backup identity are outside their grants. Test actor credentials do not possess root credentials.

**Important limitations:** this laboratory proves infrastructure primitives, **not** that the current Vibress API and BullMQ Worker use them. Queue tests execute Redis commands against queue-shaped keys, not the real BullMQ Worker lifecycle. Production-style restore, S3 IAM external provider and large-scale performance were not tested.

## 3. Required negative matrix and evidence status

`verify.py` specifies **38** unique required outcomes. Representative evidence expectations:

| Test group | Required observed result | Current result |
| --- | --- | --- |
| Redis cache A/B own access | SET succeeds for own principal | **NOT EXECUTED** locally |
| Redis cross-read/write/delete | Redis `NOPERM` for foreign principal | **NOT EXECUTED** locally |
| Redis global SCAN | Redis `NOPERM` (prevents foreign key enumeration) | **NOT EXECUTED** locally |
| Redis queue enqueue, consume, retry, failed keys | Own succeeds, foreign `NOPERM`; separate worker principals | **NOT EXECUTED** locally |
| Redis credential rotation/revocation | Old password rejected, replacement works, disabled account rejected | **NOT EXECUTED** locally |
| S3 A/B upload/download/list | Own allowed, foreign `AccessDenied`/HTTP 403 | **NOT EXECUTED** locally |
| Backup A | Own read allowed, foreign read and own write/delete denied | **NOT EXECUTED** locally |
| Presigned URLs | Own valid, cross-bucket denied, expired and revoked URLs denied | **NOT EXECUTED** locally |
| Teardown | No test users, policies, objects, buckets, keys or running Compose services remain | **NOT EXECUTED** locally |

The harness fails closed: a missing case, unexpected allow, wrong denial error, provisioning error, missing teardown verification or runtime exception => exit nonzero. It generates `artifacts/w1t06-resource-isolation.json`, with no credentials, object contents or signed URLs.

**Execution prerequisite:** Docker Compose v2, Python 3.12+ plus `redis==6.4.0` and `boto3==1.40.0`. In this agent environment Docker and access to a local Redis/MinIO daemon are unavailable. Thus this report does not claim a passing runtime result. GitHub Actions results must be linked by `run_id`, `head_sha`, time, failure logs and sanitized artifact.

## 4. Findings / remediation register

| ID | Severity (impact / exploitability) | Reproduction or evidence | Required fix / owner |
| --- | --- | --- | --- |
| T06-01 | HIGH: cross-installation cache/queue data risk / plausible after credential exposure | `compose.prod.yml` shared `REDIS_URL`; `packages/cache/src/index.ts` shared singleton | Integrate install-scoped Redis ACL credentials and prefixes in **actual** API and worker process; Agent 04 with Agent 03/05 review |
| T06-02 | HIGH: cross-installation object access risk / plausible with over-broad storage key | Dev MinIO root, storage provider accepts general key pair | Assign per-installation IAM identities/policies and separate backup principal in deployed topology; Agent 04 + Agent 05 |
| T06-03 | HIGH: job execution across installation risk / requires trusted runtime boundary failure | Fixed BullMQ queue names; current payload checks publication rather than install | Add authenticated installation binding at enqueue/worker execution and real BullMQ retry/replay/DLQ negative tests; Agent 03 + 04 |
| T06-04 | MEDIUM: recovery material unavailable or over-authorized / operational exposure | Backup scripts exist; no independently checked installation-scoped restore | Restore to disposable installation, prove non-superuser restore and backup read scope, measure RPO/RTO; Agent 04 + 02 |
| T06-05 | MEDIUM: detection / response gap | General health/metrics exist but target alert wiring not verified | Configure alerts for ACL failures, S3 403 anomalies, queue poison jobs, restore drift and error budgets; SRE |
| T06-06 | MEDIUM: supply-chain gap in this new CI | `redis:7-alpine`, `actions/checkout@v4` and `actions/upload-artifact@v4` are version tags rather than image/action digests | Pin and validate digests/SHAs against official release, re-test, and run vulnerability review; Agent 03/04 |

No finding has been risk-accepted or independently closed. Reproduction paths reflect source-visible potential, not a claim of a confirmed live exploit.

## 5. Exit conditions and sign-off

1. GitHub CI on the **final** merge candidate HEAD must run the full matrix and report 38/38 observed decisions, zero unexpected permits, **successful identity/resource cleanup**, and reproducible artifact.
2. Agent 03 and Agent 05 review producer/worker/session secret handling; Agent 02 confirms independent DB roles and backup restore; Agent 06 reproduces and concurs.
3. Actual API and BullMQ Worker execution on separate installation credentials must be exercised, not merely low-level Redis queue-shaped keys.
4. An isolated restore drill meets owner-approved RPO/RTO; monitoring and a rollback drill are evidenced.
5. Source evidence and approvals must all match final release commit, and operations remain blocked until production permissions are explicitly scoped.

**Agent 04 verdict: BLOCKED (insufficient executed infrastructure evidence).** No GO recommendation.

## 6. Primary external sources (consulted 2026-11-16 UTC)

- Redis ACL key/command isolation: https://redis.io/docs/latest/management/security/acl/
- Redis ACL command and key patterns: https://redis.io/docs/latest/manual/security/acl/
- MinIO policy management and deny semantics: https://docs.min.io/aistor/administration/iam/access/
- MinIO policy attach: https://docs.min.io/aistor/reference/cli/admin/mc-admin-policy/mc-admin-policy-attach/
- AWS presigned URL expiry / credential lifetime: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- Docker Compose deletion and volumes: https://docs.docker.com/reference/cli/docker/compose/down
- NIST SP 800-34 Rev. 1, contingency planning (published 2010, consulted 2026-11-16): https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
