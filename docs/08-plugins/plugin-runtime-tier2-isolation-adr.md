# ADR — Tier 2 untrusted plugin containment (design only)

**Status:** Proposed, **not implemented**. **Date:** 2026-10-24.
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

**M8 release blockers still open:**

1. Implement and independently test a bounded, authenticated IPC transport
   for an actual Vibress Node.js plugin worker inside Bubblewrap. Node's
   default `fork()` IPC must not be assumed to cross a non-Node launcher.
2. Bind the complete immutable, admitted release (all importable files,
   not merely a single optional entrypoint digest) to its Host-owned
   trust tier, signature, revocation and exact publication installation.
   Guard against modifications between verification and execution.
3. Prove real adversarial plugin lifecycle execution, direct filesystem
   access rejection, Host/private-network denial, cross-publication
   capability denial, malformed IPC, concurrent calls, crash recovery
   and release revocation inside the actual sandbox.
4. Enforce kernel/process resource quotas (memory, CPU, PIDs, open files,
   stdout/stderr and IPC throughput) and exercise fork-bombs and OOM
   scenarios without degrading API/Worker availability. V8 heap and
   timeouts alone are not enough.
5. Verify rootless Docker/self-hosted compatibility, immutable runner
   packaging, operator instructions, fresh install and upgrade behavior;
   publish an explicit allowlist/rollout procedure only after security
   acceptance. Avoid privileged Docker socket exposure.

**Operator procedure until these gates close:** Keep
`untrusted_marketplace` execution disabled. Operator-reviewed plugins
may continue through their existing explicitly trusted path; they are
**not** isolated from the Host as arbitrary adversarial code. Neither
the standalone Bubblewrap test nor green CI constitutes authorization
to enable public Marketplace execution.
