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
5. The PostgreSQL→Redis relay distinguishes an **actual Redis publish error**
   from a **PostgreSQL acknowledgement error after Redis accepted the job**.
   In the first case the claim returns to `pending` for bounded retry; in the
   second it stays `dispatching` until the existing two-minute claim lease
   expires. Redis job IDs remain stable across retries. Confirm both crash
   boundaries with the dedicated Worker relay unit tests and PostgreSQL
   integration test, then repeat with **real Redis/PG process failures**
   before certifying the outbox. Do not infer exactly-once external plugin
   side effects from BullMQ de-duplication; plugin handlers still require
   idempotency.
6. Investigate every failed, missing, terminal or invalid PostgreSQL↔Redis
   queued-event correspondence. Do **not** auto-replay from Redis or invent a
   new event receipt; use existing permission-scoped and audited replay
   mechanisms after resolving the root cause. Receipts marked `pending` or
   `dispatching` require the existing bounded relay/claim recovery path,
   not unrestricted Redis enqueue. Do not acknowledge or delete a job solely
   to make the offline check green.
7. Before restoring plugin secret service, run the separate
   `scripts/plugins/rotate-secrets.ts` read-only check on a backed-up,
   quiesced clone with the matching original v1 key and all v2 key IDs.
   If a secret migration was approved, require a second post-migration
   dry-run with `needed: 0`. Do not remove a key until the clone and both
   API/Worker versions can still read every persisted secret.
   Restore service on a **single controlled replica** with the same pinned
   release/secret snapshot, verify decryption of a known non-production
   sentinel secret via the normal authorized workflow, and confirm that no
   secret appears in logs/API output. Confirm disabled publications remain
   disabled. Test a second API/Worker replica and the four-replica admission
   comparison before resuming traffic, then perform wrong-publication,
   duplicate, stale digest, retry/dead-letter and crash-injection checks.
8. Measure **actual** recovery time (failure to serving verified traffic) and
   recovery point (difference between last confirmed durable write and latest
   recovered write). Record real timestamps/observed losses, not assumed
   RTO/RPO values; decide whether these meet the operator's contractual
   objectives. Archive sanitized logs, checksums, CI commit SHA, replay
   decisions, operator identities and explicit go/no-go sign-off.

## Coordinated read-only recovery acceptance gate

For a **verified, isolated, restored and quiesced staging clone only**, the
additional `scripts/plugins/run-m1a-recovery-acceptance.sh` runs existing
preflight commands in a strict fixed order with no SQL writes, release
activation, queue repair or secret re-encryption. This guards against
accidentally omitting one of the individually documented checks.

The operator must **independently** prove the restored PostgreSQL, Redis,
signed operator artifacts and encryption keys all belong to the same approved
snapshot. Gather four independent signed release receipts from **two API
replicas and two Worker replicas**, using the independently pinned signer
and lockfile. A receipt JSON file is not proof of the source replica by itself.
File paths must be absolute and remain on protected operator storage.

In a protected shell (no values logged to shell history), set the strict-mode
release pins and real protected keyring as already documented above, and:

```bash
export VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1
export VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE=1
export VIBRESS_PLUGIN_DRILL_ISOLATED_CLONE_ACK=1
export VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY=strict
export VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1
# Release paths, two trusted SHA-256 pins, legacy VIBRESS_ENCRYPTION_KEY,
# VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID and VIBRESS_PLUGIN_SECRET_KEYS_JSON
# must be supplied privately and identically to the isolated fleet.
bash scripts/plugins/run-m1a-recovery-acceptance.sh \
  api:api-a=/protected/api-a.json api:api-b=/protected/api-b.json \
  worker:worker-a=/protected/worker-a.json worker:worker-b=/protected/worker-b.json
```

The script executes, in order, `check-restore.ts`,
`check-queue-recovery.ts`, `rotate-secrets.ts` **without `--apply`**,
`check-replica-receipts.ts`, and `check-receipt-health.ts`. Every check
must exit zero; missing strict pins, encryption keyring, maintenance flags,
evidence arguments or any failed check stops the sequence. There is no
skip/force mode. Zero exit only means the **read-only checks** passed;
actual service recovery, multi-replica process identity, completed RPO/RTO,
signer revocation propagation, live fault injection, monitoring deployment
and operator sign-off are **not** automatically verified.

The opt-in acknowledgment variable is a guard **not proof of isolation**;
do not point this command at production. Its CI unit tests use a mock
`pnpm` executable and never connect to actual PostgreSQL/Redis. For
real acceptance, also run the individual negative drills below, record
observed API×2/Worker×2 behavior and retained event receipts, measure
actual recovery time and recovered writes, and secure the operator-signed
go/no-go report outside the source tree.

## CI disposable four-process fault and PostgreSQL restore drill

