# Operator runbook: external plugin releases and recovery

**Trust boundary.** Vibress supports only operator-reviewed, SHA-256-pinned
ESM bundles. There is no isolation of malicious Node modules. JavaScript
extensions run with the privileges of the process and are not safe to
install from arbitrary publishers. A trusted plugin installed globally is
**not** automatically enabled for any publication.

## Preflight and deployment

1. Review and build the source in an isolated reproducible environment.
   Inspect dependencies and licenses and scan the final package.
2. Compute the SHA-256 of the **final .mjs bytes** and each reviewed Admin UI
   HTML document. Pin them in a `schemaVersion: 1` operator lockfile.
   Keep the lockfile outside writable upload paths and protect it from
   non-operator modifications. Never embed secrets into artifacts.
### Docker production: opt-in verified release mount

`compose.plugins.yml` is an optional override. Keep the operator approval
directory outside CMS content and upload mounts. It must be readable by the
non-root API process and contain `trusted-plugins.json`, `operator.sig`,
`operator-public.pem`, and its reviewed artifact subdirectories. Never
include the Ed25519 private key.

```bash
export VIBRESS_PLUGIN_RELEASE_DIR=/srv/vibress/operator-plugins
docker compose -f compose.prod.yml -f compose.plugins.yml build api
docker compose -f compose.prod.yml -f compose.plugins.yml \
  run --rm --no-deps --entrypoint node api dist/plugins-preflight.js
# Only after the preflight passes on every intended replica:
docker compose -f compose.prod.yml -f compose.plugins.yml up -d
```

The standalone preflight is bundled into the production API image. The API
startup also fails before opening its listener when the approved lockfile,
signature, bundle or Admin UI bytes are invalid. Runtime admission re-verifies
the lockfile signature and executable artifact checksum. Do not use the normal
`compose.prod.yml` alone for a deployment intended to enforce signatures,
because that file deliberately has no operator-controlled plugin mount.

The override is not a backup: take and retain a matching operator-controlled
snapshot of the approved bytes, public key and signature separately from the
database and content backups. Verify the matching snapshot before rolling back.
The private signing key requires separate secure offline custody.

### Optional signed release approval (EXT-404, additive)

For deployments requiring an independently authenticated operator approval,
sign the **exact final lockfile bytes** using a protected Ed25519 private key.
The key and signature must never be provided by a plugin, CMS user, or artifact
manifest. Keep the private key offline, outside the container, and never mount
it into Vibress. For example, on an operator-controlled signing machine:

```bash
openssl genpkey -algorithm ED25519 -out operator-private.pem
openssl pkey -in operator-private.pem -pubout -out operator-public.pem
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { sign } from "node:crypto";
const [lockfile, privateKey, output] = process.argv.slice(1);
const signature = sign(null, readFileSync(lockfile), readFileSync(privateKey));
writeFileSync(output, signature.toString("base64") + "\n");
' /absolute/path/trusted-plugins.json operator-private.pem operator.sig
```

Mount only the public key and detached base64 signature as **read-only operator
files** on every API replica. Set both environment variables to absolute paths:

```bash
VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE=/etc/vibress/operator-public.pem
VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE=/etc/vibress/operator.sig
```

The existing lockfile environment variable remains mandatory for external
plugins. For newly deployed production external plugins, the opt-in
`compose.plugins.yml` override sets
`VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1` on both API and Worker.
This setting **requires** the lockfile mount, public key and detached
signature and fails closed at API startup, worker startup, CLI preflight and
every trusted lockfile read. Direct deployments can set the same policy.
Existing unsigned v1 deployments remain compatible unless their operator
explicitly enables strict enforcement.

The runtime and preflight verify the Ed25519 signature against the
**same bytes** used to parse the operator lockfile, then verify each pinned
artifact SHA-256 before loading code. A missing or invalid signature, missing
half of the configuration, altered lockfile, or substituted public key causes
admission to fail. If **neither** new variable is set, existing unsigned
operator-trusted installations continue to work; operators should explicitly
enable both variables in production where signature enforcement is required.

