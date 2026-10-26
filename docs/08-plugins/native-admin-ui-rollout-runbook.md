# Native Admin UI — Operator Rollout and Acceptance

**Status:** Experimental default-off candidate; **NOT APPROVED FOR PRODUCTION**.
**Date:** 2026-10-25.
**References:** [implementation plan](native-admin-ui-plan.md), [security matrix](native-admin-ui-security-compatibility.md), [NUI-00 decisions](native-admin-ui-decisions.md).

## Operator-controlled opt-in

The API parses an optional `VIBRESS_NATIVE_ADMIN_UI_RELEASES` variable, absent by default. Its value is a comma-separated list of exact `pluginId@64-character-lowercase-sha256` release identifiers, where the SHA-256 is the trusted plugin's pinned **entrypoint artifact digest** from the operator lockfile. It is **not** a UI asset hash, human-readable version, or plugin-supplied permission.

```dotenv
# Default OFF: leave unset on all API replicas.
# Example only; placeholder digest is not an approved release.
VIBRESS_NATIVE_ADMIN_UI_RELEASES=reviewed-plugin@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

The parser bounds and validates the list. An operator must configure the **same approved pinned release** on every serving API replica and verify the final bytes/signature through the existing release runbook. Publication Staff cannot enable it through HTTP. This setting does not authorize execution of untrusted third-party code.

## API-first deployment and security gates

1. Complete independent Architecture, Security, API and Operator sign-off, and close relevant NUI-00 findings before production activation.
2. Test an old-plugin/new-Host and new-plugin/old-Host matrix with populated site data and existing iframe/scalar views.
3. Deploy the new **API first**, leaving `VIBRESS_NATIVE_ADMIN_UI_RELEASES` unset. The new Admin calls a route old API servers lack; upgrading Admin before every serving API replica supports the route can cause fail-closed page errors.
4. Deploy Admin second, still with Native off, and verify old UI parity across two publications and roles.
5. Stage an immutable operator-approved plugin release declaring compatible `adminViews` GET and `adminPages`, verify artifact hashes across replicas, and check local/global rights.
6. Only after successful tests, enable the exact release allowlist on each API replica. Verify Staff permission denial, site switching, plugin deactivation/revocation, hostile titles, RTL, accessibility and refresh/failure states.
7. For deliberate rollback, remove the pinned release entry across replicas, verify the old path remains separately authorized, and restore matching API/Admin and artifact versions without altering stored data.

## Verification commands — NOT RUN HERE

```sh
pnpm --filter @vibress/api-contracts typecheck
pnpm --filter @vibress/plugin-sdk typecheck
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/api-contracts/src/__tests__/extension-native-admin.test.ts
pnpm exec vitest run apps/api/src/plugins/__tests__/native-admin-registry.test.ts
pnpm exec vitest run apps/admin/src/components/platform/__tests__/NativeExtensionAdminView.test.tsx
pnpm exec vitest run tests/integration/config.test.ts
pnpm exec vitest run apps/api/src/plugins/__tests__/admin-view-registry.test.ts
pnpm exec vitest run apps/admin/src/lib/extensions/__tests__/admin-bridge.test.ts
pnpm build
```

Required beyond these commands: real Fastify/PostgreSQL/Redis integration; API and browser E2E for unauthorized/wrong-publication/revoked/disabled/stale state, English/Arabic RTL and keyboard use; digest mismatch and mixed-version replicas; Docker and backup/restore; signed artifact preflight; independent security approval. Compilation alone is not release certification.

## Fail-closed contract

| Situation | Result |
| --- | --- |
| Allowlist absent, release not pinned or no native descriptor | Existing authorized isolated iframe/scalar view |
| Exact release enabled, valid linked native GET/fields, authorized Staff/site | React Host stat/field-list view |
| Explicit enabled release has malformed, unsupported or unbound native declaration | Sanitized server error and no silent iframe downgrade |
| Permission, active publication, module/release or session invalid | Server denial; browser clears/blocks stale page data |
| Browser-supplied forged route ID/descriptor | Client validates Host response against existing link; API resolves route itself |
| Site switched while native data in flight | Ignore former site's response; do not show former site's values |

## Unfinished release blockers

NUI-03 structured Host storage resources and create/update action routes are now implemented experimentally, but have not passed full resource/action production acceptance or domain-specific ownership policy review. Remaining NUI-04 native forms/settings (optional validated generic navigation grouping is implemented on the branch), NUI-05 has an experimental Native LMS domain-authoring form on independent core/LMS branches, but real database and browser parity remain unverified. NUI-06 operational/security acceptance and NUI-07 stable external SDK release are not certified. The LMS iframe HTML interpolation sink was repaired on its development branch, but no signed production artifact has been approved.

**Decision:** keep the operator variable unset in production until all these gates close.

## NUI-03 storage resource and action pilot (disabled by default)

The experimental Host endpoints are `GET /api/admin/v1/extensions/:pluginId/data`, `GET /api/admin/v1/extensions/:pluginId/resources/:resourceId`, and `POST /api/admin/v1/extensions/:pluginId/actions/:actionId`.

A resource lists **only explicitly projected fields** from an existing, operator-approved plugin storage model. Default and maximum pagination limit is 20; list ordering is the underlying stable record ID. Optional indexed text equality filters are Host-validated against operator model metadata. Pagination cursors are 15-minute HMAC-SHA256 tokens tied to the Staff ID, publication, plugin, immutable approved digest, resource and filter query. Signing requires a valid production-format `VIBRESS_ENCRYPTION_KEY` shared across API replicas. Raw storage cursors never reach the browser.

**Write approval is a separate operator security contract**: `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` (same exact `pluginId@entrypointSha256` syntax) defaults to unset and has no effect unless the corresponding read-only release is also allowlisted in `VIBRESS_NATIVE_ADMIN_UI_RELEASES`. Both must remain unset in production pending NUI-03 acceptance. Only Staff with global `plugins.manage` and publication-local owner/admin role may use these endpoints; write also requires `extension.storage.write` and operator-approved storage model registration. Mutations are limited to bounded storage create and version-checked update (database CAS); retries with duplicate IDs or stale versions produce conflicts instead of repeated effects.

This **does not** authorize arbitrary plugin handlers, SQL, public/member mutations, LMS publishing, deletion, billing, or writing domain records that require additional business-invariant checks. A signed release permit alone is not a security sign-off. Validate genuine multi-publication API integration, two-replica cursors, stale/replayed writes, malicious projection/filter inputs, operator rollback, and fresh/upgrade installations before enabling the pilot. Native forms and public SDK support remain separate follow-up gates.

## NUI-05 domain authoring operator hold

The native LMS course-authoring form is an experimental release candidate, **not a replacement for the legacy iframe in production**. The legacy `courses` iframe and route stay installed. Release-specific paired Admin GET/POST metadata must be accepted by the Host and operator, and the immutable release digest must be identical across API replicas. The separate write allowlist gates the UI and does not weaken existing Staff session, Origin, publication membership, and plugin storage capability checks.

For an acceptance drill: verify fresh and populated installs, two publications with different owners, revoked Staff permission and plugin activation, bilingual draft completeness, duplicate create, CAS conflict, save/publish race, published-course immutability, invalid content, keyboard/RTL, and hostile stored titles. Verify release rollback leaves stored LMS content untouched, and run real PostgreSQL, Redis and multi-replica evidence. Disable both release allowlists after the drill. No certificate or sign-off is implied by CI alone.

Manual-only LMS workflow CI is intentionally paused in `vibress-lms/.github/workflows/lms-foundation.yml`: it currently supports `workflow_dispatch` and not branch pushes. Do not change the operator-requested trigger policy implicitly. Before production approval, an operator must explicitly dispatch and review the LMS TypeScript/domain/PostgreSQL suite on the final branch SHA, in addition to core Host CI.
