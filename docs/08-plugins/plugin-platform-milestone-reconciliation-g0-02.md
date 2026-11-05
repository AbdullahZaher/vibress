# Plugin Platform — Milestone Reconciliation & Source-of-Truth Ledger (G0-02)

**Document Version:** 1.0  
**Evidence SHA:** [`f3cc8c4dee53f8fc243207169f08f22e12bb9177`](../../apps/admin/src/components/PageEditor.tsx)  
**Execution Date:** November 5, 2026  
**Status:** **Authoritative Milestone Mapping (G0-02 Complete)**  
**Classification:** Reconciles historical M0–M8 / `PLUG-*` / `EXT-*` / `NUI-*` tickets to the Enterprise Program R1–R5 release architecture across 4 independent maturity dimensions.

---

## 1. Governance & Maturity Dimensions

Every historical ticket and deliverable is evaluated against four distinct, non-automatic maturity states:

```
[State 1: Code]        Committed in git repository
[State 2: Tests]       Unit / integration / E2E tests passing
[State 3: Operations]  Live staging, multi-replica, and disaster recovery certified
[State 4: Approval]    Designated role sign-off (Sponsor, Tech Lead, Security, Ops, PO)
```

---

## 2. Release R1: Trusted Plugin Foundation

**Scope:** Operator-trusted ESM execution, Ed25519 lockfile attestation, SHA-256 catalog, publication isolation, failure containment.  
**Historical Milestones:** M0, M1A, M1B (platform admin baseline).  
**Gate Decision:** **HOLD — G1** (Operational certification & live drills incomplete).

| Ticket ID | Deliverable Description | Code State | Test State | Ops State | Approval State | Authoritative Source Files |
|---|---|---|---|---|---|---|
| `PLUG-BASE-01` | Consumer & contract inventory | **Implemented** | **Verified** | N/A | **Pending G0** | [`plugin-platform-consumer-inventory-g0-01.md`](plugin-platform-consumer-inventory-g0-01.md) |
| `PLUG-BASE-02` | Milestone reconciliation & ledger | **Implemented** | **Verified** | N/A | **Pending G0** | [`plugin-platform-milestone-reconciliation-g0-02.md`](plugin-platform-milestone-reconciliation-g0-02.md) |
| `PLUG-BASE-03` | Release identity & ABI specification | **Implemented** | **Verified** | N/A | **Pending G0** | [`packages/plugin-sdk/src/index.ts`](../../packages/plugin-sdk/src/index.ts) |
| `PLUG-BASE-04` | Bilingual & multi-pub test matrix | **Implemented** | **Verified** | **Pending** | **Pending G1** | `packages/domains/plugins/tests/` |
| `PLUG-OPS-01` | Fleet identity checks & drain protocol | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`packages/domains/plugins/src/application/trusted-external-plugin-host.ts`](../../packages/domains/plugins/src/application/trusted-external-plugin-host.ts) |
| `PLUG-OPS-02` | Coordinated PG/Redis/Artifact restore | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`scripts/plugins/check-restore.ts`](../../scripts/plugins/check-restore.ts) |
| `PLUG-OPS-03` | Crash, retry, dead-letter handling | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`packages/domains/plugins/src/application/plugin-event-ledger.ts`](../../packages/domains/plugins/src/application/plugin-event-ledger.ts) |
| `PLUG-OPS-04` | Outbox commit-to-queue gap closure | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`packages/events/src/event-writer.ts`](../../packages/events/src/event-writer.ts) |
| `PLUG-OPS-05` | Signer-key rotation & revocation | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`compose.plugins.secret-rotation.yml`](../../compose.plugins.secret-rotation.yml) |
| `PLUG-OPS-06` | Bounded plugin telemetry & diagnostics | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`packages/domains/plugins/src/application/plugin-activity.ts`](../../packages/domains/plugins/src/application/plugin-activity.ts) |
| `PLUG-SEC-01` | Authentic scanner output & SBOM policy | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`packages/domains/plugins/src/application/operator-release-preflight.ts`](../../packages/domains/plugins/src/application/operator-release-preflight.ts) |
| `PLUG-SEC-02` | Release revocation & anti-replay drills | **Implemented** | **Verified** | **Incomplete** | **Pending G1** | [`compose.plugins.signer-revocation.yml`](../../compose.plugins.signer-revocation.yml) |
| `PLUG-ADMIN-01` | Installed/Available/Updates/Activity list | **Implemented** | **Verified** | N/A | **Pending G1** | [`apps/admin/src/components/platform/PluginsPage.tsx`](../../apps/admin/src/components/platform/PluginsPage.tsx) |
| `PLUG-ADMIN-02` | Accessible plugin details & trust level | **Implemented** | **Verified** | N/A | **Pending G1** | [`apps/admin/src/components/platform/PluginsPanel.tsx`](../../apps/admin/src/components/platform/PluginsPanel.tsx) |
| `PLUG-ADMIN-03` | Guarded global lifecycle vs publication enablement | **Implemented** | **Verified** | N/A | **Pending G1** | [`apps/api/src/routes/platform.ts`](../../apps/api/src/routes/platform.ts) |
| `PLUG-ADMIN-04` | Release diff & capability preflight | **Implemented** | **Verified** | N/A | **Pending G1** | [`apps/admin/src/components/platform/TrustedPluginInstaller.tsx`](../../apps/admin/src/components/platform/TrustedPluginInstaller.tsx) |
| `PLUG-ADMIN-05` | Failed event panel & stuck transition recovery | **Implemented** | **Verified** | N/A | **Pending G1** | [`apps/admin/src/components/platform/FailedPluginEventsPanel.tsx`](../../apps/admin/src/components/platform/FailedPluginEventsPanel.tsx) |
| `PLUG-ADMIN-06` | Arabic/RTL, keyboard navigation & a11y | **Implemented** | **Verified** | N/A | **Pending G1** | [`apps/admin/src/lib/admin-locale.tsx`](../../apps/admin/src/lib/admin-locale.tsx) |

