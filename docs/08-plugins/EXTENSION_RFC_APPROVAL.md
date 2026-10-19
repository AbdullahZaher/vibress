# Vibress external extensions — RFC review and architectural approval record

**Decision:** **APPROVED FOR IMPLEMENTATION (architecture and invariants only)**  
**Recorded:** 2026-10-19  
**Binding ADR:** [Trusted external extension host vNext](../adr/2026-10-19-external-extension-host-vnext.md)  
**Implementation status:** NOT IMPLEMENTED on `main`. Public SDK contract and production readiness are **NOT** certified.  
**Approval authority:** Project-requested architectural adoption recorded in docs; **independent named human reviewer signatures are not claimed**.

## Role-based review result

| Reviewer role | Approved direction | Condition to verify in corresponding implementation PR |
| --- | --- | --- |
| Architect / Plugin Reviewer | Canonical `plugin-sdk` vNext, bundled-v1 preservation, external trusted host, independent LMS | Consumer inventory for `plugin-core`; versioned compatibility adapter only if required |
| Security | Only vetted operator-installed code; authoritative principal/publication, per-call capabilities; no false sandbox guarantee | Member publication check, CSP/SSRF/XSS, supply chain, tampered artifacts, disabled routes, privacy negative tests |
| DB/Migration | Versioned namespace-bound typed repositories; immutable additive migrations; data retained on disable | Existing global settings adapter, concurrent migration and populated upgrade, composite FK, backup/restore |
| API | Independent staff/member/public route guards, public SDK-owned runtime schemas validated by host | Runtime Zod schema adapter, stable errors/request IDs, validation and collision tests |
| Theme / i18n / Accessibility | Staff-only Studio view IDs distinct from public localized Web route; sanitized theme fallbacks | Mixed Arabic/English, RTL, SEO/canonical, external themes and keyboard/accessible controls |
| QA / Operations | Pilot before release; full multi-replica/worker/rollback CI before stable SDK | Build/run/test logs, actual signoff, release support matrix and Docker recovery exercise |

This table is a **documented role review**, not evidence of independent human approval or performed tests.

## RFC decisions — accepted vs delegated

| Document | Architecture decision | Status |
| --- | --- | --- |
| [Architecture](external-extensions-architecture.md) | External trusted operator-installed lifecycle, publication enablement, reserved routes and preserved data | **Accepted as design** |
| [SDK compatibility](external-extensions-sdk-compatibility.md) | Canonical public `plugin-sdk`; exact v1 preserved; conditional legacy adapter | **Accepted as design**, adapter mapping deferred to EXT-001 |
| [Identity and data](external-extensions-identity-data.md) | Host-bound principal and Member/publication match, global-settings migration guard | **Accepted as design** |
| [Scoped storage](external-extensions-storage-contract.md) | Named models, typed publication-bound repo/uow, schema admission through public SDK | **Accepted as design**; concrete types/SQL pending EXT-004/203 |
| [Package and UI](external-extensions-package-and-ui.md) | Externally verified final archive, Studio view IDs, reserved public route and pinned worker assets | **Accepted as design**; distribution encoding/frontend packaging pending EXT-101/301 |
| [Security/operations](external-extensions-security-operations.md) | Trusted in-process runtime not sandboxed; safe lifecycle, upgrade, audit/restore | **Accepted as design** |
| [Illustrative contracts](external-extensions-contracts.md) | Host-owned authorization and versioned API shape | **Design direction accepted**; **wire ABI/schema/path details explicitly not frozen** |
| [Roadmap](external-extensions-roadmap.md) | Internal pilot precedes public release and SDK freeze | **Accepted sequencing** |

## Immutable constraints for EXT implementation

1. No arbitrary uploaded/unsigned package execution, raw plugin DB access, untrusted `node:vm` sandbox claims, or permission checks based on caller-provided publication IDs.
2. No loss of existing v1 plugin support/settings or automatic expansion of global legacy activation to all publications.
3. No callable SDK method inferred from conceptual examples; implementation must publish a validated contract, real consumer fixture and compatibility matrix.
4. No hard guarantee that trusted in-process JS failures cannot crash/hang Vibress; separate isolation is another ADR.
5. No public release without tenant, API, migration, RTL/accessibility/theme, Docker/worker/recovery verification.

## Critical path / sign-off milestones

- **RFC approval (this record):** Architecture direction selected, risks and gate ownership documented, *no test claims*.
- **EXT-001..004:** Source consumer inventory, actual versioned schemas, runtime/permission signatures, reviewed migrations and conformance fixture; request human security/API/DB signoff at affected PRs.
- **Internal pilot:** Core EXT-101..104 + EXT-201..204 + minimal EXT-301/302; LMS-101..106 yields EXT-501 proof. Synchronous pilot can precede generic workers but must not pretend worker/event support.
- **Production:** EXT-301..304 + EXT-401..404 + EXT-501..504 plus real application security/QA/load/upgrade/recovery gates. Publish stable SDK only after implementation and independent external consumer conformance evidence.

## Current verification in approval review

Read the current `main` code for SDK/host/alternate plugin-core, plugin service, member auth, schema and theme route contract. Documentation acceptance does not alter executable behavior. Markdown file/link/example checks may be recorded with their results separately; application tests, pnpm typecheck/lint/build, CI, audits, Docker install and migrations were **not run** in this decision-only update.
