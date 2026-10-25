# Plugin extensibility: current implementation and proposed platform

**Documentation status: historical milestone narrative (2026-10-22), supplemented by the active 2026-10-24 plan.**
PR #77, PR #78 and PR #86 are now merged into `main`; the platform is **not declared generally
supported for untrusted plugins** or complete for external SDK release.

## Active platform completion program (2026-10-24)

The [Plugin Platform Production Completion Plan](plugin-platform-production-plan.md) is the active, phased work plan for trusted distribution, explicit trust tiers, operator installation, upgrades, Studio UX and eventual SDK release. **LMS development is paused**; only plugin-platform compatibility work is in scope. PR #86 is merged in the current baseline, but its implementation is not a declaration that the external SDK or marketplace is production-ready.

## Native Admin UI Extensions — P1 design track (proposed 2026-10-25)

The [Native Admin UI implementation plan](native-admin-ui-plan.md), [draft Host-rendered UI RFC](native-admin-ui-rfc.md), and [security/compatibility acceptance matrix](native-admin-ui-security-compatibility.md) propose a versioned, declarative, Host-rendered plugin Admin experience using the existing Studio design system. These documents remain **design/release-review drafts**, but the development branch now contains a default-off, operator-pinned NUI-01/NUI-02 read-only API and Admin renderer candidate. The existing iframe/legacy path remains the default, and the SDK/plugin platform are **not** production-certified. LMS is a future validation pilot only if feature development is explicitly resumed; the active P0 plugin-platform and operator acceptance gates remain in force. The [NUI-00 architecture/security review](native-admin-ui-nui00-review.md) and [threat model](native-admin-ui-threat-model.md) record source-backed findings, compatibility risks and approval blockers; **NUI-00 has not received security/API/architecture sign-off**. The [decision record](native-admin-ui-decisions.md) and an **inactive, read-only NUI-01 SDK/schema prototype** are now present. On the development branch, a default-off, release-pinned Host admission endpoint and read-only renderer now exist; see the [operator runbook](native-admin-ui-rollout-runbook.md) and [developer guide](native-admin-ui-developer-guide.md). Existing iframe/legacy rendering remains the default; no runtime acceptance, production-ready SDK or passing CI is implied.

## P0-2 operator-trusted release catalog

The optional [v1 trusted release catalog metadata](operator-trusted-release-catalog.md) extends each entry in the existing operator lockfile without altering legacy entries. A release includes a digest-bound identity, publisher, exactly supported Host/SDK ABI, capability snapshot, and optional SHA-256-pinned local SBOM/provenance/migration-plan references. The preflight verifies their bytes before rollout; the metadata does **not** install code or approve migrations by itself.

## P0-4 installation lifecycle — initial increment

The Admin plugin listing now distinguishes registered/inactive/active, **stored site preferences versus effective activation**, transitions and failures. A Host ABI mismatch is shown explicitly; a failed activation offers a guarded retry after operator diagnosis, while a genuinely stuck transition requires isolated maintenance recovery. The operator catalog binds registration to a SHA-256 approval identity, preflights files at registration, and previews version/capability differences before an inactive-only update. **This is not an automatic hot update**: drain/deactivate the old version before replacing its signed lockfile and deploy the new immutable release through the operator runbook. Uninstall/purge, synchronized fleet update/rollback and real untrusted-plugin containment remain unimplemented.

## P0-3 operator staging and admission

The [secure operator release admission runbook](secure-operator-release-admission.md) describes the new signed, evidence-backed staging command, per-replica byte-identical receipts, isolated dependency scanning and migration-plan preflight. This path **does not** enable ZIP/GitHub installation from Studio, automatically install packages, run SQL, or make trusted Node modules safe for untrusted publishers.

## Security remediation status (2026-10-24)

