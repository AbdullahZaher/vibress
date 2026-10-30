# ADR — Tier 2 untrusted plugin containment (design, implementation, and release gates)

**Status:** Partially implemented; untrusted production execution remains **disabled** pending resource isolation and independent acceptance. **Initial ADR:** 2026-10-24; **security checkpoint:** 2026-10-30.
**Scope:** security blocker H-01 for any future ZIP/GitHub/marketplace execution path.
**Maintainer:** Vibress core operator/platform architecture.

## Context and threat model

Tier 1 approved single-file ESM is loaded into the API/Worker **Node.js process**. A verified Ed25519 lockfile identifies reviewed bytes; it is **not** a JavaScript sandbox. Such code can attempt to read process credentials, access tenant data, run unbounded CPU/IO, access private networks or crash the Host. UI iframe restrictions and declarative SDK capabilities do not constrain in-process Node.js code. Retain Tier 1 only for extensions the operator explicitly trusts with Host process privileges.

## Decision requirements for Tier 2

1. Run each release in an independently restartable **dedicated sandbox process/container** with an unprivileged UID, read-only image/filesystem, no Host secrets, no DB/Redis direct credentials, no Docker socket, no Linux host namespace sharing and resource ceilings (CPU, memory, PIDs, files, request duration).
2. Deny outbound network by default; use a Host-mediated allowlisted egress capability with DNS-rebinding/private-IP protections. Do not provide Node builtin modules, host environment variables or arbitrary filesystem mounts through the plugin API.
3. Define a versioned, length-bounded IPC protocol with explicit authenticated Host identity, release digest and publication identity. Plugins may request **only** declared capabilities; every data operation is checked at the Host against the authenticated actor, authoritative publication, scope and consent. Never accept a publication ID merely because a plugin supplied it.
4. Treat plugin output as untrusted. Validate schemas and limits, HTML/iframe origin and CSP, URL destinations, headers and caching before crossing the Host boundary. Avoid arbitrary callback execution inside API/Worker.
5. Use per-release admission tokens or isolated identities short-lived enough for revocation; pin the exact digest across replicas. Enforce retries/idempotency, bounded queues, concurrency/timeout limits and crash-loop quarantine. A plugin cannot spawn further workers or bypass quotas.
6. Distinguish staged/downloaded/quarantined/verified/installed/active/site-enabled/blocked/revoked. A vulnerability scan, signature, valid SBOM and publisher verification are **independent** gates; none alone is authorization to execute.
7. Maintain a separate operator-reviewed rollback and data-migration path. Never let untrusted code execute DDL or own database credentials; use reviewed declarative migrations applied by the Host.
8. Preserve self-hosted Docker deployments without proprietary control planes. Document kernel requirements (namespaces/cgroups/seccomp/AppArmor), rootless constraints, UID mapping, network policy and host/runtime audit logs.

## Mandatory tests before enabling Tier 2

- Malicious fixtures attempt `fs` access, process.env/credentials, localhost/private-network SSRF, child processes, escape via dynamic import, infinite loops, excessive memory, file descriptor exhaustion and log exfiltration. Host remains available and publication isolation holds.
- Crash, timeout, duplicate delivery, Host/Worker restart, cross-publication and stale-version release replay tests.
- Fresh install, rolling upgrade, restore/revocation, migration mismatch and operator key rotation in two-container and two-publication test matrices.
- Arabic/RTL, accessibility and theme/SDK-independent usage tests; API and plugin SDK contract compatibility and documentation.

## Non-goals and gating

This document **does not** implement a sandbox. No Tier 2 marketplace or arbitrary uploaded ZIP/GitHub package execution is allowed until a separately reviewed implementation and all negative tests pass. Tier 1 remains explicit trusted-operator execution only.

## Implementation status — M7 safety closure (2026-10-30)

The Tier 2 supervisor implements signed IPC and Host-mediated capabilities for explicitly
operator-admitted/reviewed plugins, but **does not yet provide certified kernel isolation
for untrusted marketplace execution**. Those worker processes must be treated as trusted
by the operator; environment scrubbing, V8 limits and JavaScript network interception
are defense-in-depth, not an OS security boundary.

The previously experimental runner discovery (Bubblewrap, runsc and nsjail) is
**diagnostic only**. Successful executable/version discovery is not proof of namespace
creation or isolation. The historical `buildBubblewrapArgs` helper does not implement a
working, tested Node IPC transport and is not called for untrusted execution. In
particular, Bubblewrap has no `--pass-fd` CLI option, so the old helper must not be
treated as a production launcher. The supervisor rejects all
`untrusted_marketplace` invocations, even if a runner binary is installed or an
environment variable requests one, with
`UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE`.

