# PLUG-OPS-02 — Isolated restore acceptance drill

**Status:** Procedure and strict-mode preflight regression cases implemented; **live
restore, RPO/RTO and operator sign-off have not been performed.** This is an
operator-only read-only verification plan, not an automated production restore.

Read [backup/restore fundamentals](../12-infrastructure/backup-restore.md),
[the signed release admission procedure](secure-operator-release-admission.md)
and [M0 acceptance gates](plugin-platform-m0-acceptance-matrix.md) first.

## Boundaries and required evidence

A restorable Vibress installation includes:

- A **signed, independently verified** PostgreSQL backup with every existing
  publication, plugin status/settings, plugin-owned schema/migrations,
  publication enablement, event receipts, member data and audit rows.
- A corresponding Redis/queue snapshot, including retryable/failed jobs and
  BullMQ metadata. PostgreSQL receipts are the admission authority, not Redis
  jobs. The two backups are **not automatically an atomic pair**.
- The exact immutable operator-approved plugin directory: signed lockfile,
  pinned ESM and Admin UI files, SBOM/provenance/security evidence, approved
  declarative migration plans, detached signature and trusted public key.
- A **separate** authorized recovery copy of the matching
  `VIBRESS_ENCRYPTION_KEY` and other needed service secrets. Never place raw
  keys in admission JSON, source control, diagnostics or shared backup archives.
  Keep the operator **signing private key** outside runtime images and backups.
- Independently pinned SHA-256 lockfile and SPKI DER signer fingerprints.
  Record checksums, PostgreSQL and Redis versions, image digests, backup
  timestamps, ticket/incident ID and verified storage location, but not secrets
  or event payloads.

If an artifact, matching key, backup signature, verified snapshot or required
queue state is missing, **stop**. Do not fall back to an earlier release just
because its `manifest.version` happens to match.

## Procedure in an isolated disposable recovery stack

1. Record the source instance's last **durable** event and backup completion
   timestamps. Quiesce all relevant API and Worker replicas; remove inbound
   traffic, disable plugin execution and stop queue producers/consumers. A
   `VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1` flag is a defense in depth guard,
   **not proof** all replicas have stopped. Take independently verifiable DB,
   Redis, storage and operator-artifact snapshots without changing release
   mounts while snapshots are collected.
2. Verify the existing `scripts/restore.sh` backup signature/integrity checks
   **before** any destructive restore, then restore only into a separate
   network-isolated staging environment (never an existing production database).
   Restore PostgreSQL, Redis, CMS storage, exact plugin release bytes and
   matching encryption keys. Use the already documented, explicit restore
   flags and operator confirmation. Do not silently reset migration history.
3. Apply only previously reviewed **core** migrations needed by this snapshot
   under maintenance, after checking the upgrade path for populated records.
   Independently verify all expected releases with the normal operator
   admission command on the actual mounted copy. A plugin storage migration
   requires its own approval; the following checks run **no DDL**.
4. For an opted-in strict deployment, set the following **on the isolated
   operator verification process** (with real protected paths and approved
   fingerprints, not examples):

   ```bash
   export VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1
   export VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY=strict
   export VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1
   export VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/operator-release/trusted-plugins.json
   export VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE=/operator-release/operator-public.pem
   export VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE=/operator-release/operator.sig
   export VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256='<approved-64-hex>'
   export VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256='<approved-64-hex>'
   pnpm exec tsx scripts/plugins/check-restore.ts
   pnpm exec tsx scripts/plugins/check-queue-recovery.ts
   ```

   The first check now uses **`verifyOperatorReleaseAdmission`** whenever
   `ADMISSION_POLICY=strict`, rather than accepting the weaker legacy
   artifact-only preflight. Strict mode rejects missing maintenance mode,
   unsigned releases, missing external pins, unreviewed release evidence and
   mutated artifacts. Legacy deployments retain their historical read-only
   preflight unless opted into strict policy. Both commands must exit 0.
5. Investigate every failed, missing, terminal or invalid PostgreSQL↔Redis
   queued-event correspondence. Do **not** auto-replay from Redis or invent a
   new event receipt; use existing permission-scoped and audited replay
   mechanisms after resolving the root cause. Receipts marked `pending` or
   `dispatching` require the existing bounded relay/claim recovery path,
   not unrestricted Redis enqueue. Do not acknowledge or delete a job solely
   to make the offline check green.
6. Restore service on a **single controlled replica** with the same pinned
   release/secret snapshot, verify decryption of a known non-production
   sentinel secret via the normal authorized workflow, and confirm that no
   secret appears in logs/API output. Confirm disabled publications remain
   disabled. Test a second API/Worker replica and the four-replica admission
   comparison before resuming traffic, then perform wrong-publication,
   duplicate, stale digest, retry/dead-letter and crash-injection checks.
7. Measure **actual** recovery time (failure to serving verified traffic) and
   recovery point (difference between last confirmed durable write and latest
   recovered write). Record real timestamps/observed losses, not assumed
   RTO/RPO values; decide whether these meet the operator's contractual
   objectives. Archive sanitized logs, checksums, CI commit SHA, replay
   decisions, operator identities and explicit go/no-go sign-off.

## Mandatory negative drills

| Injected condition | Required result |
| --- | --- |
| Strict policy without maintenance mode / lockfile pin / signer pin | Preflight rejects **before** DB inspection |
| Tampered lockfile, wrong signature, reviewed ESM hash, or missing review evidence | No success receipt and no plugin import |
| Missing approved release for active publication / pending event | Restore gate fails; no implicit disable or module substitution |
| Restored queued PG receipt without matching Redis job, or forged Redis tenant/event | Queue reconciliation blocks activation |
| Redis has job without PG admission | Worker never runs it; no receipt is synthesized |
| Wrong encryption key or missing CMS/DB backup component | Restore acceptance fails; credentials/payloads never logged |
| Different original/target plugin migration schemas | Operator chooses compatible forward-fix or complete tested backup restoration; no assumed automatic down migration |
| Mixed API/Worker approved digests, failed worker handoff or double execution | Stop rollout, retain durable receipt and bounded retry/dead-letter evidence |

**Acceptance limitation:** The script-level and CI tests do **not** certify a
real disaster recovery operation. The operator must run fresh and populated
upgrade fixtures, real PostgreSQL/Redis outage injection, live replicas and
restore timing measurements before accepting PLUG-OPS-02.
