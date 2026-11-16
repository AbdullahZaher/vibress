# @vibress/schema-engine — M03-S01 and M03-S02

This package contains the **first pure Resource DSL and Canonical Schema IR slice** for the Universal Platform. It has a pure, non-executing PostgreSQL 16 structured planner but no SQL generator, DDL executor, persistence, registry, API endpoint, privileged DB handle or publishing-domain dependency.

## Trusted CRM usage

```ts
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import { defineResource, compileResourceSchema, serializeCanonicalSchemaIR } from "@vibress/schema-engine";

const scope = {
  applicationId: asApplicationId("customer-crm"),
  installationId: asInstallationId("crm-local"),
}; // resolved from trusted server-side configuration, NOT client-supplied authority

const customers = defineResource({
  id: "customers",
  ...scope,
  ownership: "tenant",
  fields: [
    { id: "name", type: "text", required: true },
    { id: "status", type: "enum", required: true, values: ["lead", "active"], default: "lead" },
    { id: "active", type: "boolean", required: false, default: true },
  ],
});
const ir = compileResourceSchema([customers], scope);
const canonicalJson = serializeCanonicalSchemaIR(ir);
```

## Contract and security boundaries

- `schemaVersion: 1`; resources and fields sorted by identifier; enum values sorted; UTC timestamps normalized; deterministic JSON and SHA-256 digest.
- All definitions explicitly declare **application**, **installation** and row **ownership** semantics. `tenant` means future rows must be scoped using a verified tenant context; there is deliberately no schema-level tenant ID and no per-tenant table provisioning.
- The v1 deployment topology is **one Application per Installation**, with a dedicated DB boundary. Application/Installation IDs on the IR describe provenance, not permission grants or a requirement to duplicate those columns on every physical table.
- A relation may only reference another declared resource **inside the same compilation**, in the same installation and with the same ownership kind. Cross-scope joins, self-relations, cascade options, raw SQL, computed defaults, expressions, indexes and DDL are intentionally unsupported.
- Defaults are **data literals**. Text such as `NOW(); DROP TABLE ...` is inert data and must never be interpolated into future SQL. Datetimes require a fixed ISO UTC literal; `now()` is not accepted.
- Persisted IR is revalidated and required to be canonical. **This is validation, not authenticity or authorization.** A future operator-owned, versioned registry must authorize authors, bind the IR to trusted installation identity, verify digests and perform policy checks before any migrations are planned.
- Future M03 migrations must remain a separately authorized, reviewable operator workflow with strict namespace reservations, lock/drift detection, RLS/privilege checks and compatibility/rollback strategy. No production migration is introduced by this slice.

## Local checks

```sh
pnpm --filter @vibress/schema-engine typecheck
pnpm --filter @vibress/schema-engine lint
pnpm --filter @vibress/schema-engine test
pnpm --filter @vibress/schema-engine build
pnpm --filter @vibress/platform-kernel test
pnpm --filter @vibress/tenancy test
```

Existing CMS, Studio, theme and plugin contracts are untouched.

## M03-S02 — deterministic change plans (PostgreSQL 16)

Use the trusted CRM fixture from src/fixtures/crm.ts. No database is needed:

~~~ts
import { crmPlanningExample } from "@vibress/schema-engine/src/fixtures/crm";
// In-repo fixture import only. Production consumers use the public exports below:
import {
  createSchemaManifest, parseSchemaManifest, planSchemaChanges,
} from "@vibress/schema-engine";

const { initialIr, initialManifest, initialPlan, additivePlan } = crmPlanningExample();
const roundTrip = parseSchemaManifest(JSON.parse(JSON.stringify(initialManifest)));
// initialPlan creates customers + deals and REQUIRES_REVIEW.
// additivePlan adds activities (review) and an optional customers.website (PLANNED).
// roundTrip.digest == initialManifest.digest, but this is NOT proof of registry trust.
~~~

The manifest version is 1, explicitly compatible with Canonical IR version 1.
It stores app/installation identity, a canonical IR snapshot and digest, deterministic
compiler-owned physical table-name hints, field types and PostgreSQL mappings,
ownership prerequisites, and its own SHA-256 checksum. Imported manifests
are strictly revalidated and reconstructed: unknown properties, symbols, accessors,
non-enumerable properties, oversized inputs, reordered records and stale hashes
fail closed. **Checksums prove consistency, not signing or provenance.**

The plan version is 1, targets PostgreSQL 16, and includes an expected current
manifest digest (null denotes the expected absent manifest), proposed digests,
full expected/next field or resource states, stable operation identifiers, ordered
operations, and mandatory *future executor* preconditions. This does not inspect
a live database; only a separately authorized operator can verify catalog drift,
namespace collisions, installation identity, RLS/ACL and privileged DDL rights.

| Change | Classification | Reason |
| --- | --- | --- |
| New resource, scalar fields | REQUIRES_REVIEW | Table creation, namespace, grants, tenant RLS and required-field policy are not implemented |
| Optional scalar field without default | PLANNED (operator approval still required) | Safe additive logical shape, not an executable DDL statement |
| Required field, literal DB default, enum field | REQUIRES_REVIEW | Backfill, locking or enum constraint enforcement needed |
| Relation / foreign key creation | UNSUPPORTED | No scoped key or FK generation in this slice |
| Drop resource/field, ownership change, type or relation target rewrite | DENIED | No destructive or security-weakening transitions |
| Other existing-field edits | REQUIRES_REVIEW | Changed constraint/default/nullability requires independent analysis |
| Unchanged definition | NO_CHANGES | No operations emitted |

Plan disposition is BLOCKED if any operation is DENIED or UNSUPPORTED, otherwise
REVIEW_REQUIRED if any operation needs review, PLANNED for optional scalar additions,
or NO_CHANGES. All operation statuses are **non-executing**. A planner caller cannot
provide untrusted SQL fragments or authorize privileged database mutations.

Future M03 migration execution MUST obtain a separately authenticated and approved
registry manifest; compare the expected digest and **actual database catalog**
under an operator-only installation role; verify runtime privilege contract and
effective tenant RLS (including FORCE where needed), then acquire migration fencing
and enforce lock budgets and idempotent operation journal. It must halt if any
required check fails and must never infer a rename or execute BLOCKED/REVIEW_REQUIRED
work without explicit independent policy approvals. This package implements none
of those privileged steps. App or tenant fields are not automatically materialized
into every resource table in the one-app-per-installation topology.

Focused checks: run the existing package typecheck, lint and test commands above.
CRM reference and adversarial planning tests live in src/__tests__/planning.test.ts.
Existing CMS, plugin, theme, worker, tenancy and migration contracts are unchanged.