Regenerate and distribute a new detached signature whenever the lockfile bytes
change. Deploy the matching signed lockfile, public key and all approved
artifacts consistently on every replica before enabling traffic. During key
rotation, replace the trusted public key and signed lockfile together as a
controlled operator deployment; do not accept a key or signature obtained from
plugin-controlled content. This signature attests to operator approval, **not**
malware-free code, independent reproducible builds or process isolation.

3. Deploy identical release bytes to each API replica. Check the exact
   release on **every replica** before traffic or plugin enablement:

   ```bash
   VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/absolute/path/trusted-plugins.json \
     pnpm exec tsx scripts/plugins/preflight.ts
   ```

   A nonzero exit rejects the release; this check does **not** import or
   execute plugin code. The runtime independently checks the digest before
   each new load. The example extension source and conformance test are
   located in `examples/plugins/hello-public`.
4. Back up PostgreSQL and persistent storage with the existing signed backup
   procedure. Save an operator-controlled snapshot of the **matching**
   lockfile, package bytes and encryption key outside the CMS content tree.
   These operator-mounted files may not be part of the database backup and
   require separate custody. Never copy secrets into documentation or logs.
5. Register the operator-approved manifest and explicitly enable the plugin
   for each intended publication. Test A and B separately. Confirm Staff
   permissions, private-site password, published locales, RTL and theme
   fallback; do not infer publication enablement from global activation.
6. Verify the public scalar route and Studio iframe from outside the API
   container through the actual TLS proxy. Monitor errors, startup and
   denied-read counters; external CDN/WAF/proxy logs must redact single-use
   frame-ticket query parameters.

## EXT-401 PostgreSQL-backed event admission (durable increment)

**Upgrade first.** Deploy database migration `0044_plugin_event_receipts` before
starting any newly built API/Worker replica. Drain pre-migration
`vibress-plugin-events` jobs: older Redis jobs have no PostgreSQL receipt and
the new worker deliberately refuses to execute them. Take a signed backup
before upgrading; do not edit past migrations or synthesize authorizations.

API and Worker both require the **same operator-reviewed plugin bundle bytes,
signature and pinned SHA-256** using `compose.plugins.yml`. The Worker
preflights the release, rejects an absent receipt, and checks plugin release,
capabilities, publication state and registered hooks before running code.

A globally authorized plugin operator with `plugins.manage` and local
publication owner/admin permission may submit a declared event through:

`POST /api/admin/v1/plugins/:id/events`

using a Staff session, same-site Origin and authoritative publication context.
Accepted fields are only:

```json
{
  "eventId": "fd1e743f-4b9d-4b45-925b-80c3765bf3e6",
  "eventName": "post.published",
  "payload": { "postId": "published-content-reference" }
}
```

HTTP 202 `status: "queued", dispatchStatus: "pending"` means the **immutable PostgreSQL receipt is
committed**, not that BullMQ has already processed or acknowledged it. The Host
binds plugin ID, publication ID and pinned artifact SHA; clients must never
supply those fields. `plugin_event_receipts` preserves the event identity and
envelope hash independently of Redis retention. Reusing the same ID with a
different release or payload returns HTTP 409; identical retries remain safe.

The Worker periodically claims pending admissions with `FOR UPDATE SKIP LOCKED`,
enqueues deterministic job IDs into BullMQ, and reclaims stale dispatch claims
after two minutes. It conditionally finalizes receipts as `executed` or
`retired`. Missing or modified PostgreSQL receipts cannot authorize replayed
or forged Redis jobs. Publication deletion cascades event receipts; installed
plugin deletion remains restricted by receipts pending a reviewed purge policy.

**At-least-once, not exactly-once:** a handler may perform a side effect and
crash before the receipt is finalized. Plugin code MUST use its own business
idempotency where appropriate. Redis retries use five attempts and exponential
backoff; BullMQ keeps failed jobs for 30 days or up to 100,000 items. Queued
jobs that exhaust retries are **not** automatically replayed after a failed
plugin release: inspect the BullMQ failed set and review the data/schema
before operator-authorized recovery. No Member/public/plugin-direct queue
admission exists. Never put secrets, member personal data, HTML or session
tokens in job payloads.

