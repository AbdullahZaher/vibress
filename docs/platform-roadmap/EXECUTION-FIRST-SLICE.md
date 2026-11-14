# First Executable Vertical Slice — Priority and Owner Handoff

> **Proposed plan, not an authorized schedule or code change.** This document prioritizes the **existing 140 Epics** across M00–M12 instead of creating more Epics per audit round. Roles, capacity, deadlines and test results are **unassigned** until approved.

## Practical program gates

**P0 design:** blocks safe introduction of new app identity, data or tenants. **P0 GA:** blocks the public stable v1 release but not controlled local prototypes. **P1:** narrower feature expansion. **Later:** M09–M12, with their own security/release gates.

| Sequence | Proof to complete | Existing work / tracking | Stop/go acceptance evidence | Accountable role (TBD) |
| --- | --- | --- | --- | --- |
| 0 | Architecture and baseline, approve Application vs Publication/Tenant, pin Studio/CMS release data | M00-E02/E04/E07/E12 · [#152](https://github.com/AbdullahZaher/vibress/issues/152) | ADR-PLAT-001/002 accepted, 003 transaction spike reviewed; actual baseline CI/fixture SHA | Architecture + Release |
| 1 | Security prototype for runtime credentials, PostgreSQL permissions, scoped transaction, policies and views | M02-E08/E09/E12/E13 · [#154](https://github.com/AbdullahZaher/vibress/issues/154) | Actual PG role tests: PUBLIC/SECDEF, owner-context views, tenant A/B, nested errors, non-RLS ops | DB + Security |
| 2 | Existing multi-publication CMS mapping and compatibility | M00-E04, M01-E05, M03-E09 · [#153](https://github.com/AbdullahZaher/vibress/issues/153) | Pinned old CMS/Studio fixtures, two publications plus pub_default, safe migration/rollback | CMS + Studio + Data |
| 3 | Independent Task/CRM runtime and app-to-app isolation | M01-E06/E07/E09/E10, M02-E14 · [#153](https://github.com/AbdullahZaher/vibress/issues/153) | Clean boot without publishing-domain imports; DB/Redis/S3 credential denial app A→B | Platform + Security |
| 4 | CRM resource → Postgres/API/Admin + custom end-user web/action | M03-E01/E04/E08; M04-E01/E02/E08/E10 · [#155](https://github.com/AbdullahZaher/vibress/issues/155), [#156](https://github.com/AbdullahZaher/vibress/issues/156) | Actual schema migration, secured REST/typed SDK, admin and custom route with no kernel edits | Schema + API |
| 5 | Trusted Module SDK, durable action/event and CLI clean consumer | M05-E08/E09, M06-E08/E09/E10, M07-E09/E10 · [#157](https://github.com/AbdullahZaher/vibress/issues/157)–[#159](https://github.com/AbdullahZaher/vibress/issues/159) | Packaged external SDK, signed reviewed module, idempotent event, tenant-scoped worker, clean CRM | Plugin + Runtime |
| 6 | Production readiness GO/NO-GO, backup and version-skew | M08-E02/E04/E08/E11/E12 · [#160](https://github.com/AbdullahZaher/vibress/issues/160) | RLS-safe full backup and restore A+B, cross-install credential tests, rolling deploy, external security review | Release + Security + Ops |

## Definition of the first usable product

**Proof A (legacy):** Existing multi-publication CMS survives a verified nonproduction identity mapping and compatibility migration. **Proof B (new):** A clean external CRM runs in its own installation, supports typed custom business logic and end-user web pages without editing the platform kernel. **Proof C (security):** Executable negative tests prove tenant/role/view/transaction and app-installation isolation.

**Do not enable public multi-tenant app hosting** until B+C pass. **Do not approve v1 GA** until A+B+C and the stage-6 independent release review pass. Focused M09–M12 prototypes may proceed separately but are not substitutes for these gates.

## Evidence and governance

Every work item needs an owner, approved decision/ADR, bounded scope, immutable source and CI SHA, database/Studio fixture version, negative test, migration/restore results, risk/exception decision and a linked follow-up PR. Real schedules depend on staffed capacity and demonstrated effort, not arbitrary M/L/XL estimates.

**No new Epic IDs were added for R35–R39.** Map their tests to the existing Epics above; implementation issues can be split further when there is a real owner and acceptance evidence.
