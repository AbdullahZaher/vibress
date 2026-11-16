# W1-T06 — Resource Isolation Verification (Agent 04)

**Assessment:** BLOCKED / NOT CERTIFIED for production. **Wave 1 recommendation:** NO-GO until app/worker and recovery gates close; the disposable infrastructure primitive tests have passed.  
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

Redis operator provisions `~t06:<run>:a:*` and `~t06:<run>:b:*` access patterns (cache, queue wait/retry/failed) and restricts the anonymous `default` identity to the health-check PING command only (no key access). Explicitly denied enumeration, host-wide and ACL/configuration commands. Worker identities are distinct from request/producer identities.

S3 policies allow bucket list + object actions only on their **own** bucket; backup A is read-only on bucket A. Other buckets, global bucket listing and writes from backup identity are outside their grants. Test actor credentials do not possess root credentials.

**Important limitations:** this laboratory proves infrastructure primitives, **not** that the current Vibress API and BullMQ Worker use them. Queue tests execute Redis commands against queue-shaped keys, not the real BullMQ Worker lifecycle. Production-style restore, S3 IAM external provider and large-scale performance were not tested.

## 3. Required negative matrix and evidence status

`verify.py` specifies **38** unique required outcomes. Representative evidence expectations:

| Test group | Required observed result | Current result |
| --- | --- | --- |
| Redis cache A/B own access | SET succeeds for own principal | **PASS** in disposable CI #43863295874 (historical SHA) |
| Redis cross-read/write/delete | Redis `NOPERM` for foreign principal | **PASS** in disposable CI #43863295874 (historical SHA) |
| Redis global SCAN | Redis `NOPERM` (prevents foreign key enumeration) | **PASS** in disposable CI #43863295874 (historical SHA) |
| Redis queue enqueue, consume, retry, failed keys | Own succeeds, foreign `NOPERM`; separate worker principals | **PASS** in disposable CI #43863295874 (historical SHA) |
| Redis credential rotation/revocation | Old password rejected, replacement works, disabled account rejected | **PASS** in disposable CI #43863295874 (historical SHA) |
| S3 A/B upload/download/list | Own allowed, foreign `AccessDenied`/HTTP 403 | **PASS** in disposable CI #43863295874 (historical SHA) |
| Backup A | Own read allowed, foreign read and own write/delete denied | **PASS** in disposable CI #43863295874 (historical SHA) |
| Presigned URLs | Own valid, cross-bucket denied, expired and revoked URLs denied | **PASS** in disposable CI #43863295874 (historical SHA) |
| Teardown | No test users, policies, objects, buckets, keys or running Compose services remain | **PASS** in disposable CI #43863295874 (historical SHA) |

The harness fails closed: a missing case, unexpected allow, wrong denial error, provisioning error, missing teardown verification or runtime exception => exit nonzero. It generates `artifacts/w1t06-resource-isolation.json`, with no credentials, object contents or signed URLs.

## 3A. Executed evidence (NOT production certification)

