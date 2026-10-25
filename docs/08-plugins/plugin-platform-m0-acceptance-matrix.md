# M0 — Plugin release acceptance, compatibility and support matrix

**State:** reproducible test design only. Commands and pass conditions are **not** claims of execution. Use with [master tracker](plugin-platform-master-execution-plan.md) and [compatibility inventory](plugin-platform-m0-compatibility-matrix.md).

## Acceptance dimensions (PLUG-BASE-04)

| Scenario / concrete fixture | Required PASS | FAIL / block promotion |
| --- | --- | --- |
| Fresh DB + existing upgraded DB through 0045 | Use fresh and **populated** plugin, settings, publication enablement, event receipt, member and migration records. Verify data equality and no cross-publication inheritance after upgrade | Lost legacy rows/settings, changed schema history, implicit activation or copied secrets |
| Publication A + B | Staff/operator API auth matrix for listing, global lifecycle, scoped settings and event replay; assert separate authoritative publication identities and 401/403/404 as appropriate | ID alone grants access, publication B data present in A, unauthorized global actions |
| API replicas A+B / Worker replicas A+B | Pin same exact approved lockfile, signer and artifact digests, run independent admission checks on **each replica**, then inject mixed identity, restart, stale queue delivery and drain | Mixed releases execute simultaneously, old Worker consumes new job or active release bytes hot-swap |
| Redis and PostgreSQL failures | Crash between DB commit and Redis enqueue using plugin event receipt/relay; duplicate enqueue and retry, exhausted retries and recovery | Missing receipt, lost committed event, unbounded replay or duplicate non-idempotent operation |
| Operator restore | Snapshot consistent PostgreSQL, Redis, full signed artifact tree and decryption keys; restore into isolated stack. Verify hashes, counts, masked secrets, event receipts and approval identity; record measured RPO/RTO | Mismatched signer or restored key, missing artifact, incorrect PG/Redis/event join, claimed irreversible schema rollback |
| Signing / supply chain | Run actual independent scanner, retain raw logs, final artifact SHA, signed review, SBOM/provenance and lockfile. Inject changed bytes, revoked/unknown signer, replay, expired evidence and high/critical findings | Accepts any changed/revoked/expired release, trusts operator assertion as proof scanning ran |
| Host/SDK/legacy | Build a clean *independent* SDK consumer with public imports only; test ABI v1, rejected incompatible ABI and reviewed legacy behavior if used | Deep imports, silent ABI coercion, context lost, SDK claimed published despite private package |
| Admin English/Arabic | Keyboard-only installer and lifecycle, labeled search/status inputs, focus restoration, empty/error/loading, RTL, 320 px mobile and long strings; real permission changes server-side | Focus trap, unlabeled controls, wrong-direction layout, unauthorized action works through API |
| Public/member/theme | Two supported themes, locale/SEO/private site SSR, Host-gated Member publication matching and no protected content leak through cache | Wrong-site view/data, unsanitized HTML, privacy bypass or lost canonical metadata |
| Self-hosted | Linux/Alpine Docker Compose with PostgreSQL, Redis and immutable mounts, rootless/support matrix, reverse-proxy/TLS; verify startup before and after upgrade | Dependency on proprietary control-plane services, writable trusted executable snapshot |

## Progressive test commands (capture SHA, exit code, environment)

- `pnpm install --frozen-lockfile`
- `pnpm exec vitest run apps/admin/src/components/platform/__tests__/PluginsPanel.test.tsx apps/admin/src/components/platform/__tests__/PluginsPage.test.tsx`
- `pnpm exec vitest run packages/domains/plugins/tests apps/api/src/plugins/__tests__ apps/worker/src/processors/__tests__ scripts/plugins/__tests__`
- `pnpm exec tsx scripts/plugins/check-replica-receipts.ts api:api-a=... api:api-b=... worker:worker-a=... worker:worker-b=...` (see the [runbook](secure-operator-release-admission.md); **not** a substitute for live signed admission and independent physical replicas)
- `pnpm typecheck`, `pnpm lint`, `pnpm verify:explicit-any`, `pnpm vitest run`, `pnpm build`, `pnpm audit --prod --audit-level high`
- For strict isolated restore: `VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1 VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY=strict ... pnpm exec tsx scripts/plugins/check-restore.ts`, followed by `pnpm exec tsx scripts/plugins/check-queue-recovery.ts` (exact environment and run order in [PLUG-OPS-02 drill](plugin-platform-restore-drill.md)).
- Docker image build, security scan, relevant signed admission/restore scripts and full Admin E2E **against real services**.

Run only commands supported by actual package tooling; resolve targeted failures instead of bypassing tests. Record exact command, configuration profile, URL to retained logs, commit SHA, pass/fail, DB/Redis image version, binary/release digests and operator acceptance sign-off. Never promote based on a checklist without results.

## Evidence levels and release gate (PLUG-BASE-02)

- **Planned:** specified but no shipped change.
- **Implemented:** code/documentation + tests/fixtures authored, not necessarily executed.
- **CI Verified:** matching exact commit with passing relevant automated gates.
- **Operationally Accepted:** signed, retained actual multi-replica and DR drill evidence and named owner sign-off.
- **Released:** versioned support/upgrade/revocation policy and approved publication.

The previous PR #88 green CI is evidence for that merged baseline **only**; it does not certify a later execution-branch commit. No M1A/M2/M4/M6 operational certification exists here without new drill artifacts.