### Failed-event inspection and explicit operator replay

A platform plugin operator with `plugins.manage` and **owner/admin** access
to the selected publication can inspect the Redis failed set without receiving
private plugin payloads, stack traces or failure reasons:

- `GET /api/admin/v1/plugins/:id/events/failed?offset=0&limit=25`
  queries up to 50 queued PostgreSQL receipts belonging to the authorized
  **publication and plugin**, then checks only those Redis job IDs for failed
  state. The returned `nextOffset` advances through scoped receipts rather
  than exposing the size of the global Redis failed set. A sparse result
  means some scoped receipts are not failed, not that there are no more.
- `GET /api/admin/v1/plugins/:id/events/:eventId` returns only an exact
  failed event ID, job ID and attempts count, never plugin-managed data.
- `POST /api/admin/v1/plugins/:id/events/:eventId/replay` requires same-site
  Origin and `{"confirmAtLeastOnceRisk":true}`. The Host confirms an exact
  still-queued receipt, failed BullMQ job, same pinned bundle/version/hook,
  active global plugin, and current publication enablement. It commits an
  `plugin.event_replay_requested` audit entry with the authenticated operator
  and request ID **before** asking BullMQ to retry the existing job.

A request audit means *requested*, not successfully executed. A Redis failure
may leave an audit request but no replay; an operator may retry the action.
Concurrent replay requests may race: only the Redis failed-state transition
can accept a replay, and the Worker still verifies the receipt and
authorization before execution. A completed/retired receipt, missing failed
job, revoked release, foreign publication or tampered envelope cannot replay.

**Operator procedure:** back up PostgreSQL and the approved artifact first,
verify the underlying plugin side effect is safe to repeat, correct the
outage, review the failed status, then replay only the selected event. Do not
bulk-reset the queue or edit PostgreSQL receipts. Never treat replay as
exactly-once: a prior attempt may have completed its side effect before
crashing. Keep a business idempotency key inside the plugin itself.

The Admin **Plugins** panel exposes the same publication-scoped failed-event
query and replay operations only to an authenticated platform plugin operator.
It requires two deliberate actions (review, confirm) to replay a selected
failed job, with visible at-least-once warnings. UI state is cleared on
publication switches to avoid stale cross-publication event IDs.

**Remaining EXT-401 gates:** deeper cross-service domain-event transaction integration (only operator admission is
durable so far), reviewed ledger retention/purge, multi-replica crash/recovery
drills and backlog/age metrics. Signed DB backups include the ledger, but a
coordinated PostgreSQL/Redis/artifact restore runbook and tested restore
automation are still required.

## EXT-403 read-only database/artifact restore preflight

Restore a *signed*, consistent PostgreSQL backup and stage the exact approved
external plugin artifact directory on each API and worker node. **Keep all
normal API and Worker replicas stopped**, including background/cron execution.
The database snapshot must include plugin installations, publication settings,
approved schema-migration ledger and `plugin_event_receipts`. Restore the
matching Redis queue snapshot separately when applicable; a PostgreSQL-only
restore cannot recover every in-flight BullMQ job.

On an operator workstation with DB connectivity, the same validated
environment, and the operator's read-only trusted release mount, run:

```bash
VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1 \
  pnpm exec tsx scripts/plugins/check-restore.ts
```

The read-only command verifies the Ed25519-approved files and digests before
querying PostgreSQL; it checks all *active, publication-enabled* plugin release
versions and pages through every pending/dispatching/queued event receipt.
A missing release, old artifact digest, malformed envelope or changed receipt
hash stops the recovery. No plugin module is imported or executed and the
command prints counts, not event payloads, credentials or tenant identities.

This is a **compatibility gate, not a restore or queue-reconstruction tool**.
Before reopening traffic, perform a restore drill, reconcile Redis jobs and
pending receipts, verify irreversible plugin schema migrations against the
approved operator change record, then bring up one worker and API replica at
a time. Disabled/retired plugins may retain old database content; do not
silently delete or migrate their tables as part of restore.

