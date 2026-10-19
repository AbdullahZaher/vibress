# External extension host — implementation status

**Branch:** `feat/external-extension-host-foundation-20261019`  
**Status:** **FOUNDATION IN PROGRESS — NOT PRODUCTION READY.** The accepted [RFC](EXTENSION_RFC_APPROVAL.md) is still the design target. This record must not be mistaken for CI/test evidence.

## Implemented in this branch (pending runtime tests)

- Optional operator-controlled trusted ESM lockfile with final-entrypoint SHA-256 and verified-byte evaluation, strict relative path restrictions, no dynamic Admin ZIP/npm upload, and exact manifest metadata matching. No in-process sandboxing.
- Trusted package discovery/registration from the Admin plugins panel; no registration of external manifests outside the operator lockfile. Bundled official v1 plugin continues by default.
- Actual lifecycle `activate/deactivate`; explicit named `dispatchEvent` with capability, status, publication checks, and optional scoped SDK context. Legacy `executeHook` remains, but is not a complete worker event bus.
- Additive `0040` publication activation and `0041` encrypted publication settings migrations, no global secret backfill. DB owner FK and unique scope constraints, plus non-destructive uninstall gate.
- Staff-only publication enablement and scoped settings APIs guarded with `requireStaffSession`, `requirePermission`, `validateOrigin` for writes, Zod contracts and authoritative staff publication context.
- Admin panel has per-site enabling, plugin discovery, masked per-publication string/secret settings, Arabic translations and accessible labels. Stale settings responses are discarded on site switch; relevant tests have been **added**, not executed.

## Important limitations and verification gaps

| Requirement | Current status / blocker |
| --- | --- |
| Core EXT-001/002/003/004 | Partial; canonical ABI and scoped settings added, but no complete plugin-core consumer adapter/signoff |
| EXT-101 trusted release | **Partial:** operator-pinned single-file ESM only; no multi-file archive provenance, reproducible release attestation or multi-node rollout verification |
| EXT-102/103/104 | Partial lifecycle + publication state; lacks tested concurrency/drain/upgrade recovery; legacy callbacks still require compatibility CI |
| EXT-201/202 | **Missing:** generic host-registered Admin/Member/Public extension API, member-publication binding and plugin permission descriptors |
| EXT-203 | **Missing:** plugin-owned relational repositories, schema migration ledger, composite course FK/storage contracts; settings rows alone do not supply this |
| EXT-301/302/303/304 | **Missing:** plugin-provided isolated Studio views, Next.js public dispatcher, Liquid/theme contracts and external sample conformance |
| EXT-401/402/403/404 | Scoped secrets **partial**; missing generic versioned Worker resolver/outbox, backups/restore exercise, revocation/rotation policy, operator audit and release hardening |
| EXT-501..504 | **Missing:** independent LMS integration pilot, all cross-publication/RTL/upgrade E2E and public SDK freeze |

## Production hold points

1. Run `pnpm typecheck`, `pnpm lint`, focused Vitest tests, all necessary DB migration tests, integration tests and CI after a reviewer-authorized PR; no results are claimed here.
2. Verify fresh and populated PostgreSQL upgrades through 0040/0041, checksum mismatch/recovery, concurrency, disabled-state and tenant-denial behavior.
3. Define and implement generic host-managed route registration and scoped plugin data API before integrating LMS; never use private core imports in external packages.
4. Test Docker Compose override in actual API runtime; verify external plugin ESM behavior under the supported Node version and replicas.
5. Confirm themes, Arabic/RTL, WCAG keyboard/focus, privacy/SEO, fail-closed behavior and no regression for existing bundled plugins.

**Architecture note:** Any installed trusted JavaScript runs with API-process privileges; `hasCapability` checks only mediated host operations and does not stop a malicious extension from reading Node process state. Operator must vet packages. Separate supervised process/container isolation remains a future ADR.