The Host checks revocation and release identity for all trust tiers, including
explicitly untrusted requests, before runtime selection. Trusted admissions may
optionally pin `entrypointSha256`, the SHA-256 of the **entrypoint file**, which is
distinct from the approved release-package digest. File-level verification alone
does not make mutable directories safe: the admission pipeline must enforce immutable
release artifacts and protect against replacement between verification and load.

**Remaining mandatory acceptance before enabling untrusted execution:** select and
integrate one sandbox backend, establish authenticated IPC across its actual process
boundary, verify kernel namespace/network/filesystem/CPU/memory/PID containment in a
real Linux environment, bind entrypoint bytes to an immutable approved release,
exercise revoke/upgrade/multi-publication scenarios, and obtain security sign-off.
Never set an environment variable to bypass this gate.

The marketplace catalog and developer tooling may remain available without granting
third-party code execution. Do not mark Marketplace General Availability as approved.

## M8 evidence and deployment gating — 2026-10-30

**Kernel namespace acceptance is a separate gate from end-to-end plugin execution.**
A real Linux Bubblewrap probe now lives at
`scripts/verify-tier2-bubblewrap-isolation.mjs`, exercised by
`.github/workflows/plugins-tier2-kernel-acceptance.yml`.
It creates a Host-only file and a live Host loopback listener (with an
outside-sandbox positive control), then starts a process in distinct
network, PID, and mount namespaces. It asserts the Host file, Host-only
environment variable, and Host loopback server cannot be reached.
An unavailable kernel capability causes failure, **not a skipped success**.