### Read-only PostgreSQL/Redis reconciliation after restore

Once `scripts/plugins/check-restore.ts` has validated the exact signed
operator release against restored PostgreSQL, **keep all normal API/Worker
replicas stopped**. Restore the matching Redis snapshot as directed by the
existing backup procedure. Set `VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1`
in an isolated operator CLI environment (never in a live serving replica),
and run:

```bash
VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1 \
  pnpm exec tsx scripts/plugins/check-queue-recovery.ts
```

The read-only command scans PostgreSQL receipts with `status='queued'`
using stable keyset pagination. It verifies every receipt's immutable
event hash, its exact deterministic Redis job ID/envelope and its BullMQ
state, bounded to at most 100,000 rows. Operators with a larger backlog
must plan and explicitly extend the reviewed tool rather than treating a
partial scan as complete.

It prints **aggregate counts only**, and returns a nonzero exit code for
missing, invalid, terminal, or failed jobs, network/database errors, or
a scan-limit breach. Failed jobs may require audited operator replay after
reviewing idempotency and the root cause. Missing jobs may require a
separate, reviewed durable-ledger reconciliation plan; **do not manually
fabricate BullMQ jobs or reset ledger state**.

This is an additional *consistency check*, not queue recovery automation;
it never modifies Redis, PostgreSQL, the plugin filesystem or API state.
A green read-only preflight does not prove that all plugin side effects
are reversible or exactly-once.

## EXT-404 operator metrics for trusted plugin events

When the trusted event worker is configured, its existing private `/metrics`
endpoint publishes `plugin_events_consumer_ready`,
`plugin_events_queue_jobs{state="waiting|active|delayed|failed"}`, the
count of PostgreSQL admission claims per sweep, and counters for processed,
retired/unadmitted, failed and relayed jobs. The labels are fixed enums; no
publication IDs or plugin payloads enter observability tags. Enable the
existing metrics configuration and restrict network access to the monitoring
system; do **not** publish `/metrics` openly on the Internet. Alert on
consumer readiness 0, sustained queue backlog, and rising failure counts.

These probes help detect operational faults but do not replace a
multi-replica canary, release scan, or a tested rollback.

## EXT-402 explicit publication-secret revocation

`DELETE /api/admin/v1/plugins/:id/publication-settings/:key` requires a
Staff session, `plugins.manage`, valid Origin and owner/admin membership in
the Host-selected publication. Only a declared secret key can be deleted,
and the ciphertext deletion and operator audit record commit in a single
PostgreSQL transaction. Successful revocation is idempotent (204), including
an already absent secret. The request never accepts a publication ID or
plaintext secret. `PATCH .../publication-settings` retains its historical
replace-only semantics for null/empty secrets.

**Still required:** an envelope-encryption key-version model and a tested
master-key rotation/backfill/rollback plan across upgraded self-hosted
installations. Revoking a stored secret cannot invalidate credentials
already copied outside Vibress by a trusted extension.

## Upgrade and rollback

- Before any version change: verify the SDK ABI, verify the release is
  compatible with **existing stored plugin data**, snapshot the database,
  confirm the exact same operator bytes are staged on all nodes, then
  quiesce new plugin admissions while changing versions.
- Do not rewrite old migrations or downgrade data schemas automatically.
  If the plugin data schema changed incompatibly, use a reviewed forward-fix
  migration or restore the consistent snapshot; never assume an older
  plugin can read a newer database.
- To disable a compromised release, revoke publication enablement first,
  deactivate the global plugin according to the existing lifecycle, and
  remove its operator approval. Drain in-flight work and rotate any
  implicated secrets according to the operator's incident policy.
- Re-run the preflight and runtime/tenant/locale matrix after any restore.
  Confirm older content and historical settings are preserved.

## Failures and known release blockers