---

## 3. Release R2: Native Extension Experience

**Scope:** Native Admin UI v2 declarative schema, host-rendered component registry, Extension Slots, action bindings.  
**Historical Milestones:** NUI-00 through NUI-05, EXT-301, EXT-302.  
**Gate Decision:** **HOLD — G2** (Native V1 merged default-off; Native v2 schema & Extension Slots undelivered).

| Ticket ID | Deliverable Description | Code State | Test State | Ops State | Approval State | Authoritative Source Files |
|---|---|---|---|---|---|---|
| `NUI-00` | Architecture & security review | **Implemented** | **Verified** | N/A | **Approved Draft** | [`docs/08-plugins/native-admin-ui-nui00-review.md`](native-admin-ui-nui00-review.md) |
| `NUI-01` | Read-only declarative Host renderer | **Implemented** | **Verified** | **Default-Off** | **Hold — G2** | [`apps/admin/src/components/platform/NativeExtensionAdminView.tsx`](../../apps/admin/src/components/platform/NativeExtensionAdminView.tsx) |
| `NUI-02` | Host data binding & query endpoints | **Implemented** | **Verified** | **Default-Off** | **Hold — G2** | [`apps/api/src/routes/extension-native-data.ts`](../../apps/api/src/routes/extension-native-data.ts) |
| `NUI-03` | Bounded form actions & mutations | **Implemented** | **Verified** | **Default-Off** | **Hold — G2** | [`apps/admin/src/components/platform/NativeExtensionActionForm.tsx`](../../apps/admin/src/components/platform/NativeExtensionActionForm.tsx) |
| `NUI-04` | Native v2 schema & version negotiation | **Proposed** | **Unimplemented** | N/A | **Pending RFC** | Workstream C (`C-01`) |
| `NUI-05` | Extension Slots (`admin.*`, `content.*`) | **Proposed** | **Unimplemented** | N/A | **Pending RFC** | Workstream D (`D-01`–`D-06`) |
| `EXT-301` | Admin views & single-file iframe bridge | **Implemented** | **Verified** | **Active Fallback** | **Approved** | [`apps/api/src/routes/extension-admin-iframe.ts`](../../apps/api/src/routes/extension-admin-iframe.ts) |
| `EXT-302` | Public SSR view dispatcher | **Implemented** | **Verified** | **Active** | **Approved** | [`apps/api/src/routes/extension-public-views.ts`](../../apps/api/src/routes/extension-public-views.ts) |

