# Production Infrastructure Topology — Vibress Universal Platform (W1-T06)

**Status:** DESIGN ONLY; not deployed, signed off or production-authorized.  
**Agent 04 review:** 2026-11-16. Source reference: PR #166, `a96ea073767e303b02121d87558adbd12ce111f3`.

## 1. Separate installation trust boundaries

```text
                      External TLS ingress / WAF / rate limits
                                         |
                   +---------------------+--------------------+
                   |                                          |
             Installation A                               Installation B
      +---------------------------+             +---------------------------+
      | API A identity; Worker A  |             | API B identity; Worker B  |
      | per-process secrets       |             | per-process secrets       |
      | dedicated ingress policy  |             | dedicated ingress policy  |
      +------------+--------------+             +-------------+-------------+
                   |                                          |
       +-----------+-----------+                  +-----------+-----------+
       | Postgres DB A         |                  | Postgres DB B         |
       | distinct non-owner    |                  | distinct non-owner    |
       | runtime and operator  |                  | runtime and operator  |
       +-----------------------+                  +-----------------------+
                   |                                          |
       +-----------+-----------+                  +-----------+-----------+
       | Redis ACL A namespace |                  | Redis ACL B namespace |
       | separate producer and |                  | separate producer and |
       | worker identities     |                  | worker identities     |
       +-----------------------+                  +-----------------------+
                   |                                          |
       +-----------+-----------+                  +-----------+-----------+
       | S3 bucket A IAM role  |                  | S3 bucket B IAM role  |
       | backup read-only A    |                  | backup read-only B    |
       +-----------------------+                  +-----------------------+

          Central logs/metrics: per-installation tags + access-controlled
          alerting; no secrets, full signed URLs, or unredacted job payloads.
```

The diagram is a target architecture, not an assertion that the existing `compose.prod.yml` implements it. Separate network routing reduces attack paths but does **not** substitute for service IAM. Shared underlying Redis/S3 infrastructure is permitted only when it is demonstrably isolation-enforcing with distinct principals; otherwise use a dedicated instance per installation.

## 2. Authorization plane

| Component | Runtime principal | Permitted scope | Explicitly excluded |
| --- | --- | --- | --- |
| API A | `api-a` | Only API-facing routes, DB A runtime privileges, Redis namespace A, S3 bucket A | DB B, queue B, object B, admin credentials, backup credentials |
| Worker A | `worker-a` | Only authenticated jobs of installation A, DB A worker grants, queue A, authorized S3 objects | Installation B and IAM administration |
| API/Worker B | `api-b` / `worker-b` | Symmetric restrictions to installation B | Installation A resources |
| Provisioner | short-lived `operator-a` or `operator-b` | Migrations and identity provisioning for one installation | Persistent credential in serving process |
| Backup A | `backup-a` | Read-only DB A snapshot/export and S3 bucket A objects; encrypted backup target | B data, delete/overwrite, live application secrets |
| Recovery executor | one-time time-boxed recovery role | Restore into disposable installation after recorded approval | Automatically pointing restore at production |
| GitHub Actions | `contents: read` on disposable CI | Local ephemeral container services only | Production secrets, cloud IAM, long-lived keys |

A privilege contract must be checked against **effective** permissions at boot and via negative tests. For PostgreSQL follow `ADR-PLAT-001` and existing runtime privilege contract checks. Do not assume RLS alone protects against a superuser or owner role.

## 3. Deployment strategy and gates

1. **Build**: pinned image digests, locked app dependencies, SBOM, vulnerability scan, signed/provenance-verified build artifact. Reject unknown digest.
2. **Provision**: installation record -> isolated DB/role -> Redis ACL or instance -> S3 policy and bucket -> worker principal -> scoped secrets -> ingress and telemetry; provisioning runs outside serving applications. Generate credentials in approved vault or workload identity, never in repository.
3. **Verify**: negative cross-installation matrix on disposable infrastructure; worker runtime job ownership tests; least privilege effective-authority audit; revocation tests.
4. **Deploy**: staged immutable digest, migrations with expand/contract rollback, readiness checks, bounded rollout and gate monitoring.
5. **Operate**: monitor 5xx/4xx, worker lag/retries/DLQ, DB connections/errors, unauthorized ACL/S3 access and backup coverage. Feed alerts to the on-call owner.
6. **Recover**: restore verified full DB + media/object storage + separately guarded encryption material to an isolated target, test against owner-approved recovery objectives, verify tenant/installation isolation before cutover.

## 4. Security and reliability requirements

- Terminate public TLS at trusted ingress. Disable insecure internal hops or require service-to-service TLS/mTLS where provider topology warrants it.
- No database/Redis/S3 management plane exposed to the public internet. Deny by network and by principal. Restrict egress from workers.
- Store key material in a secret manager with workload identity and audited reads. Distinct encryption, backup signing, database and S3 keys. No secrets in Docker build layers, command-line logs, CI artifacts or PR content.
- For Redis ACL, explicitly forbid cross-installation patterns and key-enumeration operations; verify any BullMQ Lua/script commands still respect ACL, and test replay/retry/DLQ with live workers.
- Restrict S3 `ListBucket` separately from object operations. Verify anonymous, cross-user, expired-signed-URL and disabled-user denial. Revoke and retry from **new** sessions; close old Redis sessions on rotation.
- Store backups in a separate account or storage domain with immutable retention, independent backup identity and alerting on deletions. Test restore before declaring valid RPO/RTO.
- Health endpoints should cover readiness, not just liveness, and return no secrets or cross-tenant context. Define automated rollback thresholds before rollout.

## 5. Unverified decisions / authorization dependencies

| Owner / reviewers | Decision required | State |
| --- | --- | --- |
| Infrastructure owner + Agent 05 | Actual target provider, operator/workload IAM policy, credential delivery | BLOCKED |
| Agent 03 + Agent 04 | Real BullMQ prefixing, worker admission guard and commands | BLOCKED |
| Agent 02 | DB backup/restore grants and authoritative migration path | BLOCKED |
| SRE owner | RPO, RTO, SLO, monitoring interval and incident paging | BLOCKED |
| Agent 06 | Independent evidence verification and cross-domain concurrence | PENDING |
| Project Owner & Final Release Authority | Any irreversible production changes or secret rotation following risk assessment and tested rollback | NOT AUTHORIZED |

No production operation is authorized by this design document.

## 6. Source references (consulted 2026-11-16)

- Redis ACL: https://redis.io/docs/latest/management/security/acl/
- MinIO IAM: https://docs.min.io/aistor/administration/iam/access/
- AWS IAM bucket scope: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_s3_deny-except-bucket.html
- NIST SP 800-34 Rev. 1: https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
