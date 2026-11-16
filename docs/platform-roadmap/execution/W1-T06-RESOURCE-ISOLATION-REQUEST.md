# W1-T06 — Redis / S3 / queue isolation harness — authorization request

> **Status: BLOCKED — awaiting infrastructure and security authorization.**
> No ACL, bucket policy, credential or shared-service change has been made.
> This document specifies the exact evidence that will be produced once the
> access below is granted. It is not an isolation claim.

## Why this is blocked

The current cache and object-storage paths are **naming-isolated, not
identity-isolated**:

- `packages/cache/src/index.ts` exposes `buildPublicationCacheKey`
  (`pub:<publicationId>:<domain>:<key>`) and a single `getRedisClient()` that
  uses one Redis URL. Prefix construction is a code convention; Redis does not
  enforce it. The same connection is used for BullMQ queue keys.
- `packages/storage-s3/src` resolves an S3 endpoint, bucket and access key from
  configuration; the dev compose file uses the MinIO root credentials
  (`minioadmin`). There is no per-application/tenant S3 identity.
- No test has connected as a *restricted* Redis or S3 identity and been denied a
  foreign namespace. A key/prefix test alone does not prove isolation.

The directive (section 6) explicitly forbids claiming isolation from naming or
prefixes, so this item stays open until the deny matrices below are measured.

## Requested authorization

| Item | Request |
| --- | --- |
| Environment | The isolated dev services already running on this host (`vibress-redis-1`, `vibress-minio-1`), or a dedicated disposable stack with the same versions |
| Redis | Permission to `ACL SETUSER`/`ACL DELUSER` throwaway users on the dev Redis for the duration of one run (default user and existing users untouched) |
| MinIO/S3 | Permission to create/delete one throwaway bucket, one throwaway user and one inline policy via `mc admin` for the duration of one run (root credentials are already present in the compose environment) |
| Queue | No separate broker exists; queue keys live in the same Redis, so the Redis ACL proof covers the queue namespace |
| Secrets | Permission to read only the dev MinIO root and Redis admin credentials already used by the local stack; no production secret is requested |
| Owner | Infrastructure owner + security review owner must approve before execution |

## Exact harness (to be committed as an executable script)

`scripts/platform/verify-resource-isolation.mjs` will:

1. **Redis**
   - create `r6_a_<suffix>` and `r6_b_<suffix>` ACL users with passwords,
     `on`, `~pub:tenant-a:*`, `~pub:tenant-b:*` respectively, `+@read +@write
     -@dangerous`, no key access outside their pattern;
   - as A: `SET pub:tenant-a:x 1` succeeds; `GET pub:tenant-b:x` must fail
     with `NOPERM`; `SCAN`/`KEYS *` must not reveal B's key;
   - as B: symmetric proof;
   - as the queue client: `LPUSH bull:r6-b:wait 1` succeeds for its own
     namespace and is denied for the other;
   - drop both users and all test keys.
2. **S3/MinIO**
   - create bucket `r6-isolation-<suffix>`;
   - create policy `r6-a-<suffix>` allowing `s3:GetObject`/`PutObject` only on
     `arn:aws:s3:::r6-isolation-<suffix>/tenant-a/*`, and user
     `r6-a-<suffix>` bound to it;
   - with the AWS SDK as that user: `PutObject tenant-a/ok.txt` succeeds;
     `GetObject tenant-b/secret.txt` and `PutObject tenant-b/x.txt` must fail
     with `AccessDenied`; `ListBuckets` must not list the bucket;
   - upload the tenant-b object with the root identity first, then prove the
     restricted user still cannot read it;
   - delete user, policy, objects and bucket.
3. **Evidence** — the script exits non-zero unless every allow and every deny is
   observed, prints a machine-readable summary (operations, expected/actual,
   error codes) and refuses to run against a URL containing `prod`.

The script is **not** wired into CI: CI has no Redis/MinIO services. Its run
output is recorded in the Wave 1 report as local evidence with the exact
commands and version strings; it is not reported as CI coverage.

## Deny matrix to be proven

| Actor | `pub:tenant-a:*` | `pub:tenant-b:*` | `bull:<own>:*` | `bull:<other>:*` | bucket `tenant-a/*` | bucket `tenant-b/*` |
| --- | --- | --- | --- | --- | --- | --- |
| Redis user A | allow | **deny `NOPERM`** | n/a | n/a | n/a | n/a |
| Redis queue user | n/a | n/a | allow | **deny `NOPERM`** | n/a | n/a |
| S3 user A | n/a | n/a | n/a | n/a | allow | **deny `AccessDenied`** |
| MinIO root (control) | n/a | n/a | n/a | n/a | allow | allow |

## Risks and limits

| Risk | Mitigation |
| --- | --- |
| ACL edits on shared dev Redis could disturb other local work | Throwaway users only; `ACL DELUSER` in `finally`; default user and existing users never modified |
| MinIO root credential exposure in output | The script never prints credentials; it prints only user names, operations and error codes |
| Dev MinIO is a renamed build (`pgsty/silo`) | Version recorded; if `mc admin` policy semantics differ the harness must fail, not fall back |
| This proves infrastructure primitives, not application enforcement | The application still uses one shared identity per service; adopting per-tenant identities is a separate code change and remains open |
| Not production evidence | Production requires a disposable, production-shaped stack; the request covers the dev stack only |

## Exit criteria

The item can be marked **Done** only when:

1. the script is committed and reviewed;
2. a local run produces the full deny matrix with zero unexpected allows;
3. cleanup is verified (no leftover users, policy, bucket or keys);
4. the security review owner records that infrastructure-level proof is
   sufficient for the current single-installation posture, or specifies the
   production stack needed for the shared-hosting posture.

Until then W1-T06 remains **Pending — blocked by authorization**, and Wave 1
remains **NO-GO**.