**Evidence:** [GitHub Actions run #40219707208](https://github.com/AbdullahZaher/vibress/actions/runs/40219707208) succeeded
on exact SHA `79ec639bbb804e3649486458129c24b1eec925c8`.
The separate
[Plugins M1A isolated replica fault drill workflow](../../.github/workflows/plugin-m1a-isolated-drill.yml)
runs from this execution branch (or explicit operator-triggered workflow
dispatch) on a **fresh GitHub-hosted Ubuntu runner**. It is not enabled
automatically in operator installations and does not share production volumes.

`scripts/plugins/drill-isolated-replica-faults.sh` requires three
independent CI-only guard inputs: `GITHUB_ACTIONS=true`, `CI=true`,
and `VIBRESS_M1A_DISPOSABLE_DRILL=1`, plus a numeric GitHub Actions run
ID. It then creates a uniquely namespaced disposable Docker Compose project
for PostgreSQL and Redis (from `compose.dev.yml`), applies existing core
migrations/seeds, and launches **two real API processes** on different
ports and **two real Worker processes** on different health ports. No
release mount, operator signer, production keyring or external provider is
injected. Temporary data, logs and Compose volumes are removed on exit.

The run checked that all four processes became ready; stopping Redis made
all four report non-ready, restarting Redis restored readiness; stopping
PostgreSQL made all four report non-ready, and restarting PostgreSQL
restored readiness. It then stopped the application processes, used
`pg_dump --format=custom` to snapshot the populated disposable database,
restored that dump with `pg_restore --exit-on-error` into a **different**
empty disposable database, and verified the original and restored
test-only sentinel survived. The workflow reported success for all stages.

**This is limited but genuine executable evidence**, not production DR
certification:

- Processes are run from checked-out source, **not** four signed
  production images; it does **not** exercise admission of approved
  ESM across four independently mounted production releases.
- The PostgreSQL dump includes migrated/seeding state plus a controlled
  marker; it is **not** an operator-signed whole-deployment backup,
  and does not include Redis RDB/AOF, media, release artifacts or an
  independent key vault snapshot.
- A later [successful live event drill #40228493169](https://github.com/AbdullahZaher/vibress/actions/runs/40228493169)
  now **does** exercise real durable PG admission, BullMQ transport and
  bounded retry after a transient controlled-handler failure, plus Redis
  interruption after a PG dispatch claim, and a PostgreSQL outage **after**
  Redis accepted the job but before PG queue acknowledgement. The restored
  lease is reclaimed and the same stable BullMQ job ID is reused.
  The drill also denies an unadmitted foreign-publication job and rejects
  a mismatched approved digest. The synthetic handler increments a counter;
  it deliberately never loads third-party ESM or invokes external providers.
  Thus it does **not** certify exactly-once external side effects,
  complete poison/dead-letter endurance or signed fleet rollout.
- The workflow measures bounded readiness recovery, not contractual
  end-to-end RPO/RTO for a customer's deployed service. Real backup
  verification, replica admission receipt provenance, alert delivery
  and operator authorization remain mandatory before M1A sign-off.

Do not execute this drill script on production or repurpose its test
key/credential fixtures. The workflow's isolate and short-lived cleanup
are part of its safety boundary.


### Live event-delivery fault evidence and exit discipline

The [event integration drill](../../scripts/plugins/drill-event-delivery.ts)
is called from the same guarded, disposable Docker workflow **after**
stopping the original API and Worker processes, so no unsigned extension
module can be loaded and no unrelated event consumer runs. It reuses the
production Drizzle receipt ledger, the production relay helper and the
production admitted-job gate with a synthetic, predictable counting handler.

Evidence on [commit `e76e764`](https://github.com/AbdullahZaher/vibress/commit/e76e76446d1461201f0216c24160b211038ff8ed)
is [drill run #40228493169](https://github.com/AbdullahZaher/vibress/actions/runs/40228493169)
**SUCCESS**. Its final log contains both
`PLUGIN_M1A_EVENT_DELIVERY_PASSED` and
`PLUGIN_M1A_LIVE_DRILL_PASSED`; the process exited normally, allowing
`pg_dump`/`pg_restore` to run as part of the same workflow. The
previously failing runs #40224594551 and #40227960040 exposed,
respectively, the need for bounded stale `pg Pool` read retries after
a forced PostgreSQL restart and the need to close the shared
`@vibress/cache` BullMQ Redis connection on CI-script teardown.
Both were fixed without disabling any event safety assertion.

A success result here establishes only **bounded fixture behavior on an
isolated, temporary GitHub runner**. It is not a signed operator plugin
release, a complete Redis/asset/key backup and restore, evidence of
exactly-once effects in external services, or measured production RPO/RTO.
A missing or stale independent fleet receipt still blocks M1A approval.

## Mandatory negative drills

| Injected condition | Required result |
| --- | --- |
| Strict policy without maintenance mode / lockfile pin / signer pin | Preflight rejects **before** DB inspection |
| Tampered lockfile, wrong signature, reviewed ESM hash, or missing review evidence | No success receipt and no plugin import |
| Valid old lockfile signed by a revoked operator key, including after restore | Revocation policy rejects signer on each replica; use the dedicated signer-revocation Compose override to inject it into both API/Worker; no legacy unsigned downgrade |
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