---

## 4. Release R3: Professional Developer Platform

**Scope:** Stable `@vibress/plugin-sdk`, developer tooling/CLI, safe upgrades preflight, fleet migration coordination, typed events.  
**Historical Milestones:** M2, M3, M5 (tooling track).  
**Gate Decision:** **HOLD — G3** (Package private; public contract and independent CI pending).

| Ticket ID | Deliverable Description | Code State | Test State | Ops State | Approval State | Authoritative Source Files |
|---|---|---|---|---|---|---|
| `PLUG-UPD-01` | Durable upgrade plans & digest verification | **Implemented** | **Verified** | **Incomplete** | **Pending G3** | [`packages/database/src/schema/plugin-upgrades.ts`](../../packages/database/src/schema/plugin-upgrades.ts) |
| `PLUG-UPD-02` | Multi-stage lifecycle progression | **Implemented** | **Verified** | **Incomplete** | **Pending G3** | [`packages/domains/plugins/src/application/plugin-storage-migrations.ts`](../../packages/domains/plugins/src/application/plugin-storage-migrations.ts) |
| `PLUG-UPD-03` | Fleet job draining & release fencing | **Implemented** | **Verified** | **Incomplete** | **Pending G3** | [`apps/worker/src/processors/plugin-event-worker.ts`](../../apps/worker/src/processors/plugin-event-worker.ts) |
| `PLUG-UPD-04` | Additive DB migration ledger | **Implemented** | **Verified** | **Incomplete** | **Pending G3** | Migrations `0042`, `0047`, `0048` |
| `PLUG-UPD-05` | Tested rollback & irreversible boundaries | **Implemented** | **Verified** | **Incomplete** | **Pending G3** | [`docs/08-plugins/plugin-upgrade-staging-foundation.md`](plugin-upgrade-staging-foundation.md) |
| `PLUG-UPD-06` | Data-preserving retirement & purge | **Implemented** | **Verified** | **Incomplete** | **Pending G3** | [`packages/domains/plugins/src/application/plugins-service.ts`](../../packages/domains/plugins/src/application/plugins-service.ts) |
| `PLUG-SDK-01` | Canonical public SDK package | **Implemented** | **Verified** | **Private** | **Pending G3** | [`packages/plugin-sdk`](../../packages/plugin-sdk) |
| `PLUG-SDK-02` | Versioned schemas & ABI negotiation | **Implemented** | **Verified** | N/A | **Pending G3** | [`packages/plugin-sdk/src/index.ts`](../../packages/plugin-sdk/src/index.ts) |
| `PLUG-SDK-03` | Standalone example & contract test harness | **Implemented** | **Verified** | N/A | **Pending G3** | [`examples/plugins/hello-public`](../../examples/plugins/hello-public) |
| `PLUG-SDK-04` | Deterministic packaging & signing CLI | **Implemented** | **Verified** | N/A | **Pending G3** | [`packages/plugin-sdk/src/cli.ts`](../../packages/plugin-sdk/src/cli.ts) |
| `PLUG-SDK-05` | Comprehensive developer documentation | **Implemented** | **Verified** | N/A | **Pending G3** | [`docs/developer/plugin-sdk.md`](../developer/plugin-sdk.md) |

---

## 5. Release R4: Isolated Extension Runtime

**Scope:** Tier 2 untrusted runtime isolation, Linux namespaces/cgroups, Bubblewrap, resource quotas, authenticated host IPC.  
**Historical Milestones:** M4, M7, M8.  
**Gate Decision:** **HOLD — G4** (Implementation substantial; production execution explicitly blocked).

