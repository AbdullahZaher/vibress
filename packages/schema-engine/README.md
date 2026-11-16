# @vibress/schema-engine — M03-S01

This package contains the **first pure Resource DSL and Canonical Schema IR slice** for the Universal Platform. It has no SQL generator, DDL executor, persistence, registry, API endpoint, privileged DB handle or publishing-domain dependency.

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