| Condition | Required action |
| --- | --- |
| Digest mismatch / symlink / absent file | Refuse activation and repair the release mount; never skip verification |
| Redis unavailable | Deny interactive iframe tickets and restore the shared Redis service |
| Publication permission revoked | Remove active iframe, block future public/member/Staff bridge calls |
| Private-site settings unavailable | Fail closed; do not serve cached public data from another publication |
| Worker retry / duplicate event | Do not perform non-idempotent mutations until EXT-401 durable task admission is implemented |
| Secret rotation / audit | Continue using explicit encrypted publication settings; EXT-402 rotation/audit verification is a separate release gate |
| Destructive uninstall | Preserve plugin-owned content until separately backed up and explicitly purged under a reviewed workflow |

**Release status:** The EXT-302B locale/SEO policy, EXT-303 theme extension
slot, EXT-304 reference SDK sample, and a preflight for EXT-404 are implemented
as separate changes on a review branch. This is **not** proof that
full EXT-401 idempotency/operational replay, EXT-402 rotation, EXT-403 backup automation,
full supply-chain scanning/provenance, or EXT-501–504 LMS pilot/release gates are complete.
Those features still require code, live testing and signed-off release reviews.

Never weaken Staff/Member authorization, tenant scoping, encryption, signed
backups or test coverage to achieve an accelerated rollout.

## Read-only signed physical-model plan preflight (EXT-503)

Before applying a plugin's operator-approved physical-model migration, verify
that its standalone migration plan matches the **same pinned signed release**
and the exact, already-vetted model declarations. This preflight checks the
Ed25519 signature, all pinned on-disk plugin bytes, manifest/version/artifact
SHA-256, each model descriptor SHA-256 and the ordered migration digest. It
rejects arbitrary/extra fields, unapproved columns and changed model order.
It never imports plugin JavaScript, runs SQL or activates a plugin.

In a *Vibress core checkout* with dependencies installed, stage the immutable
reviewed release and plan as operator-controlled, non-upload files and run:

```sh
export VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/absolute/operator/trusted-plugins.json
export VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1
export VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE=/absolute/operator/operator-public.pem
export VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE=/absolute/operator/operator.sig
pnpm exec tsx scripts/plugins/check-migration-plan.ts \
  /absolute/operator/operator-migration-plan.json
```

Use the **merged global signed lockfile**, not a generated Pilot-only example
that would replace or lose existing plugin approvals. The plan cannot authorize
itself: it must match the separately authenticated operator lockfile entry.
A valid result is a **read-only compatibility gate**, not migration admission,
completed database initialization or release approval. Apply the reviewed
migration separately using the existing operator-only transaction service
*while the plugin is inactive*, after a signed backup. Recheck every API
replica, publication enablement, real Member sessions, restore and rollback
before production. A missing signature, replaced artifact, schema drift,
invalid plan, symlink or invalid UTF-8 must stop the procedure.

## EXT-504: explicit offline schema-admission command (review branch)

The **read-only** `scripts/plugins/check-migration-plan.ts` remains unchanged in
its effect: it never connects to PostgreSQL. After **PR #81** and this separately
reviewed EXT-504 branch have merged, an operator may apply the verified physical
models using a *different* CLI. Never invoke it during normal API/Worker startup,
or via HTTP, Admin UI, a plugin hook, or a self-hosted customer request.

1. Back up and verify both PostgreSQL and the exact signed operator release.
   Quiesce **all** API/Worker replicas; arrange a maintenance window and confirm
   the target database and publication lifecycle. The plugin must be
   `registered` or `inactive`; `active` is rejected by the transactional DB
   migration repository. Never rewrite or replay old changed migrations.
2. Deploy operator-controlled final `.mjs`, global lockfile, Ed25519 detached
   signature, public key and reviewed `operator-migration-plan.json`. The
   signing private key must **never** enter a server container. Run the
   read-only preflight against those exact files on each target node first.
3. On a **separate isolated** CLI workstation/container with appropriate DB
   access (not on a serving replica), require the two independent deliberate
   operator acknowledgements below. Copy the exact manifest and 64-character
   migration checksum from the already-reviewed plan; these arguments are not
   valid authority on their own, only in addition to the signed release.

