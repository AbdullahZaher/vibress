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