See [the scoped security closure register](plugin-security-closure-20261024.md) for verified code changes and remaining required execution checks. No unit tests, typecheck, Docker drills or CI runs have been executed for this branch at the time of the register. The Host/DB now reject pinned updates while active, and the DB enforces a conditional write so activation cannot race a metadata update. See the [Tier 2 runtime isolation ADR](plugin-runtime-tier2-isolation-adr.md) for the untrusted plugin boundary. Do not infer production certification from code/test additions.

## Architecture decision

**Approved for implementation direction, not shipped:** [RFC review/approval record](EXTENSION_RFC_APPROVAL.md) and [accepted architecture ADR](../adr/2026-10-19-external-extension-host-vnext.md). Conceptual API examples remain unimplemented; production release and SDK contract freeze require the gates below.

## Implemented extension milestones (October 2026)

The roadmap documents the complete target. EXT-201 through EXT-204 have been
merged; [EXT-301A](extension-admin-views-ext301a.md) is a **partial**
Host-owned, read-only Studio navigation/view implementation. The proposed
[EXT-301B1](extension-admin-views-ext301b1.md) adds only operator-pinned
Admin UI asset verification; [EXT-301B2A](extension-admin-views-ext301b2.md)
adds Staff/publication-authorized inert JSON delivery; the EXT-301B2B increment
introduces an opaque-origin, single-file iframe with single-use Redis tickets,
strict CSP and a private **read-only** linked-GET MessagePort. These early milestones
had no write bridge; later merged PR #78 added a narrowly Host-confirmed linked
write flow, **not** an arbitrary privileged API proxy. This is **not** a general executable Admin
UI platform or a declaration of extension platform release readiness.
The proposed [EXT-302A public SSR dispatcher](extension-public-views-ext302a.md)
adds opt-in, Host-authorized and text-only public extension pages; member-private
views, published hreflang and full theme slots are still separate release gates.
The historical baseline below describes the 2026-10-19 design review.

## Merged operator-trusted increments (PR #77)

PR #77 merged into `main` the following increments:
published-only extension locales and SEO ([EXT-302B](extension-public-views-ext302a.md)),
a Host-owned `extension` theme slot with safe fallback
([sample Liquid template](examples/extension.liquid)),
an independent [SDK reference plugin](../../examples/plugins/hello-public/README.md),
and an operator-side [release preflight / recovery runbook](external-extension-operator-runbook.md).
The merged implementation also adds optional **detached Ed25519 operator lockfile approval**,
with shared runtime/CLI signature verification, pre-listen API preflight,
a production-bundled verifier, and an opt-in `compose.plugins.yml`
read-only deployment override. Unsigned trusted v1 lockfiles still work when
both signing environment variables are absent; signed mode fails closed if
only one is configured. This is operator trust, not an untrusted plugin sandbox.

These features are **merged**, but still not frozen as a supported
external plugin SDK. EXT-401 now has
PostgreSQL-backed operator-only event admission with an immutable scoped
deduplication ledger, crash-claim reconciliation, BullMQ delivery and release
checks. Domain-event outbox integration, full operator
restore/recovery and duplicate-delivery acceptance drills remain pending.
The native Admin Plugins panel now includes an operator-gated, publication-scoped
failed-event view with explicit second-step replay confirmation. Host-authenticated, publication-scoped failed
job inspection and explicitly confirmed BullMQ replay now record the
operator's replay request in PostgreSQL before retrying. Replay remains
at-least-once and must not be presented as exactly-once. EXT-402 now also supports explicit, atomic and
audited per-publication secret deletion. Cryptographic master-key rotation
and operator audit views remain separate blockers.
EXT-403 now has a read-only, paginated post-restore database/artifact
compatibility preflight, but coordinated backup/restore automation remains a
blocker. EXT-404 adds queue/consumer health metrics, but further supply-chain
scanning, a full EXT-301 Admin write/UI host contract,
cross-replica/incident acceptance and EXT-501–504 pilot gates remain blockers.
The opt-in production Compose override requires operator release signatures.
Do not infer production readiness from CI alone.

