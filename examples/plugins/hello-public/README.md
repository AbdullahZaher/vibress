# Hello Public — independent Plugin SDK reference

This is a source-only example of the **public `@vibress/plugin-sdk` contract**.
It does not need or import Vibress's private database, Fastify, Web, themes,
worker, or domain packages. The operator must review the package before use.

## Build and operator pinning

Build from the Vibress repository toolchain (or from an independent project
with the public SDK types installed):

```bash
pnpm exec esbuild examples/plugins/hello-public/src/index.ts \
  --bundle --platform=node --target=node24 --format=esm \
  --outfile=dist/index.mjs
shasum -a 256 dist/index.mjs
```

The **final `dist/index.mjs` bytes**, not the source tree or a self-declared
manifest checksum, must be pinned by the operator in a v1 lockfile using the
existing `schemaVersion: 1` format. Its `manifest.entrypoint` is
`dist/index.mjs`. Deploy identical approved bytes on every API replica.
The operator may verify the artifact on each node using:

```bash
VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/absolute/path/trusted-plugins.json \
  pnpm exec tsx scripts/plugins/preflight.ts
```

After verification, install/register the approved manifest and explicitly
enable it for each intended publication. Installation never means automatic
enablement. Do not copy another publication's settings, Member data, or secrets.

## Contributions

- Public view `/extensions/hello-public/overview`: a read-only, scalar
  projection from the Host-scoped `summary` GET route, with explicit
  English and Arabic published variants.
- Studio navigation `status` links to a Staff-permission checked Admin GET.
- Optional linked Admin POST route with its **own** `plugins.manage` permission
  and bounded scalar schema demonstrates the confirmed write-bridge contract.
  It is intentionally an echo/acceptance example, not persistent storage.
- No runtime API fetch from browser JS, no cross-publication selectors, no
  private import, and no publication-wide secrets in the public projection.
- External Liquid themes may opt in to `templates/extension.liquid`;
  other themes get the semantic RTL-aware Host fallback.

## Validation

`tests/integration/external-plugin-reference-contract.test.ts` builds
the example as a self-contained ESM file in memory, asserts the SDK manifest
and routes, the per-request Host locale scope, and lifecycle compatibility.
It intentionally does not install a package into a real production database.

**Not a course/enrollment backend, credential store, Member LMS implementation,
worker queue, marketplace, signature attestation, or general executable
untrusted sandbox.** Do not represent the example as proof those features ship.