```sh
export VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/absolute/operator/trusted-plugins.json
export VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1
export VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE=/absolute/operator/operator-public.pem
export VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE=/absolute/operator/operator.sig
export VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1
export VIBRESS_PLUGIN_SCHEMA_APPLY_ACK=1
pnpm exec tsx scripts/plugins/apply-migration-plan.ts \
  /absolute/operator/operator-migration-plan.json \
  --confirm-manifest=vibress-lms-pilot \
  --confirm-migration-sha256=<approved-64-character-hex-sha256>
```

**Destructive or production operations require separate operator review.**
The command uses the existing approved `PluginPhysicalSchemaMigrationService`
and `DrizzlePluginStorageMigrationRepository` transaction: it reserves the
immutable migration ledger and physical models atomically and fails closed for
wrong version, missing installation, already active plugin, duplicate model,
changed digest or out-of-order migration. Exact replays return
`already_applied`; no destructive down migration is attempted. This command
*does* change PostgreSQL: unlike the read-only preflight, do not run it merely
to test whether a release is acceptable. Never invoke the standalone LMS
`0001_initial.sql` in the host database.

Before resuming replicas verify `plugin_member_records` migration 0045,
publication enablement, the pinned release on every node, two-publication
isolation, signed backup/restore readiness, and the separate LMS HTTP
acceptance tool. Reenable normal API/Worker replicas only after acceptance.

## EXT-506: Real Vibress LMS Live-Host Integration

The end-to-end integration of the actual compiled `vibress-lms` ESM artifact
(`dist/pilot-release/vibress-lms-pilot.mjs`) has been verified against a real
Fastify HTTP host and real PostgreSQL database in `tests/integration/real-lms-pilot-host.test.ts`.

### Verified Acceptance Gates

1. **Preflight Security:** Rejects tampered artifacts and plans; requires valid
   Ed25519 signature on `trusted-plugins.json`.
2. **Transactional Migration:** Applies approved physical storage models
   (`enrollments`, `completions`) to the append-only ledger. Replays return
   `already_applied`.
3. **Multi-Publication Scoping:** Tested across two isolated publications
   (`site-a`, `site-b`) and three distinct Member sessions (`mem-a1`, `mem-a2`, `mem-b1`).
4. **Member Acceptance (`verifyLiveHost`):**
   - Free course enrollment and duplicate enrollment idempotency.
   - Protected lesson access with active enrollment in English and Arabic (RTL).
   - Atomic lesson completion and progress calculation (50% on 1/2 completed).
   - Anonymous and cross-tenant access rejection (`401/403/404`).
   - Cross-origin POST rejection via CSRF/Origin enforcement (`403 Forbidden`).
5. **Lifecycle & Retention:** Deactivating a publication immediately blocks
   extension routes while retaining all persisted member records in `plugin_member_records`.
   Reactivation immediately restores access.
6. **Genuine Backup & Restore:** Creates disposable clone database, verifies
   row counts, models, and member records, and validates `assertPluginRestoreReadiness`.
7. **Negative Security:** Rejects unauthenticated access, CSRF origin mismatches,
   path traversal, and payload spoofing attempts.

To run the full host integration suite:

```bash
pnpm exec vitest run tests/integration/real-lms-pilot-host.test.ts
```

For full details, see [EXT-506 Architecture & Integration](lms-real-integration-ext506.md).


## LMS-104 safe upgrade and audience-scoped read grants

The operator-signed lockfile accepts the **optional**, additive
`publicReadModels` and `memberReadModels` model-key arrays. Both are
validated against `storageModels` at admission. An explicit empty array
denies that audience's generic model storage session. Legacy signed
lockfiles without either field continue to work with their existing
model grants until the operator reviews and re-signs them; absence is
not a least-privilege default.

For LMS-104, sign both lists as `["courses"]`. Enrollment and completion
records remain accessible only through the separate, member-bound storage
session, not generic public/member model grants.