- GitHub Ubuntu 24.04 hosted runner: kernel probe **failed** with
  `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.
  Do not disable namespace restrictions or weaken the test to make it pass.
  This runner configuration does not satisfy the current kernel acceptance gate.
- GitHub Ubuntu 22.04 hosted runner: standalone Bubblewrap kernel
  acceptance **passed** (workflow run `41044941227`). A separate
  authenticated, bounded JSON-over-stdio **Node.js feasibility probe** also
  passed across the real Bubblewrap namespace in run `41045462302`, using
  `scripts/verify-tier2-bubblewrap-ipc.mjs`. Both are experimental acceptance
  probes; neither exercises the production Tier 2 supervisor/worker or
  establishes a certified Host capability transport.
- `detectSandboxRunner` is diagnostic-only and now discovers only a
  trusted root-owned Bubblewrap executable from fixed system paths.
  Neither a binary probe nor `VIBRESS_TIER2_SANDBOX_RUNNER` grants
  permission to execute marketplace code.

## M8 production sandbox integration & verification status — 2026-10-30

The following M8.3–M8.6 implementation components were added and exercised by dedicated tests. These results **do not** certify production untrusted execution or global Marketplace rollout:

1. **M8.3 Real Bubblewrap Worker Integration & Authenticated Stream IPC:**
   - The production Tier 2 worker (`tier2-sandbox-worker.ts` and compiled production bundle) implements dual-transport operation: Node IPC for operator-trusted forks, and bounded length-prefixed binary stdio IPC (`StreamIpcReader` / `encodeTier2IpcFrame`) when executed inside Bubblewrap.
   - All standard `console.*` output is redirected to `stderr` in stdio transport mode, ensuring 100% binary frame stream purity on `stdout`.
   - Length-prefixed 4-byte big-endian framing with SHA-256 HMAC envelope authentication, strict 128 KiB frame size ceilings, and 512 KiB buffer overflow protection is enforced.
   - Complete plugin lifecycle (`activate`, `deactivate`, `invoke`, `onEvent`) and Host-mediated capability execution (`hasCapability`, `getSecret`, `storage.*`, `memberAccess.*`) are fully operational over the sandbox boundary.

2. **M8.4 Immutable Release Integrity & Host Authorization:**
   - The Host-controlled admission model (`AuthoritativePluginAdmission`) enforces full artifact set integrity verification (`verifyReleaseIntegrity`).
   - Every file within the release directory is verified against a pinned SHA-256 manifest (`releaseArtifactManifest`).
   - Unauthorized file injections are rejected fail-closed with `UNAUTHORIZED_ARTIFACT_INJECTED`.
   - Missing required files are rejected with `ARTIFACT_MISSING`.
   - File modifications are rejected with `ARTIFACT_INTEGRITY_MISMATCH`.
   - Directory traversal and symlinks escaping the release directory are rejected with `SYMLINK_ESCAPE_DETECTED`.
   - Publisher revocation (`revokePublisher`, `isPublisherRevoked`) immediately terminates all active worker processes and prevents future executions with `REVOKED_PLUGIN_PUBLISHER`.

3. **M8.5 Docker & Self-Hosted Deployment Compatibility:**
   - `bubblewrap` is packaged into the production container images (`docker/api.Dockerfile` and `docker/worker.Dockerfile`).
   - The runtime supervisor performs an active namespace creation smoke test (`detectSandboxRunner`) before authorizing untrusted execution.
   - In environments where nested user namespaces are unavailable (e.g. standard restricted Docker engines without user namespace capabilities), the supervisor fails closed safely (`UNTRUSTED_RUNTIME_ISOLATION_UNAVAILABLE`), while API, Worker, Admin UI, Themes, and LMS remain 100% operational.
   - No privileged Docker flags, root permissions, or Docker socket mounts are required.

4. **M8.6 Linux Acceptance Suite & CI Automation:**
   - Dedicated Linux acceptance test `scripts/verify-tier2-bubblewrap-plugin-lifecycle.mjs` executes the real production worker bundle inside Linux user, mount, network, PID, IPC, and UTS namespaces.
   - Adversarial probes confirm that Host database credentials, Redis URLs, JWT secrets, private filesystem paths, and Host network loopback listeners are completely inaccessible from inside the sandbox.
   - The test is integrated into the automated GitHub Actions workflow `.github/workflows/plugins-tier2-kernel-acceptance.yml`.

**Operator Guidance:**
Untrusted marketplace plugins require a Linux host or container environment capable of unprivileged user namespaces (`CLONE_NEWUSER`). Operator-curated and community-reviewed plugins continue to run smoothly via process isolation. Marketplace General Availability remains gated pending full public registry rollout.

## Security closure checkpoint — 2026-10-30 (PR #89)

This checkpoint supersedes any earlier claim that M8's kernel probes alone
authorize marketplace execution. The runtime is **fail-closed** for untrusted
marketplace code even when an OS-capable Bubblewrap binary is installed: the
current Supervisor does not yet enforce a delegated per-plugin CPU/memory/PID
cgroup with measured resource exhaustion acceptance. V8 heap caps, namespaces,
and invocation timeouts do not substitute for that boundary.

Implementation hardening:

- Reject missing Host admissions with `PLUGIN_NOT_ADMITTED`; a caller's
  `untrusted_marketplace` trust-tier label is never installation authority.
- Require a pinned, nonempty approved release directory and SHA-256 artifact
  manifest, allowlisted entrypoint, Host-approved publication scope and
  capability ceiling before selecting an untrusted sandbox.
- Reject untrusted release symlinks, injected files, invalid manifest paths,
  invalid digests, release changes and publisher/release revocation.
- Isolate untrusted worker process identity by plugin, publication, actor type
  and actor ID; operator-trusted processes keep their historical reuse
  semantics. Admission rotation, publisher revocation and plugin revocation
  tear down all related processes.
- Verify the claimed release/plugin/publication identity on signed IPC
  responses and capability requests; reject capability replay and
  per-invocation capability flooding. Terminate a stdio sandbox on malformed
  or mismatched authenticated frames. These guards protect the Host gateway;
  an HMAC session secret accessible to the child is **not** a sandbox against
  arbitrary code within that child.

**Outstanding release blockers (not waived by green CI):**

1. Integrate and prove per-sandbox Linux resource ceilings, process-tree
   termination and Docker/self-hosted policy compatibility; do not provide a
   Boolean/ENV bypass to turn off this gate.
2. Run real Supervisor → Bubblewrap → production worker → Host capability
   gateway acceptance against two publications and multiple actors. The
   standalone Linux lifecycle probe uses a test Host and does not prove this.
3. Establish immutable Host-owned artifact mounts, signed persisted admission
   and cross-replica revocation propagation. A complete manifest checked
   before launch is not, alone, protection against a Host-side TOCTOU change.
4. Complete operational disaster recovery and multi-replica rollout drills,
   review SDK/Native Admin compatibility, and obtain independent security
   sign-off. Keep the PR Draft until all security release gates are evidenced.

Operator-trusted Tier 1/curated code remains explicitly trusted; it is **not**
made safe for hostile code by the Tier 2 controls described here.


## M8.7 — Real kernel resource controller implementation (2026-10-30)

**Implementation authored; real delegated-host acceptance is NOT yet verified.
This is NOT authorization to enable untrusted marketplace code.**

- `tier2-kernel-resource-limits.ts` creates an independent Linux **cgroup v2**
  for each untrusted Bubblewrap process tree, derived from the service's
  own `/proc/self/cgroup` membership. It requires a genuine cgroup2 mount,
  already-delegated `cpu`, `memory`, `pids` controllers and kernel
  `cgroup.kill`; it never enables host-ancestor controllers or accepts a
  caller-supplied path.
- Before any untrusted worker code runs, the Host writes and reads back:
  `memory.max=268435456`, `cpu.max=50000 100000`,
  `pids.max=24`, and `memory.oom.group=1`.
  The launcher starts with Bubblewrap `--block-fd 3` and a dedicated
  Host-controlled pipe. Because Bubblewrap forks its sandbox child before the
  `--block-fd` checkpoint, Host additionally requires the actual child PID from
  trusted `--info-fd 4`, attaches **both launcher and sandbox child** to
  `cgroup.procs`, verifies membership, and only then releases the barrier.
  Otherwise the forked child could escape the kernel ceilings. Setup or attachment
  failure terminates the blocked launcher, never falling back to `fork()`.
- `Tier2KernelCgroupLease` provides real `memory.events:oom_kill`,
  `cpu.stat:nr_throttled`, and `pids.events:max` counters for acceptance
  evidence. Process cleanup uses `cgroup.kill` and retries removal of the
  empty per-plugin cgroup. Nonfatal failed cleanup is an operational concern
  to instrument before general availability.
- `tier2-kernel-resource-limits.test.ts` covers membership parsing,
  bounded ceilings, and pre-exec Bubblewrap barrier argument generation.
  These tests do **not** claim real resource enforcement.
- `scripts/verify-tier2-kernel-quotas.mjs` runs **real** memory exhaustion,
  CPU throttling and PID exhaustion probes, each within a fresh cgroup and
  actual Bubblewrap namespace. It requires real kernel counter changes;
  an unsupported host or mock will **fail**, not skip.
- `.github/workflows/plugins-tier2-resource-acceptance.yml` is an explicit
  **manual** release gate on a secured Linux runner labeled
  `vibress-tier2-cgroup-v2` with delegated writable cgroup controllers.
  Generic GitHub-hosted runners lack this delegation by default; do not add
  privileged Docker, Docker socket mounts or a skip-as-success branch.
  Run `pnpm --filter @vibress/plugins build` then
  `node scripts/verify-tier2-kernel-quotas.mjs` on the properly delegated host.

**Still closed:** `verifyPlatformIsolationSupport("untrusted_marketplace")`
intentionally returns `isIsolated: false` until the **actual integrated
Supervisor -> cgroup -> Bubblewrap -> worker -> Host gateway** has passed
Linux acceptance and security review. A production-ready resource
controller alone is not proof of safe end-to-end plugin execution.

**Next gates:** real delegated-host acceptance, resource exhaustion including
file descriptors/stdout flooding and descendants, process-tree cleanup,
portable rootless Docker policies, Host-owned immutable artifacts and
cross-replica revocation/restart tests. No marketplace activation, SDK
publication or PR readiness change before these requirements are closed.


## M8.8 security closure — 2026-10-30 (implementation checkpoint)

**Not production-approved. The additional checks below deliberately do not
turn on the `untrusted_marketplace` trust tier.**

New defensive-in-depth checks:

1. **Mutable release source / TOCTOU:** for untrusted releases,
   `verifyReleaseIntegrity` now also requires an operator-owned, non-writable
   Linux directory tree and non-root API/Worker identity, including EVERY
   ancestor of the approved release path and all release files. Symlinks,
   linked files, non-regular files, and writable same-user publication volumes
   are rejected even if the manifest digest matched during an earlier check.
   This prevents the ordinary non-root Host identity from swapping files
   between verification and Bubblewrap's read-only bind. It does **not**
   establish immutability against a compromised root operator, removable
   mounts, or outside-the-Host changes; a final immutable artifact store and
   tested install-to-run lifecycle remain required.
2. **Durable admission / revocation contract:** `Tier2SandboxOptions` now
   accepts `loadMarketplaceAdmission` (a Host-provided async source). When
   marketplace code is eligible to execute, the Supervisor requires a lookup
   before each invocation. The Host approval carries a monotonic
   `policyRevision`; older, conflicting, missing, or invalid revisions are
   rejected, and refresh failures terminate associated worker processes.
   The provided callback must perform authoritative ownership/tenant checks
   and return a durable, trusted record — the plugin cannot supply one.
   There is NO production persistent provider connected yet. The in-memory
   `admitPlugin` map and optional callback signature alone are insufficient
   for immediate cross-replica revocation, live process interruption or
   atomic release rotation. Actual database-backed integration, fanout and
   adversarial two-replica tests remain **release blockers**.
3. **Output flooding:** stdout framing remains bounded; an untrusted worker
   is now retired after 8 MiB cumulative stdout IPC or 256 KiB stderr.
   Trusted operator workers retain prior compatibility behavior. This adds
   a bounded Host output policy but is not yet a Linux file-descriptor rlimit
   or a process CPU ceiling.
4. **Tests:** regression tests cover non-immutable artifact refusal, stale
   admission revision, conflicting policy, missing/foreign admission,
   detached caller snapshots and output-budget overflow.

**Still mandatory for sign-off:** actual delegated Linux cgroup acceptance
run on a correctly configured self-hosted runner, an end-to-end production
Supervisor + kernel cgroup + Bubblewrap + Host gateway acceptance with two
publications/actors, independently audited operator-owned immutable release
staging, real persisted authorization/revocation across replicas including
running processes, rootless Docker deployment and recovery drills, file
descriptor/excessive logging tests, and an independent security P0/P1 review.

Never label M8.8 complete or activate general marketplace execution solely
because the standard CI and Bubblewrap namespace workflows are green.


## M8.8 — PostgreSQL-backed release and publisher revocation (2026-10-30)

This section supersedes the preceding checkpoint's statement that no durable
admission repository exists. **The new storage adapter is implemented but
production Tier 2 integration and live process revocation remain OPEN.**

- Additive migrations `0049_plugin_marketplace_admissions.sql` and
  `0050_plugin_marketplace_publisher_revocations.sql` add versioned release
  approvals and persistent publisher-deny tombstones. Existing installations
  start with **zero admitted marketplace releases**: no backfill, activation
  or legacy trust promotion. Missing rows and tables deny execution.
- `DrizzleMarketplaceAdmissionRepository` validates the persisted JSONB
  with Zod, binds plugin ID, publication activation and plugin lifecycle in
  **one SQL snapshot**, and returns no grant for a foreign/disabled
  publication, revoked release or revoked publisher. Runtime DB failures
  propagate to Supervisor's fail-closed admission policy.
- Offline operator-only approval uses exact `policyRevision` compare-and-swap,
  a plugin-row lock, publisher advisory lock, publication activation checks,
  and an audit record in the same transaction. A revoked release **cannot
  be resurrected** through this API.
- Publisher revocation inserts an immutable deny tombstone and atomically
  advances/revokes all its current release approvals. Approval takes the
  same PostgreSQL transaction-level publisher lock, preventing an approval
  racing past a concurrent publisher ban. A new plugin ID is still denied
  after the old plugin has been removed.
- `createDurableMarketplaceTier2Supervisor` explicitly composes the DB
  loader into Supervisor. This is an **opt-in Host composition**, not an
  invitation to call an operator approval from an HTTP route or plugin.
  On a fresh process, the Supervisor may bootstrap ONLY from the DB; it
  checks the current revision after asynchronous lookup, rejects stale
  results, and rechecks authorization before each Host-mediated capability
  request. The old trusted-operator runtime remains unchanged.
- PostgreSQL tests use two separate clients with a disposable schema to
  exercise read-after-commit, publication isolation, revision conflicts,
  durable revocation, publisher bans, audit atomicity and corrupt JSON.
  They do **not** simulate two running Linux sandbox processes.

**Production blockers unchanged:** API/Worker currently use the trusted
external-plugin Host, not a validated end-to-end Tier 2 pathway. An
operator-authenticated, attestation-checked issuance workflow must be wired
to the DB repository (no new plugin/public HTTP approval API). Idle/live
sandbox processes need bounded-latency cross-replica interruption in addition
to per-request DB rechecks. The cgroup-v2 malicious workload workflow must
pass on an actually delegated Linux host; Docker, immutable release staging,
backup/restore, and independent P0/P1 security sign-off remain required.

The standard CI and Bubblewrap namespace acceptance are **not** authority
to mark the plugin platform or Marketplace general availability complete.
