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