| Ticket ID | Deliverable Description | Code State | Test State | Ops State | Approval State | Authoritative Source Files |
|---|---|---|---|---|---|---|
| `PLUG-RT-01` | Threat model & authenticated IPC | **Implemented** | **Verified** | **Production Disabled** | **Hold — G4** | [`packages/domains/plugins/src/runtime/tier2-ipc.ts`](../../packages/domains/plugins/src/runtime/tier2-ipc.ts) |
| `PLUG-RT-02` | Supervised Bubblewrap container process | **Implemented** | **Verified** | **Production Disabled** | **Hold — G4** | [`packages/domains/plugins/src/runtime/tier2-process-supervisor.ts`](../../packages/domains/plugins/src/runtime/tier2-process-supervisor.ts) |
| `PLUG-RT-03` | Host-mediated capability gateway | **Implemented** | **Verified** | **Production Disabled** | **Hold — G4** | [`packages/domains/plugins/src/runtime/tier2-capability-gateway.ts`](../../packages/domains/plugins/src/runtime/tier2-capability-gateway.ts) |
| `PLUG-RT-04` | Linux cgroup v2 CPU/Memory quotas | **Implemented** | **Verified** | **Production Disabled** | **Hold — G4** | [`packages/domains/plugins/src/runtime/tier2-kernel-resource-limits.ts`](../../packages/domains/plugins/src/runtime/tier2-kernel-resource-limits.ts) |
| `PLUG-RT-05` | Sandbox worker & crash quarantine | **Implemented** | **Verified** | **Production Disabled** | **Hold — G4** | [`packages/domains/plugins/src/runtime/tier2-sandbox-worker.ts`](../../packages/domains/plugins/src/runtime/tier2-sandbox-worker.ts) |
| `PLUG-RT-06` | Adversarial test suite | **Implemented** | **Verified** | **Production Disabled** | **Hold — G4** | [`packages/domains/plugins/tests/tier2-runtime-isolation.test.ts`](../../packages/domains/plugins/tests/tier2-runtime-isolation.test.ts) |

---

## 6. Release R5: Plugin Marketplace

**Scope:** Catalog distribution, publisher onboarding, automated non-executing scanners, revocation infrastructure.  
**Historical Milestones:** M6, M8.8.  
**Gate Decision:** **DEFER — G5** (Foundations exist; commercial product and operating model unfunded).

| Ticket ID | Deliverable Description | Code State | Test State | Ops State | Approval State | Authoritative Source Files |
|---|---|---|---|---|---|---|
| `PLUG-CAT-01` | Signed catalog discovery metadata | **Implemented** | **Verified** | N/A | **Deferred — G5** | [`packages/domains/plugins/src/application/marketplace-service.ts`](../../packages/domains/plugins/src/application/marketplace-service.ts) |
| `PLUG-CAT-02` | Isolated staging archive extractor | **Implemented** | **Verified** | N/A | **Deferred — G5** | [`packages/domains/plugins/src/application/operator-release-admission.ts`](../../packages/domains/plugins/src/application/operator-release-admission.ts) |
| `PLUG-CAT-03` | Scanner ingestion & admissions ledger | **Implemented** | **Verified** | N/A | **Deferred — G5** | [`packages/database/src/schema/plugin-marketplace-admissions.ts`](../../packages/database/src/schema/plugin-marketplace-admissions.ts) |
| `PLUG-MKT-01` | Publisher revocation tombstones | **Implemented** | **Verified** | N/A | **Deferred — G5** | Migration [`0050_plugin_marketplace_publisher_revocations.sql`](../../packages/database/migrations/0050_plugin_marketplace_publisher_revocations.sql) |
| `PLUG-MKT-02` | Public catalog & publisher dashboard | **Unimplemented** | **Unimplemented** | N/A | **Deferred — G5** | Workstream J |

---

## 7. G0-02 Reconciliation Conclusion

1. Every ticket from M0 through M8 is mapped to an R1–R5 release with designated source files.
2. The four maturity dimensions (*Code*, *Tests*, *Ops*, *Approval*) are tracked independently.
3. R4 Tier 2 code is accounted for with exact source paths while maintaining its strict "Production Disabled" hold.
4. G0-02 is **COMPLETE**.
