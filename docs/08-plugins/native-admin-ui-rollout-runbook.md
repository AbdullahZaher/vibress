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

NUI-03 typed paginated resources and authorized action gateway, remaining NUI-04 native forms/settings (optional validated generic navigation grouping is now implemented on the branch), NUI-05 independent LMS migration/parity, NUI-06 operational/security/E2E acceptance and NUI-07 stable external SDK release are **not implemented or certified**. The known LMS `courses.html` `innerHTML` sink requires a separate code fix before an LMS production pilot. The user-visible Native contract is limited to read-only scalar data.

**Decision:** keep the operator variable unset in production until all these gates close.
