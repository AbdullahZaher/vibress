# R40 — release/version identity decision record

> **Status: UNRESOLVED. Recommendation only. No version, package metadata,
> changelog or git tag was changed by this record.**
>
> Date: 2026-11-14. Owner: release/architecture owners (unassigned; see §7).

## 1. Finding

R40 reports that release identity is ambiguous: the workspace, the framework
packages and the reference app all declare `1.2.0`, while the latest host release
is a beta (`v1.2.0-beta.2`) and no GA `v1.2.0` tag exists. Calling the platform
work "Framework 1.2.0 GA" therefore conflates three different things:

1. a **host product release** (git tag on the CMS/Studio application),
2. a **framework package version** (`@vibress/platform-kernel`,
   `@vibress/tenancy`, `@vibress/database`),
3. a **kernel contract version** used by application manifests
   (`kernelRange` compatibility), currently `^1.2.0`.

## 2. Measured facts (2026-11-14, read-only)

| Artifact | Value | Public? |
| --- | --- | --- |
| Latest git tag | `v1.2.0-beta.2` (2026-11-09); also `v1.2.0-beta.1`, `v1.1.0` | yes (tag) |
| GA `v1.2.0` tag | does not exist | — |
| Root workspace `package.json` | `vibress-monorepo` `1.2.0`, `private: true` | no |
| `@vibress/platform-kernel` | `1.2.0`, `private: true`, no `publishConfig` | no |
| `@vibress/tenancy` | `1.2.0`, `private: true`, no `publishConfig` | no |
| `@vibress/database` | `1.2.0`, `private: true`, no `publishConfig` | no |
| `@vibress/platform-reference` | `1.2.0`, `private: true` | no |
| `@vibress/plugin-sdk` | `1.2.0`, `private: true` | no |
| Kernel default contract version | `"1.2.0"` in `packages/platform-kernel/src/registry.ts` (default argument) and `apps/platform-reference/src/server.ts` | code |
| Reference app policy version | `reference-crm-1.0.0` (independent axis) | code |

The baseline table in
[BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md) already records
`v1.2.0-beta.2` and root `1.2.0`; R40 is the unresolved question of how those
identities should relate, not a discovery that the versions differ.

## 3. Why it matters

- **Release claims.** A GA claim requires a tag, a changelog, supported-install
  artifacts and a support window. None exist for `1.2.0`; the tag line is beta.
- **Consumer pinning.** Workspace packages are private and unpublishable as-is
  (no `publishConfig`, no registry metadata). A document that tells a consumer to
  install `@vibress/platform-kernel@1.2.0` would point at nothing.
- **Contract compatibility.** `kernelRange` is checked against the kernel's
  `"1.2.0"` default. Renumbering the contract changes the serialized manifest
  and therefore its digest, which the persisted registry treats as drift and
  refuses without a reviewed update.
- **Provenance.** If the same `1.2.0` later denotes a published framework, an
  operator cannot tell from a number alone whether a deployment used the
  pre-GA internal build or the published package.

## 4. Options

### Option A — keep `1.2.0` as an internal label; ban GA language

All packages stay private at `1.2.0`; host release identity stays the git tag
line (`v1.2.0-beta.N`, then a real GA tag when approved). Documentation states
explicitly that framework `1.2.0` is internal and not a release.

- Effort: documentation only.
- Risk: the number still looks like a release; a future reader can repeat the
  conflation. Nothing prevents an accidental public publish of a private
  package, but `private: true` blocks it.
- Authorization: none beyond documentation ownership.

### Option B — two-axis identity (recommended)

Separate **host release** from **framework contract**:

- host release: git tags, unchanged (`v1.2.0-beta.N` until a GA decision);
- framework: private packages keep a distinct pre-GA version line
  (for example `0.1.0` or `1.0.0-preview.N`) and the kernel contract version is
  derived from that line, not from the host release;
- manifests record the contract version; the reference app passes it explicitly
  instead of relying on a hard-coded default.

- Effort: version metadata plus kernel default and reference-app wiring; one
  registry update at the next deployment because the manifest digest changes;
  tests updated.
- Benefit: a deployment record can answer both "which host release?" and
  "which framework contract?" without inference.
- Risk: the digest change must go through the documented
  [drift/update procedure](PLATFORM-BOOT-REGISTRY-RUNBOOK.md#5-deliberate-manifest-change-drift-procedure);
  a pre-GA number may itself need a policy for breaking changes.
- Authorization: version/package metadata changes and release process belong to
  the release owner; this record does not apply them.

### Option C — publish a real GA `1.2.0`

Tag `v1.2.0`, add `publishConfig`/provenance, publish the framework packages,
and define support and deprecation policy.

- Effort: release engineering, supply chain, documentation and support.
- Risk: commits the project to external compatibility guarantees before the
  independent security review and Wave 1 GO. It would also make the current
  kernel contract hard to change.
- Authorization: **explicit release approval required**; outside Wave 1.

## 5. Recommendation

Adopt **Option B**, staged:

1. **Now (documentation):** until the release owner decides, describe `1.2.0`
   as an internal pre-GA identity and never as "Framework 1.2.0 GA". This is
   Option A behavior while B is decided.
2. **Before any external framework publication:** assign the framework a
   distinct version line and make the kernel contract version explicit in the
   reference app and manifest; update tests and the persisted registration via
   the reviewed drift procedure.
3. **Only with release approval:** execute Option C.

Do not combine the version-line change with unrelated security work; it changes
manifest digests and should have its own deployment record.

## 6. What this record does not do

- No `package.json` version, `private` flag or `publishConfig` was edited.
- No git tag was created, moved or deleted.
- No changelog or release note was rewritten.
- The kernel default `"1.2.0"` and the reference app's `"1.2.0"` remain as they
  are on the branch.
- No package was published.

## 7. Decision and sign-off (unassigned)

| Decision | Owner role | Status |
| --- | --- | --- |
| Accept Option A, B or C | Release owner | **UNSIGNED** |
| Framework version line and support policy | Architecture owner | **UNSIGNED** |
| Kernel contract versioning and digest migration | Platform owner | **UNSIGNED** |
| Publication/provenance approval (only for C) | Release/security owner | **NOT REQUESTED** |

Named humans are not assigned here. The status remains **Unresolved** in
[PROGRAM-EXECUTION-STATUS.md](PROGRAM-EXECUTION-STATUS.md) until the release
owner signs a decision.

## 8. Closure criteria

R40 can move to Resolved when:

1. one option is signed by the release owner;
2. documentation uses one identity per axis and contains no GA claim without a
   GA tag;
3. if B or C is chosen, the kernel contract version is explicit, manifests are
   migrated through a reviewed registry update, and the audit row records the
   digest change;
4. if C is chosen, the tag exists and the published artifacts resolve.
