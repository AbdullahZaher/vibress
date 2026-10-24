# M0 — Plugin compatibility and execution-boundary inventory

**Recorded:** 2026-10-24. **Source:** execution branch at \`45480f3d758acf94976555c63d84d366f9b3f53a\`; master plan \`plugin-platform-master-execution-plan.md\`.
**State:** implementation inventory; **not** an ABI freeze, complete third-party ecosystem inventory, operational sign-off, or production certification.

## Source-linked matrix

| Surface / owner | Verified code or persistent artifact | Compatibility rule and remaining evidence |
| --- | --- | --- |
| Canonical SDK | [\`packages/plugin-sdk/src/index.ts\`](../../packages/plugin-sdk/src/index.ts), [package.json](../../packages/plugin-sdk/package.json) | \`PluginModule.activate(context)\`, optional \`deactivate()\` and \`onEvent(name,payload,context?)\`; \`SDK_VERSION = "1.0.0"\` is the runtime ABI, **not** package semver \`1.2.0\`. Package remains private. Do not publish pending independent conformance. |
| Alternate legacy contract | [\`packages/plugin-core/src/index.ts\`](../../packages/plugin-core/src/index.ts), [package.json](../../packages/plugin-core/package.json) | \`VibressPlugin.onActivate/onDeactivate/onEvent\` takes a distinct context/manifest and logger; never auto-load it as canonical SDK v1. \`plugin-core/src/sandbox.ts\` is **not isolation**. External consumer count is not proven; preserve exports and inventory before an adapter. |
| Trusted module loaders | [bundled Host](../../apps/api/src/plugins/plugin-host.ts), [operator Host](../../apps/api/src/plugins/trusted-external-plugin-host.ts), [operator preflight](../../apps/api/src/plugins/operator-release-preflight.ts), [attestation](../../apps/api/src/plugins/trusted-release-attestation.ts) | Operator-pinned signed and legacy permitted profiles remain distinct; exact digest/admission must be checked before runtime loading. In-process ESM has Node privileges. |
| Domain lifecycle and storage | [service](../../packages/domains/plugins/src/application/plugins-service.ts), [repositories](../../packages/domains/plugins/src/infrastructure/drizzle-plugin-repositories.ts), [scoped storage](../../packages/domains/plugins/src/application/plugin-scoped-storage.ts), [migration ledger](../../packages/domains/plugins/src/application/plugin-storage-migrations.ts) | Separate global registration/activation from publication preference and effective enablement. Preserve CAS, error states, settings and previously admitted migration revisions. |
| Database state | [installation schema](../../packages/database/src/schema/installation.ts), [plugin events](../../packages/database/src/schema/plugin-events.ts), [migration 0040](../../packages/database/migrations/0040_plugin_publication_states.sql), [0041](../../packages/database/migrations/0041_plugin_publication_settings.sql), [0042](../../packages/database/migrations/0042_plugin_migration_storage_foundation.sql), [0043](../../packages/database/migrations/0043_plugin_storage_physical_models.sql), [0044](../../packages/database/migrations/0044_plugin_event_receipts.sql), [0045](../../packages/database/migrations/0045_plugin_member_records.sql) | Existing installations and persisted plugin data are upgrade contracts. Never rewrite released migrations or auto-copy historical global secrets into publications. |
| Admin APIs & permissions | [Admin routes](../../apps/api/src/routes/admin.ts), [plugin event routes](../../apps/api/src/routes/plugin-events.ts), [extension routes](../../apps/api/src/routes/extension-api.ts), [shared runtime contracts](../../packages/api-contracts/src/plugins.ts) | Server-side Staff session, plugins permissions, global operator role and authoritative publication context; origin validation on mutations. Do not infer authorization from an ID or UI role flag. |
| Admin UI | [plugins page](../../apps/admin/src/components/platform/PluginsPage.tsx), [installed panel](../../apps/admin/src/components/platform/PluginsPanel.tsx), [trusted registration](../../apps/admin/src/components/platform/TrustedPluginInstaller.tsx), [failed events](../../apps/admin/src/components/platform/FailedPluginEventsPanel.tsx), [locale](../../apps/admin/src/lib/admin-locale.tsx) | Preserve route and lifecycle actions; no ZIP/URL direct-install; Arabic/RTL and accessible states. Installed and approved are different datasets and permissions. |
| Events / queue | [receipt ledger](../../packages/domains/plugins/src/application/plugin-event-ledger.ts), [API admission](../../apps/api/src/plugins/plugin-event-queue.ts), [worker](../../apps/worker/src/processors/plugin-event-worker.ts), [worker queue bridge](../../apps/api/src/plugins/plugin-event-recovery.ts), [core outbox](../../packages/events/src/event-writer.ts) | Existing plugin receipt ledger + Redis relay and the **separate** core domain-event outbox must be assessed, not accidentally conflated. Durable admission is not proof of exactly-once external side effects. Retire stale digest/publication jobs. |
| Public Web and theme | [public extension routes](../../apps/web/src/app/extensions), [public client](../../apps/web/src/lib/public-extension-client.ts), [theme environment](../../apps/web/src/lib/theme-renderer-environment.ts), [theme core](../../packages/theme-core/src/index.ts), [public API](../../apps/api/src/routes/extension-public-views.ts) | Preserve SSR privacy, locale policy, canonical SEO, sanitized theme models and extension route namespace. Validate at least two themes and Arabic + English externally. |
| Independent examples | [SDK example](../developer/examples/sample-plugin), [developer SDK docs](../developer/plugin-sdk.md) | Examples are not proof of a published standalone SDK; compile from an external consumer without private monorepo imports before SDK freeze. |
| Operator/runtime | [admission script](../../scripts/plugins/admit.ts), [restore checker](../../scripts/plugins/check-restore.ts), [event recovery check](../../scripts/plugins/check-queue-recovery.ts), [runbook](secure-operator-release-admission.md) | Same immutable signed artifacts across API/Worker replicas; operator-owned private keys outside runtimes; real restore/quiescence drills required. |
| LMS compatibility only | [external consumer requirement](external-sdk-release-gates.md) | LMS development paused. Run conformance/fixtures without modifying course, enrollment or lesson business logic. |

## Contract decisions and dependency order (PLUG-BASE-03)

1. **Canonical runtime:** \`@vibress/plugin-sdk\` ABI \`1.0.0\`; preserve legacy \`plugin-core\` until documented consumer decision. Distinguish SDK package semver, Host ABI, artifact \`releaseId\`, exact SHA-256, publisher and revocation state. Reject unknown or mixed protocols instead of guessing.
2. **Tier 1:** operator-trusted pinned ESM, operator permission to register/activate, publication Staff permission to enable only admitted releases. Trusted Node.js execution is not sandboxed. Legacy unsigned operation remains available unless the operator explicitly enables strict admission.
3. **Tier 2:** independent OS-enforced runtime and authenticated Host mediation required before untrusted execution. Publisher identity, catalog discovery or a valid signature does not grant executable authority.
4. **Release/revocation:** immutable signed artifact and separate trusted signer roots; an updated/revoked digest must invalidate admission and pending jobs. Define signer rotation and fleet fencing before rolling release promotion (M1A/M2).
5. **Deprecation:** additive versioned contracts, release notes and positive/negative consumer conformance before removing a supported legacy path. No SDK stable publication while independent consumer acceptance is pending.

## Reproducible inventory refresh (PLUG-BASE-01)

Run from a clean checkout at the evidence SHA; retain full output and review matches (including tests, scripts, docs and third-party examples):

- \`rg -n -F -e '@vibress/plugin-sdk' -e '@vibress/plugin-core' -e 'plugin-core/src' -e 'VibressPlugin' apps packages scripts docs\`
- \`rg -n -F -e 'PluginModule' -e 'SDK_VERSION' -e 'vibressApiVersion' apps packages scripts docs\`
- \`rg -n -F -e 'plugins.read' -e 'plugins.manage' -e 'register-trusted' apps packages\`
- \`rg -n -F -e 'pluginEventLedger' -e 'PLUGIN_EVENTS' -e 'extension' apps/worker apps/web packages/events packages/theme-core\`

Classify each hit **active runtime / independent consumer / test-only / historical document**. The GitHub code search index returned no matching entries during this review, so **completeness of imports is unverified**; do not assert zero external legacy consumers. Preserve the original inventory output with the first CI evidence upload.

## Existing documentation reconciliation (PLUG-BASE-02)

- [Master tracker](plugin-platform-master-execution-plan.md) is authoritative for **sequence and evidence level**.
- [Production plan](plugin-platform-production-plan.md), [implementation status](external-extensions-implementation-status.md), [external roadmap](external-extensions-roadmap.md) and [SDK RFC](external-extensions-sdk-compatibility.md) describe historic snapshots and contracts. Their dated “in progress” rows do **not** override newer verified code.
- [Security closure](plugin-security-closure-20261024.md) identifies code fixes but **not** independent scanner authenticity proof, cluster rollout or full DR.
- [Tier 2 ADR](plugin-runtime-tier2-isolation-adr.md) is design-only. Marketplace execution remains prohibited until independent security certification.

**Review hold points:** re-run comprehensive consumer scan locally; get architecture/security/plugin-theme ownership approval; validate complete source-linked inventory against fresh and upgraded deploys. M0 is not “Operationally Accepted” by writing this document.