**Upgrade in this order:** deploy and migrate a backed-up Core release
that understands the optional Admin read selectors and these operator
read grants; verify publication authorization, Member sessions, and
the public extension host; then deploy the signed LMS authoring release
pinned by SHA-256. Verify the final .mjs and HTML digests, apply the
unchanged forward-only LMS models, then enable a canary publication.
Never deploy a new LMS package onto an earlier Core runtime that still
rejects the new optional Admin GET query shape. Disabling LMS must
preserve authored courses, enrollments, and progress.

**Catalog performance:** On Core versions supporting optional SDK
`listByText`, the Host resolves the signed `courses` model and executes a
publication-scoped PostgreSQL equality filter on `status = 'published'`,
rather than scanning draft records. LMS retains the prior bounded cursor
scan on older Core installations for compatibility. Both paths stop
after 64 pages of 50 records, returning `unavailable` instead of
silently hiding records if that bound is exceeded. The 4-KB HTML
projection remains bounded; a future cursor-based public presentation
contract is needed to show more course cards without truncation.

For **fresh installations**, the operator-signed `indexedTextFields:
["status"]` creates the matching `(publication_id, status, id)` index on
the new, empty course table inside its approved physical migration.

For **populated upgrades**, never run blocking `CREATE INDEX` inside the
published schema migrations. Verify the operator-signed LMS release,
take a valid backup, and run the dedicated concurrent-index maintenance
command from the Core release (requires the signed plan and configured
PostgreSQL credentials):

```bash
pnpm exec tsx scripts/plugins/ensure-approved-text-indexes.ts /absolute/path/operator-migration-plan.json
# Review the dry-run SQL and maintenance window, then explicitly apply:
pnpm exec tsx scripts/plugins/ensure-approved-text-indexes.ts /absolute/path/operator-migration-plan.json --apply
```

The command confirms ownership/digest from the authoritative physical
model catalog and verifies the resulting index is valid. It does not
rewrite migrations or plugin content. A failed concurrent index build
must be repaired manually after inspecting `pg_index.indisvalid`; do
not bypass this check or automatically delete existing indexes.
The current filtered API works even before indexing, but may use a
sequential PostgreSQL scan until maintenance completes.

After upgrading Zod 3 to Zod 4, run typecheck, contract tests, the
existing populated-install/migration tests, production dependency audit,
and a browser drill that covers actual signed LMS installation,
enrollment, protected lesson reads, and course completion. CI's generic
Playwright PR suite does not by itself constitute that LMS drill.


### Real-browser signed LMS staging acceptance

After Core-first upgrade, enabling the **verified signed LMS release**,
creating a uniquely named published test course in publication A, and
provisioning a fresh test Member, run the dedicated browser suite
against two real gateway-hosted publications. Publication B must not
contain this test course ID. Do not use live paying Member cookies,
production data, or an arbitrary third-party plugin package.

```bash
export VIBRESS_LMS_ACCEPTANCE_SITE_A="https://site-a-staging.example/"
export VIBRESS_LMS_ACCEPTANCE_SITE_B="https://site-b-staging.example/"
export VIBRESS_LMS_ACCEPTANCE_COURSE_ID="staging-course-unique"
export VIBRESS_LMS_ACCEPTANCE_MEMBER_COOKIE_A="member_cookie_name=secret"
# Optional, after explicitly enabling the regional Arabic locale:
export VIBRESS_LMS_ACCEPTANCE_ARABIC_DETAIL_PATH="/ar/courses/staging-course-unique"
pnpm exec playwright test --config tests/acceptance/playwright.config.ts
```

The suite checks public/Member isolation, same-origin enrollment,
literal-text protected lessons, completion, and optional RTL. It is an
**operator acceptance gate**, not a mocked PR E2E replacement. Its config
disables traces/screenshots/video so authenticated cookies are not
persisted in artifacts. The secret environment variables are not
printed. Staff create/save/publish, active-session revocation and
backup/restore still require the preceding Fastify integration tests
and the production reverse-proxy canary drill.