**Later merged increments:** PR #78 added the confirmed linked-route Admin write
bridge (EXT-301C) with direct Admin POST permission restrictions while
preserving the read-only bridge. PR #86 added Host-mediated member/public
read-only storage wiring; check the current Host contracts before concluding
that a specific plugin can use those capabilities. The independent
`vibress-lms` integration is still a pilot, and LMS feature work is paused.

See [external SDK release gates](external-sdk-release-gates.md) for the
operational test matrix and blockers that prevent announcing a stable SDK.

## Read in this order

1. [External extensions architecture](external-extensions-architecture.md) — production trust boundary, service ownership, lifecycle, tenant model, deployment.
2. [Extension contracts (proposed v1)](external-extensions-contracts.md) — versioned illustrative manifests, APIs, routes, UI slots, data and capability definitions.
3. [Extension security and operations](external-extensions-security-operations.md) — threats, releases, migration, rollback, observability, fail-closed behavior.
4. [Implementation roadmap](external-extensions-roadmap.md) — tickets, dependencies, gates, acceptance criteria and pilot.
5. [SDK compatibility and adapter](external-extensions-sdk-compatibility.md) — resolve the two existing plugin interfaces and preserve v1.
6. [Principal scope and typed data](external-extensions-identity-data.md) — publication-bound sessions, old settings migration and storage.
7. [Package integrity, UI and worker runtime](external-extensions-package-and-ui.md) — detached release checksums, dynamic surface limitations and lifecycle.
8. [Typed storage and runtime validation contract](external-extensions-storage-contract.md) — concrete host-mediated, schema-bound data API design.
9. [Current plugin system](plugin-system.md) and [current SDK](plugin-sdk.md) — existing functionality, **not** complete external installation support.

### Known baseline (verified from `main` on 2026-10-19)

- `apps/api/src/plugins/plugin-host.ts` contains a hard-coded trusted module registry; registering a manifest does **not** install executable code.
- `packages/plugin-sdk/src/index.ts` exports `PluginManifest`, `PluginContext`, `PluginModule` and capability declarations; no production route, admin component, data migration, or render-registration APIs exist.
- `packages/domains/plugins/src/application/plugins-service.ts` provides registration, activation, settings and partial hook dispatch; it does not implement a generalized extension router or complete per-publication installation model.
- `packages/database/src/schema/platform.ts` stores plugins/settings at platform scope without publication-scoped settings.
- `apps/api/src/routes/platform.ts` protects management endpoints with staff auth, `plugins.read/manage` and origin validation, but generic request shapes need shared runtime schemas.
- `packages/plugin-core/src/extension-host.ts` simulates an envelope; it is **not** an isolated execution process. The deprecated `node:vm` path is not a sandbox. Moreover `packages/plugin-core/src/index.ts` defines an **alternate** `VibressPlugin` contract with different lifecycle method and context shapes; it is not interchangeable with `@vibress/plugin-sdk`.
- Existing documentation/examples contain conflicting historical API and sandbox claims: reconcile them before presenting a stable external developer SDK.

### Scope and policy

Trusted, operator-installed packages are **phase 1**. In-browser ZIP upload, runtime npm execution, an untrusted marketplace and sandbox claims are **not** supported. Implementation requires an explicit ADR; nothing here changes the accepted [plugin trust model](../14-decisions/plugin-trust-model.md).

### Reference pilot

The private `AbdullahZaher/vibress-lms` repository is the proposed integration/acceptance pilot. The goal is a fully separate codebase that adds a course catalog, one protected lesson, authenticated enrollment and admin management **without deep imports or edits to Vibress core for the individual plugin**.

### Maintaining these documents

- Change a contract with an ADR, compatibility review, migration plan, changelog and consumer tests.
- Keep `Current` versus `Proposed` labels honest; replace them only after code and tests land on `main`.
- Do not treat planning estimates as committed dates or claim release readiness based on documentation alone.