- **First attempt:** [GitHub Actions #43863089624](https://github.com/AbdullahZaher/vibress/actions/runs/43863089624), head `8c533054b3a64a86163322294c2e888c2b686467`, **FAIL**. Redis/S3 negative cases recorded up to global bucket listing; MinIO returned a scoped HTTP 200 list rather than denying ListBuckets outright. All attempted disposable cleanup checks succeeded. Historical failure is intentionally retained.
- **Corrected attempt:** [GitHub Actions #43863295874](https://github.com/AbdullahZaher/vibress/actions/runs/43863295874), head `3b42f3659f10d5bbc8210b2fcc320138c015d438`, **SUCCESS**. **38/38** required operations executed with their expected outcomes, **0 unexecuted**, and all three verified cleanup markers: `redis_users_and_keys_removed`, `s3_users_policies_buckets_removed`, `compose_removed`. The S3 global bucket list was specifically observed to be **filtered to authorized bucket(s)**; A still received actual 403 responses listing B's objects.
- **Subsequent hardening:** Redis image and third-party GitHub Actions references were pinned; the harness now rejects Redis versions below **7.4.11**, which addresses published ACL bypasses involving `SORT` and `XREAD`. These changes require a new CI run at the **final branch HEAD** before certification; never reuse the earlier PASS as evidence of untested code.

These outcomes establish only test-service ACL/IAM enforcement, not production or real-app role integration. Full CI evidence URL, resulting sanitized artifact and `head_sha` must be recorded in the release decision package. No secret values, full signed URLs or object bytes were uploaded to evidence.

**Execution prerequisite:** Docker Compose v2, Python 3.12+ plus `redis==6.4.0` and `boto3==1.40.0`. In this agent environment Docker and access to a local Redis/MinIO daemon are unavailable. Thus this report does not claim a passing runtime result. GitHub Actions results must be linked by `run_id`, `head_sha`, time, failure logs and sanitized artifact.

## 4. Findings / remediation register

| ID | Severity (impact / exploitability) | Reproduction or evidence | Required fix / owner |
| --- | --- | --- | --- |
| T06-01 | HIGH: cross-installation cache/queue data risk / plausible after credential exposure | `compose.prod.yml` shared `REDIS_URL`; `packages/cache/src/index.ts` shared singleton | Integrate install-scoped Redis ACL credentials and prefixes in **actual** API and worker process; Agent 04 with Agent 03/05 review |
| T06-02 | HIGH: cross-installation object access risk / plausible with over-broad storage key | Dev MinIO root, storage provider accepts general key pair | Assign per-installation IAM identities/policies and separate backup principal in deployed topology; Agent 04 + Agent 05 |
| T06-03 | HIGH: job execution across installation risk / requires trusted runtime boundary failure | Fixed BullMQ queue names; current payload checks publication rather than install | Add authenticated installation binding at enqueue/worker execution and real BullMQ retry/replay/DLQ negative tests; Agent 03 + 04 |
| T06-04 | MEDIUM: recovery material unavailable or over-authorized / operational exposure | Backup scripts exist; no independently checked installation-scoped restore | Restore to disposable installation, prove non-superuser restore and backup read scope, measure RPO/RTO; Agent 04 + 02 |
| T06-05 | MEDIUM: detection / response gap | General health/metrics exist but target alert wiring not verified | Configure alerts for ACL failures, S3 403 anomalies, queue poison jobs, restore drift and error budgets; SRE |
| T06-06 | MEDIUM (mitigated in new branch): CI supply-chain provenance | Initially Redis/Actions used mutable version tags; digest and action commit SHAs now pinned | Re-run at final head; independently verify pinned image, transitive Python packages and SCA output; Agent 03/04 |

| T06-07 | HIGH if unpatched Redis server is deployed: published ACL key-selection bypass / requires vulnerable server + foothold | Redis 7.4.11 vendor release notes document fixes to ACL checks for `SORT`, `XREAD` and related commands | Harness now requires Redis 7.4.11+ and image digest pin; verify deployed server version/build, monitor advisories; Agent 04/06 |

No finding has been risk-accepted or independently closed. Reproduction paths reflect source-visible potential, not a claim of a confirmed live exploit.

## 5. Exit conditions and sign-off

1. GitHub CI on the **final** merge candidate HEAD must run the full matrix and report 38/38 observed decisions, zero unexpected permits, **successful identity/resource cleanup**, and reproducible artifact.
2. Agent 03 and Agent 05 review producer/worker/session secret handling; Agent 02 confirms independent DB roles and backup restore; Agent 06 reproduces and concurs.
3. Actual API and BullMQ Worker execution on separate installation credentials must be exercised, not merely low-level Redis queue-shaped keys.
4. An isolated restore drill meets owner-approved RPO/RTO; monitoring and a rollback drill are evidenced.
5. Source evidence and approvals must all match final release commit, and operations remain blocked until production permissions are explicitly scoped.

**Agent 04 verdict: BLOCKED (insufficient executed infrastructure evidence).** No GO recommendation.

## 6. Primary external sources (consulted 2026-11-16 UTC)

- Redis ACL key/command isolation: https://redis.io/docs/latest/management/security/acl/\n- Redis 7.4.11 official security release notes (August 2026): https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisce-7.4-release-notes/\n- GitHub Actions secure use / pinning: https://docs.github.com/en/actions/reference/security/secure-use
- Redis ACL command and key patterns: https://redis.io/docs/latest/manual/security/acl/
- MinIO policy management and deny semantics: https://docs.min.io/aistor/administration/iam/access/
- MinIO policy attach: https://docs.min.io/aistor/reference/cli/admin/mc-admin-policy/mc-admin-policy-attach/
- AWS presigned URL expiry / credential lifetime: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- Docker Compose deletion and volumes: https://docs.docker.com/reference/cli/docker/compose/down
- NIST SP 800-34 Rev. 1, contingency planning (published 2010, consulted 2026-11-16): https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
