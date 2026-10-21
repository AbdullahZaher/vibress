# Operator runbook: external plugin releases and recovery

**Trust boundary.** Vibress supports only operator-reviewed, SHA-256-pinned
ESM bundles. There is no isolation of malicious Node modules. JavaScript
extensions run with the privileges of the process and are not safe to
install from arbitrary publishers. A trusted plugin installed globally is
**not** automatically enabled for any publication.

## Preflight and deployment

1. Review and build the source in an isolated reproducible environment.
   Inspect dependencies and licenses and scan the final package.
2. Compute the SHA-256 of the **final .mjs bytes** and each reviewed Admin UI
   HTML document. Pin them in a `schemaVersion: 1` operator lockfile.
   Keep the lockfile outside writable upload paths and protect it from
   non-operator modifications. Never embed secrets into artifacts.
3. Deploy identical release bytes to each API replica. Check the exact
   release on **every replica** before traffic or plugin enablement:

   ```bash
   VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/absolute/path/trusted-plugins.json \
     pnpm exec tsx scripts/plugins/preflight.ts
   ```

   A nonzero exit rejects the release; this check does **not** import or
   execute plugin code. The runtime independently checks the digest before
   each new load. The example extension source and conformance test are
   located in `examples/plugins/hello-public`.
4. Back up PostgreSQL and persistent storage with the existing signed backup
   procedure. Save an operator-controlled snapshot of the **matching**
   lockfile, package bytes and encryption key outside the CMS content tree.
   These operator-mounted files may not be part of the database backup and
   require separate custody. Never copy secrets into documentation or logs.
5. Register the operator-approved manifest and explicitly enable the plugin
   for each intended publication. Test A and B separately. Confirm Staff
   permissions, private-site password, published locales, RTL and theme
   fallback; do not infer publication enablement from global activation.
6. Verify the public scalar route and Studio iframe from outside the API
   container through the actual TLS proxy. Monitor errors, startup and
   denied-read counters; external CDN/WAF/proxy logs must redact single-use
   frame-ticket query parameters.

## Upgrade and rollback

- Before any version change: verify the SDK ABI, verify the release is
  compatible with **existing stored plugin data**, snapshot the database,
  confirm the exact same operator bytes are staged on all nodes, then
  quiesce new plugin admissions while changing versions.
- Do not rewrite old migrations or downgrade data schemas automatically.
  If the plugin data schema changed incompatibly, use a reviewed forward-fix
  migration or restore the consistent snapshot; never assume an older
  plugin can read a newer database.
- To disable a compromised release, revoke publication enablement first,
  deactivate the global plugin according to the existing lifecycle, and
  remove its operator approval. Drain in-flight work and rotate any
  implicated secrets according to the operator's incident policy.
- Re-run the preflight and runtime/tenant/locale matrix after any restore.
  Confirm older content and historical settings are preserved.

## Failures and known release blockers

| Condition | Required action |
| --- | --- |
| Digest mismatch / symlink / absent file | Refuse activation and repair the release mount; never skip verification |
| Redis unavailable | Deny interactive iframe tickets and restore the shared Redis service |
| Publication permission revoked | Remove active iframe, block future public/member/Staff bridge calls |
| Private-site settings unavailable | Fail closed; do not serve cached public data from another publication |
| Worker retry / duplicate event | Do not perform non-idempotent mutations until EXT-401 durable task admission is implemented |
| Secret rotation / audit | Continue using explicit encrypted publication settings; EXT-402 rotation/audit verification is a separate release gate |
| Destructive uninstall | Preserve plugin-owned content until separately backed up and explicitly purged under a reviewed workflow |

**Release status:** The EXT-302B locale/SEO policy, EXT-303 theme extension
slot, EXT-304 reference SDK sample, and a preflight for EXT-404 are implemented
as separate changes on a review branch. This is **not** proof that
EXT-401 durable worker jobs, EXT-402 rotation, EXT-403 backup automation,
full EXT-404 attestation, or EXT-501–504 LMS pilot/release gates are complete.
Those features still require code, live testing and signed-off release reviews.

Never weaken Staff/Member authorization, tenant scoping, encryption, signed
backups or test coverage to achieve an accelerated rollout.
