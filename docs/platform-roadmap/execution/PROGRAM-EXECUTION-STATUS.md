# Program Execution Status — M00–M12

> **Last updated: 2026-11-15.** Implementation branch:
> `feat/wave1-platform-kernel-tenant-isolation`, cut from `main` at
> `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`. Verified source HEAD
> `a9d99a414f671583485900433286702f6a5b6a2c` (CI run 43750359129 passed on
> that exact SHA). Code evidence commit `f0d8aaed` (offline OIDC verifier +
> reference auth-mode gate); prior head `beaeeb71` passed run 43744722260.
> Docs-only head `0d308dfa15bca01489c5ecb4dbcbe6ffcc143066` after
> `a9d99a41` passed run 43752560245
> (`build`, `e2e`, `container-scan`). Earlier remediation increments:
> `b62ffdf5`, `6b31320d`, `0f64936a` and P2 `054ac8e6`; the R35 increment is
> `b2ffc688`. Roadmap input pinned at PR #151 (draft) head
> `c9997a9353a229a4287256f5ba3b94d718e3a5d9`.
>
> Documentation-only commits after `a9d99a41` do not change code or evidence.
> The docs-only head `0d308dfa` passed its own full CI run 43752560245; that
> result is recorded in the evidence table and does not re-attest the code
> evidence above. Later docs-only heads are covered by their own PR checks.
>
> **No wave has passed its gate. No ADR is accepted. No production authorization
> exists.** This file records measured status only.

## Wave status

| Wave | Milestones | Status | Gate |
| --- | --- | --- | --- |
| 1 | M00–M02 | **IN PROGRESS — partial implementation, NO-GO** | Not passed |
| 2 | M03–M06 | Not started | Blocked by Wave 1 |
| 3 | M07–M08 | Not started | Blocked |
| 4 | M09–M10 | Not started | Blocked |
| 5 | M11–M12 | Not started | Blocked |

## Wave 1 milestone detail

| Milestone | Done on branch | Missing before exit |
| --- | --- | --- |
| M00 Engineering baseline | Baseline SHAs, dependency/runtime pin, asset inventory, ownership map, ADR blockers, boundary test with relative escape detection and missing dir failure, docs-link validator wired into CI, unit/integration split in CI, legacy docs links cleaned (612 links / 296 files resolve), pinned two-publication CMS/Studio fixture pack with digest and HTTP proof | Named owners |
| M01 Universal kernel | Branded identity, public contracts, definition helpers, in-memory registry, serializable manifest with digest, persisted registry (drift/integrity refusal, CAS update, two-way verification), atomic installation binding with CAS guards, kernel route execution adapter, bootable standalone reference app with runtime/reader/verifier verification, **separate operator provisioning executable with owner credentials**, **request-serving process that refuses `DATABASE_URL` and has no provisioning authority**, pinned read-only installation/environment/artifact/manifest verification, kernel-only import boundary | Independent review and named sign-off; production identity-provider adapter and deployment runbook |
| M02 Security/identity/tenancy | Verified scope, default-deny policy, tenant unit of work with hardened comment/schema-qualification scope mutation detection, role-switch rejection, async-escape fail-closed, connection destruction on unknown session state and a pre-commit role identity probe, additive RLS migration, least-privilege runtime role (registry and membership tables denied), boot-time privilege assertions over `current_user` and `session_user`, **all SET-able role memberships (privileged, ordinary, indirect and `NOINHERIT`)**, schema/database CREATE, database/schema/table/function ownership, registry table/column ACLs and SECURITY DEFINER EXECUTE, 22-test PostgreSQL deny matrix plus escape/role-switch/membership tests including non-superuser owner `FORCE RLS`, R26 read-only function inventory, two-database installation boundary | R26 revocation approval/application, deployment non-superuser owner, views/report policy decision, Redis/S3 boundary tests, production IdP, independent review |

## Evidence executed on this branch

