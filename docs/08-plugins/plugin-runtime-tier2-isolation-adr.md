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