Suites and typecheck were re-measured on 2026-11-15 for the P2 increment
(commit `054ac8e6` on top of `0f64936a`): platform suite, unit suite,
workspace typecheck, reference-app Playwright, targeted typecheck/lint,
both docs link validators and the R26 read-only audit all passed on that
tree. That run's full integration suite was **not green in this environment**
(44/46 files; 12 unrelated LMS tests failed on `*.localhost` DNS and failed
identically at baseline `c34e159d`). The final-tree re-run on 2026-11-15
resolved the wildcard on this host and passed **49/49 files, 610/610 tests**
(after one load-sensitive 5 s timeout in `real-lms-pilot-host.test.ts` Step 4
on the first attempt; see the evidence table). CI run
[43685146696](https://github.com/AbdullahZaher/vibress/actions/runs/43685146696)
on head `9684362f` (which contains P2 code `054ac8e6`) passed `build`, `e2e`
and `container-scan`; the docs-only head `0d712005` passed run
[43690688602](https://github.com/AbdullahZaher/vibress/actions/runs/43690688602).
Later heads raised the verified source HEAD through `beaeeb71` (CI run
43744722260) to `a9d99a41` (CI run 43750359129, recorded in the evidence table
below).

| Suite | Result |
| --- | --- |
| **Full platform suite, P2 tree** (`pnpm exec vitest run --config vitest.platform.config.ts`) | **15 files / 214 tests passed**, exit 0, no unhandled errors (re-run 2026-11-15, 19.14 s) |
| **Reference app, P2 tree** (`tests/integration/platform-reference-app.test.ts`) | **86/86 passed**; matching installation boots; environment/artifact/application-id/manifest drift fails read-only with rows unchanged; verifier SELECT-only and denied writes/other relations; runtime/reader/verifier reject privileged, ordinary, indirect and `NOINHERIT` memberships; child-process serving start exits 1 with `DATABASE_URL` or non-distinct URLs; CAS-guarded provisioning leaves rows unchanged on mismatch; contract/provisioning tests (ten real-PostgreSQL negatives plus a pre-existing-grant revocation); 11 signature-identity tests (exact signature; two explicit overloads; unauthorized overload; late-added overload; `PUBLIC` EXECUTE; explicit grant on an unauthorized overload; SECURITY DEFINER; refused non-existent signature; signature change; removed definition; contract validation); 4 prior atomic-provisioning tests plus 6 connection-safety tests (successful commit reuse, rollback + retry, failed `BEGIN`, failed `ROLLBACK`, terminated backend, unknown `COMMIT` outcome) |
| Architecture boundary (`tests/architecture/platform-boundaries.test.ts`) | 6/6 passed, including no provisioning imports/owner identifiers in `server.ts`/`start.ts` |
| Typecheck + lint, P2 tree | `tsc` for `packages/database` and `apps/platform-reference` passed; ESLint on all changed files clean |
| Reference-app Playwright, P2 tree | 8/8 passed |
| Kernel + tenancy unit tests + architecture boundary (prior commit content) | 70 tests passed (7 files) |
| PostgreSQL tenant isolation (`tests/integration/platform-tenant-isolation.test.ts`) | 24/24 passed |
| Two-installation database boundary (`tests/integration/platform-installation-isolation.test.ts`) | 8/8 passed, cross-database `CONNECT` denied |
| R26 read-only function audit (`scripts/audit-function-privileges.mjs`) | Re-measured 2026-11-15 on the P2 tree: 33 public functions, 0 `SECURITY DEFINER`, 31 extension-owned, 33 with `PUBLIC` EXECUTE, 0 default-ACL entries, one superuser role |
| R26 proposal verification (`tests/integration/platform-r26-revocation.test.ts`) | **4/4 passed** in a disposable database with a fresh non-superuser owner; reads the proposal file and applies its exact statements. Proves: PUBLIC execute denied on both trigger functions; global `pg_default_acl` entry with no `PUBLIC` grantee; owner-created functions in `public` **and** another schema denied (`42501`); `pg_trgm` functions still PUBLIC (R26-EXT); trigger still fires for the caller without runtime EXECUTE; fail-closed guard rejects an unreviewed PUBLIC-executable function and re-application is idempotent; rollback restores the built-in default. Shared dev database unchanged (audit above re-run after: 33/33, 0 default ACLs). **Proposal still not applied anywhere.** |
| Production-shaped identity separation (`tests/integration/platform-production-topology.test.ts`) | **8/8 passed** with throwaway roles dropped afterwards. Runtime, membership-reader and deployment-verifier logins are distinct, `NOSUPERUSER NOBYPASSRLS`, hold no role memberships and never adopt the owner identity. Tenant tables stay owned by the migration role with `ENABLE`+`FORCE` RLS; the runtime sees 0 rows without scope and only the scoped tenant with it; every operator/directory relation and `CREATE TABLE` is denied `42501`; the reader is SELECT-only on memberships; the verifier is SELECT-only on installations and registrations. The dev fixture's owner remains a superuser (deployment blocker unchanged). |
| R35 view surface (`tests/integration/platform-view-surface.test.ts`) | **3/3 passed** with a throwaway view and role dropped afterwards. A materialized-view contract is rejected; a declared view without `security_invoker` fails boot with `view_not_security_invoker` and the leak is measured (direct table read 0 rows, non-invoker view returns the row because the dev owner is a superuser); after `ALTER VIEW ... SET (security_invoker = true)` boot passes, the unscoped view returns 0 rows and the scoped view returns exactly the tenant's row. Policy: [R35-VIEW-SURFACE-POLICY.md](R35-VIEW-SURFACE-POLICY.md) |
| CI on `d0fc26c3` | **PASS** — run [43706333296](https://github.com/AbdullahZaher/vibress/actions/runs/43706333296) on head `d0fc26c3`: `build`, `e2e` and `container-scan` succeeded |
| CI on `0d248dc6` | **PASS** — run [43742169334](https://github.com/AbdullahZaher/vibress/actions/runs/43742169334) on head `0d248dc6`: typecheck, lint, explicit-any guard, docs links, unit, integration, locale replay, build, clean-tree, dependency audit, `e2e` and `container-scan` all succeeded |
| CI on prior verified source HEAD `beaeeb71` | **PASS** — run [43744722260](https://github.com/AbdullahZaher/vibress/actions/runs/43744722260) on head `beaeeb71`: `build`, `e2e` and `container-scan` all succeeded |
| CI on verified source HEAD `a9d99a41` | **PASS** — run [43750359129](https://github.com/AbdullahZaher/vibress/actions/runs/43750359129) on head `a9d99a414f671583485900433286702f6a5b6a2c`: typecheck, lint, explicit-any guard, docs links, unit, integration, locale replay, build, clean-tree, dependency audit, `e2e` and `container-scan` all succeeded |
| CI on docs-only head `0d308dfa` | **PASS** — run [43752560245](https://github.com/AbdullahZaher/vibress/actions/runs/43752560245) on head `0d308dfa15bca01489c5ecb4dbcbe6ffcc143066` (`pull_request` event): `build`, `e2e` and `container-scan` all succeeded. This head contains no code change after `a9d99a41` |
| CMS compatibility subset (publications, content, transactions, Studio persistence, outbox) | 79/79 passed (within the full integration run) |
| Pinned CMS/Studio fixture pack (unit) | 4/4 passed — digest, drift refusal, deterministic encoding |
| Pinned CMS/Studio fixture pack (HTTP + PostgreSQL) | 3/3 passed — per-publication pinned documents, non-disclosing cross-publication 404/403, Studio round-trip and pinned restore |
| Full docs link validation (`node scripts/validate-docs-links.mjs docs`) | Re-run 2026-11-15: 692 links across 305 files resolve |
| Unit/boundary/component suite (`pnpm test:unit`, P2 tree) | **364 files / 2614 tests passed** under Node 24.16.0, exit 0, 246.53 s (re-run 2026-11-15). A Node 26.13.0 run, outside the declared `>=24 <25` engine, had 5 jsdom `localStorage` failures in portal/admin tests; measured as a Node-version environment effect, not a product regression |
| Full integration suite (`pnpm test:integration`, P2 tree) | **44/46 files, 583/595 tests passed** in the earlier run; 12 tests in `real-lms-authoring-host.test.ts` and `real-lms-pilot-host.test.ts` failed on `getaddrinfo ENOTFOUND site-a-<runId>.localhost`. The same 12 failed at baseline `c34e159d` with the P2 changes stashed (diff hash verified), so that failure was environmental; **not reported as PASS** |
| Full integration suite (2026-11-15 re-run, final tree) | **49 files / 610 tests passed**, exit 0, 141.47 s. This host now resolves wildcard `*.localhost` (`dscacheutil`/`dns.lookup` → `::1`, `127.0.0.1`), so the prior 12 DNS failures did not recur; they remain recorded as environment-specific evidence. A first run on this tree recorded one failure: `real-lms-pilot-host.test.ts` Step 4 exceeded the default 5 s timeout under load; the file then passed **8/8** standalone and the sequential full rerun passed **610/610**. The 5 s default is a load-sensitive timeout, not claimed as a first-attempt pass |
| Workspace typecheck on the P2 tree (`nx run-many --target=typecheck --all`) | 74/74 projects succeeded |
| CI on the P2 source head | **PASS** — run [43685146696](https://github.com/AbdullahZaher/vibress/actions/runs/43685146696) on head `9684362f` (contains code `054ac8e6`), and run [43690688602](https://github.com/AbdullahZaher/vibress/actions/runs/43690688602) on the final docs-only head `0d712005`: `build`, `e2e` and `container-scan` succeeded; the build job includes typecheck, lint, docs links, unit and integration steps |
| CI on the prior increment's SHA | **PASS** — run [43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614) on `0f64936a`: build, container-scan and e2e succeeded |
| `pnpm docs:validate-links` (`docs/platform-roadmap`) | Re-run 2026-11-15: 120 links across 17 files resolve |

Integration suites share the dev database and must run sequentially. One run that
overlapped a second suite produced 2 spurious `setup.test.ts` failures (shared tables
truncated mid-test); the cause is recorded in the
[Wave 1 report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md). Two later sequential
runs passed.

## Wave 1 remediation tickets

| ID | Priority | Status |
| --- | --- | --- |
| W1-T01 runtime-role privilege assertions | P0 | **Done, extended** — boot fails closed on unsafe `current_user`/`session_user` attributes, privileged membership, schema/database CREATE, ownership, registry ACLs and SECURITY DEFINER EXECUTE; real-PostgreSQL negative tests. Now also enforces the versioned runtime privilege contract on effective table/view/column/sequence/schema/function authority, requires declared views to be `security_invoker` and rejects materialized views (R35), and a production-shaped test exercises all three serving identities (runtime, reader, verifier) against their own deny matrices |
| W1-T02 split owner/registry access from serving | P0 | **Superseded by P0-A/P1** — the owner pool was removed from the serving process entirely; provisioning is a separate executable |
| W1-T03 atomic installation binding | P0 | **Superseded by the P1 create/update split** — creation is one statement with its audit row; installation changes are a separate mandatory-CAS operation with a transactional audit row |
| W1-T04 transaction trust boundary | P0 | **Done** — scoped handle sealed at settlement, escaped in-flight work fails the unit closed and destroys the connection, role switching rejected and re-verified against the identity captured at `BEGIN`, failed `ROLLBACK`/`COMMIT` destroys the connection; six unit and two real-PostgreSQL negative tests |
| W1-T05 R26 PUBLIC EXECUTE revocation | P0 | **Blocked — requires DB-owner authorization.** [Approval request](R26-REVOCATION-APPROVAL-REQUEST.md) prepared, **not applied**. Proposal 0055 corrected on 2026-11-15: the schema-scoped `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public` was measured to be ineffective on PostgreSQL 16.15 (schema-scoped defaults are additive over an empty baseline) and replaced with the global form; the fail-closed guard now requires the global row. The corrected proposal is executed and pinned by `platform-r26-revocation.test.ts` in a disposable database only. Scope B legacy-role grant decision also required |
| W1-T07 production identity provider | P1 | **Partially implemented, blocked for wiring.** Offline `OidcPrincipalVerifier` (RS256/ES256, static JWKS, iss/aud/exp/nbf/iat, app+installation binding, derived principal id, no claim-trust) with **21 tests**; `assertReferenceAuthenticationMode` refuses static tokens in production-shaped runs and unsupported auth modes before any DB URL is read (3 topology tests, including a spawned process). Live IdP tenant, JWKS rotation, revocation, cookie flow and membership integration remain blocked on the [identity-provider request](W1-T07-IDENTITY-PROVIDER-REQUEST.md) |
| W1-T06 Redis/S3/queue isolation proof | P1 | **Blocked — authorization required.** Harness and deny matrix specified in the [resource-isolation request](W1-T06-RESOURCE-ISOLATION-REQUEST.md); no ACL, bucket or credential change made. Current cache/queue/storage paths remain naming-isolated, not identity-isolated |
| W1-T08 CMS/Studio fixture pack; F-012 decision; legacy docs links | P1 | **Done** — digest-pinned two-publication CMS/Studio pack with run-scoped provisioning and teardown, 4 pack unit tests and 3 real HTTP+PostgreSQL compatibility tests (per-publication pinned documents, non-disclosing cross-publication 404/403, Studio round-trip and restore); 76 legacy docs links rewritten and the full docs tree validates (re-measured 2026-11-15: 692 links / 305 files); F-012 decision record proposed (option B) with an A/B matrix and a fail-closed topology/onboarding/auth-mode boot gate (8 tests), **not accepted** |
| W1-T09 runbooks, registry change audit, reference-app Playwright, R40, ownership | P2 | **Done** — [registry change audit](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md) with migration 0057 and real-PostgreSQL tests (69 reference-app tests on the final tree); [boot/registry/deployment runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) and `pnpm platform:provision-roles`; [reference-app Playwright](PLATFORM-BOOT-REGISTRY-RUNBOOK.md#9-reference-app-playwright-harness) **8/8 passed** with per-run roles/rows cleaned; [R40 decision record](R40-VERSION-IDENTITY-DECISION.md) and [ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md) prepared but unresolved/unsigned |
| P0-A privileged provisioning authority out of the serving process | P0 | **Done in code, unreviewed** — separate `pnpm platform:provision-reference` executable; serving refuses `DATABASE_URL`, holds no owner pool/registry store, and a source-boundary test enforces it; child-process negative tests |
| P0-B full SET-able membership closure | P0 | **Done in code, unreviewed** — runtime/reader/verifier reject any non-self membership, including indirect and `NOINHERIT`; real-PostgreSQL tests |
| P1 separate provisioning and pinned read-only verification | P1 | **Done in code, unreviewed** — CAS-guarded operator provisioning; dedicated SELECT-only verifier role; environment/artifact/application/manifest drift fails before serving without mutation; audit attribution |
| P1 strict runtime privilege contract | P1 | **Done in code, unreviewed** — versioned, extensible allowlist (schemas, relations by kind, sequences, functions) enforced on effective authority at boot and provisioning; ten real-PostgreSQL negatives plus a pre-existing-grant revocation test; reference CRM profile is one contract instance |
| P2 exact function-signature authorization | P2 | **Done in code, unreviewed** — contract version `2` identifies each function by schema, name and exact `pg_get_function_identity_arguments`; provisioning grants only the catalog-resolved signature and refuses a missing definition; boot reports `contract_function_missing`; 11 real-PostgreSQL signature tests plus contract-validation negatives |
| P2 provisioning rollback / connection destruction | P2 | **Done in code, unreviewed** — `BEGIN` failure, `ROLLBACK` failure and an attempted-then-unknown `COMMIT` destroy the connection (`release(true)`); successful rollback returns a reusable connection; six fault-injection tests including a terminated backend and an unknown commit outcome |
| P1 atomic provisioning transaction | P1 | **Done in code, unreviewed** — one checked-out connection and one transaction for manifest, installation, both audit streams and the read-only proof; stale-CAS, forced-audit-failure, idempotent-retry and one-winner-concurrency tests |
| P1 mandatory CAS + installation audit | P1 | **Done in code, unreviewed** — `registerInstallation`/`updateInstallation` split; actor, reason and both expected-state values required for updates; migration `0058` audit row written in the same statement |

## Known residual risks carried forward

| ID | Risk | Status |
| --- | --- | --- |
| R26 | `PUBLIC` default `EXECUTE` lets the platform role call owner functions; the legacy runtime role also holds explicit function EXECUTE | Inventoried and re-measured 2026-11-14; [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) prepared, **not applied**; 0055 alone would not close the legacy role (Scope B open) |
| F-012 | CMS tables are not covered by RLS; security review remains conditional | Open — [CMS disposition proposed](F-012-CMS-RLS-DECISION.md) (option B: self-hosted application-level isolation; multi-tenant hosting gated on RLS activation), **not accepted**. The decision record now includes an A/B decision matrix, and the reference serving process fails closed before reading any database URL if `PLATFORM_TOPOLOGY` is not `single-installation` or external tenant onboarding is enabled (8 topology/auth-mode tests incl. two spawned-process refusals). No RLS or grant change made |
| R35 | PostgreSQL views/materialized reports do not inherit caller RLS | **Guarded at the runtime contract** — materialized views are rejected and a declared view must be `security_invoker` or boot raises `view_not_security_invoker`; measured leak/deny proof in `platform-view-surface.test.ts`. [Policy](R35-VIEW-SURFACE-POLICY.md). Residual: views read by owner-credential code and the non-superuser owner blocker remain open |
| R37 | Legacy transaction runner nests without savepoints (the scoped tenant unit of work is hardened) | Unchanged by design, documented |
| — | Owner credentials exist only for the separate provisioning executable | **Fixed in code (P0-A)** — serving refuses `DATABASE_URL`; provisioning must still run as a controlled deployment step with least-time credentials |
| — | Installation `artifact_digest` is supplied by the deployment pipeline; provenance is not cryptographically verified | Partially addressed (P1) — required and pinned by provisioning and boot verification; CI provenance open |
| — | Reference app uses an operator-configured static bearer-token directory, not a production identity provider | Reference only; refused in production-shaped runs and for any non-`reference` auth mode (W1-T07 gate); offline OIDC verifier prepared but not wired |
| — | Membership directory is not RLS-protected (read before a scope exists); runtime role is denied the table and the reader role has SELECT only | By design; auth-service access model needs review |
| — | No application/tenant provisioning API; registry drift is now a documented, audited manual deployment step | Provisioning API open; [runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) and change audit added in W1-T09 |
| — | 76 pre-existing broken links in legacy docs outside `docs/platform-roadmap` | Docs rot | **Resolved (W1-T08)** — rewritten to relative targets; `node scripts/validate-docs-links.mjs docs` passes (re-measured 2026-11-15: 692 links / 305 files) |
| — | Broader CMS Playwright E2E/acceptance suites require staging secrets and have not run | Open; reference-app Playwright **8/8 passed** locally (W1-T09) |
| R40 | Release/version identity (`1.2.0` vs Framework GA) | Unresolved — [decision record](R40-VERSION-IDENTITY-DECISION.md) prepared; release-owner signature required |
| A1–A8, G0–G7 | Human sign-offs and gates | Open, unassigned — [role request](OWNERSHIP-ASSIGNMENT-REQUEST.md) recorded |

## Rules in force

- Do not start Wave 2 before Wave 1 GO, independently reviewed and signed.
- Do not mark any milestone complete from documentation alone.
- Do not enable public application hosting or external tenant onboarding.
- Do not rewrite tags, migrations, audit records or historical issue status.

## Linked evidence

- [Wave 1 implementation and security report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md)
- [Wave 1 final certification report — NO-GO](WAVE-01-FINAL-CERTIFICATION-REPORT.md)
- [Final program certification — interim, not issued](FINAL-PROGRAM-CERTIFICATION-REPORT.md)
- [M00 baseline and ownership](BASELINE-AND-OWNERSHIP-M00.md)
- [Platform boot, registry and deployment runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md)
- [R40 version-identity decision record](R40-VERSION-IDENTITY-DECISION.md)
- [R35 runtime view policy](R35-VIEW-SURFACE-POLICY.md)
- [W1-T06 resource-isolation request](W1-T06-RESOURCE-ISOLATION-REQUEST.md)
- [W1-T07 identity-provider request](W1-T07-IDENTITY-PROVIDER-REQUEST.md)
- [Ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md)
- [ADR-PLAT-001](adr/ADR-PLAT-001-installation-topology.md)
- [ADR-PLAT-002](adr/ADR-PLAT-002-identity-vocabulary.md)
- [ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md)
- [R26 function EXECUTE inventory](R26-FUNCTION-EXECUTE-INVENTORY.md), [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) and [proposed revocation](proposals/0055_revoke_public_execute.sql)

---

## 2026-11-16 governance reconciliation — no new certification or test execution

**Coordinator classification: NO-GO; all human and independent approval gates remain open.**
The source evidence and earlier 2026-11-15 measurements above remain historical;
this addendum neither changes their original test dates nor upgrades them into
newly executed results. The PR HEAD **before** governance-only document changes was
`a96ea073767e303b02121d87558adbd12ce111f3`; its GitHub [CI run 43755004357](https://github.com/AbdullahZaher/vibress/actions/runs/43755004357)
has `build`, `e2e`, and `container-scan` **success** on that **same**
`head_sha`. This commit follows source commit
`f0d8aaedb90c4debca5cf792480e297ca12e1832` by three docs-only commits.
Any subsequent governance commit requires its own CI result; past head results
are **not** a substitute.

The new [WAVE-01-GATE-CLOSURE-MATRIX.md](WAVE-01-GATE-CLOSURE-MATRIX.md)
documents 35 acceptance criteria and the outstanding R26, F-012, R35, R40,
production owner, infrastructure, IdP, restore/monitoring, ADR and independent
review gaps. The [WAVE-01-APPROVAL-REGISTER.md](WAVE-01-APPROVAL-REGISTER.md)
records 37 decision/approval entries, including individually tracked A1–A8 and
G0–G7, with **no fabricated named owners or signatures**. The
[WAVE-01-RELEASE-DECISION-PACKET.md](WAVE-01-RELEASE-DECISION-PACKET.md)
binds GitHub checks and historical tests to their correct SHAs and records
the proposed **NO-GO** only.

**New review data:** the connector returned four `COMMENTED` PR reviews,
zero `APPROVED` reviews, all from the PR author; 20 of 20 inline review
threads are unresolved (some are marked outdated). These do **not** establish
independent reviewer approval. `main` reports `protected: false`, the
accessible rulesets list is empty, and the detailed branch protection API
returns HTTP 403 to this connection: effective merge safeguards require
administrator verification, not inference.

**New supply-chain finding SUPPLY-2026-01 (Medium, CVSS 5.9):** the PR lockfile
pins `fastify@5.12.7`; [GHSA-3qgw-9275-xf8w /
CVE-2026-120216](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w),
published 2026-11-02 and cross-checked against
[OSV](https://osv.dev/vulnerability/CVE-2026-120216) (modified 2026-11-09),
affects `>=5.8.0 <5.12.8` when a non-default nonzero `handlerTimeout`
is combined with a streaming route. Whether Vibress configures that
exploitable combination is **unverified**, so Agent 03 must check actual
reachability and provide an evidence-based disposition, ideally upgrading
to `>=5.12.8` and retesting. A passing historical dependency-audit step
does not establish the absence of a newly identified Medium finding.

**Historical quality score remains 8.3/10 (change = 0.0).** No production
environment was accessed; no secret, privilege, migration, tag, branch
protection, release authorization, PR merge, or Wave 2 work was performed by
this documentation update. For any report whose header states a former
verified source head, this addendum records the **later governance baseline**
without overwriting the prior source/date history.



## Six-agent integration addendum — 2026-11-16 (technical evidence, NO-GO)

A separate integration candidate was assembled on branch integration/wave1-agents-01-06-20261116 from #166 HEAD 3c55c5b0a1bcbd9093ade62c5b6f738acbe42021. Exact specialist sources: #171 9ee1d2b3, #172 d149804e, #173 e97ff02d and #174 bf1a63ce. The combined code/evidence path through 108ae9497974217948fd1a273044198553b33243 adds AG06-05 transactional role provisioning and fault tests, R35 foreign-table denial, offline membership-enriched OIDC (not production-wired), disposable Redis/S3 harness, and a reference CRM Playwright CI job. This document update is a further SHA change and requires final-head CI.

No R26 proposal was applied; F-012 remains undecided; actual BullMQ worker, production IdP and patched production PostgreSQL are unverified; image provenance and restoration remain open. The last independent Agent 06 review predates integration; 22 #166 threads and all required human signatures remain outstanding. Github main was reported unprotected by branch API; administrator policy change is not authorized by this addendum. Preserve the recorded 8.3/10 until independent reassessment. No merge, Wave 2, release or risk exception is authorized.

Full decision-ready evidence, role matrix and mandatory remaining gates: WAVE-01-SIX-AGENT-INTEGRATION-2026-11-16.md.

---

## Agent 01 — 2026-11-16 integrated candidate governance update

**Decision remains NO-GO.** Integration PR [#176](https://github.com/AbdullahZaher/vibress/pull/176) is Draft, unmerged. The pre-governance-doc candidate `63c47b3adda183d816727edc7b590979b2a8c2da` includes pinned specialist source from PRs #171–#174, atomic role provisioning fixes, and new required reference-app E2E CI. **Integration CI [43870098128](https://github.com/AbdullahZaher/vibress/actions/runs/43870098128) was IN PROGRESS**, with its build job unfinished, at last direct inspection. Its workflow and build job head_sha matched `63c47b3a`; the actual checkout commit has not been independently confirmed from logs. The resource-isolation check on this SHA completed successfully; this is **not full CI PASS**. These governance edits create a new HEAD and require fresh checks.

**Reverified reviews:** #166 has **5 COMMENTED, 0 APPROVED, 22 unresolved review threads**. #171–#174 and #176 have zero submitted approvals. #175 returned 404 as a PR; no evidence of a valid PR #175. `main` and Wave 1 source branch report `protected:false`, rulesets `[]`; `main/protection` is 403 and the integration branch protection lookup is connector-restricted. Administrator verification is mandatory.

**Specialist state:** Agent 02 BLOCKED (R26 A/B, non-superuser role/restore, patched PG16.16); Agent 03 BLOCKED (F-012, cross-publication paths, conditional Fastify advisory); Agent 04 BLOCKED (synthetic Redis/S3 38-case proof, no real BullMQ or DR); Agent 05 BLOCKED (offline OIDC adapter only, no live IdP); Agent 06 BLOCKED (prior review predates integrated SHA). No signed human review or risk acceptance exists.

**Individually testable Agent 06 issues created:** [AG06-01 #177](https://github.com/AbdullahZaher/vibress/issues/177), [02 #178](https://github.com/AbdullahZaher/vibress/issues/178), [03 #179](https://github.com/AbdullahZaher/vibress/issues/179), [04 #180](https://github.com/AbdullahZaher/vibress/issues/180), [05 #181](https://github.com/AbdullahZaher/vibress/issues/181), [06 #182](https://github.com/AbdullahZaher/vibress/issues/182), [07 #183](https://github.com/AbdullahZaher/vibress/issues/183), [08 #184](https://github.com/AbdullahZaher/vibress/issues/184), [09 #185](https://github.com/AbdullahZaher/vibress/issues/185), [11 #186](https://github.com/AbdullahZaher/vibress/issues/186). All remain open pending exact integrated remediation, tests and independent disposition.

**Wave 1 exit mapping:** G0 signed architecture, G1 scoped PG16.16/RLS/ACL and G1b installation isolation are applicable; R26/F-012/R35, non-superuser roles, IdP and actual recovery are blocking for the proposed production-shaped scope. G2/G3b/G4 and full GA G5/G6/G7 are later roadmap gates and not claimed as Wave 1 exits; minimum tested recovery and R40/version identity remain necessary for any deploy. A1–A8 applicability requires named authority; no future milestone is falsely marked passed.

**Additional deliverables:** [integrated PR/commit evidence](WAVE-01-INTEGRATED-PR-COMMIT-EVIDENCE-REGISTER.md), [branch protection recommendation](WAVE-01-BRANCH-PROTECTION-RECOMMENDATION.md), and [owner action checklist](WAVE-01-OWNER-FINAL-ACTION-CHECKLIST.md). The previously recorded **8.3/10 remains unchanged (Δ 0.0)**. No security/DB/branch settings were modified; no merge, production operation, release GO, risk acceptance or Wave 2 authorization was issued.
