# EXT-507 — Operator-approved Add Plugin and disposable staging acceptance

## Security boundary

Studio's **Add Plugin** is a registration experience, not an executable
upload or package manager. Only a Staff user who is a platform plugin operator
can retrieve the operator-trusted registry and register a reviewed release.
The existing Host reads the signed, operator-owned lockfile and revalidates
the approved manifest server-side. Client-side approval is informational and
never substitutes for Host authorization.

Direct ZIP uploads and arbitrary GitHub URLs are **not accepted**. Vibress
plugins run with Node process privileges; allowing an uploaded archive to be
executed would be a remote-code-execution risk. For source releases, the
operator must fetch a pinned commit outside Studio, review/build it, inspect
dependencies, scan it, approve physical migrations and sign the final release
lockfile with the offline Ed25519 key. See
[the external extension operator runbook](external-extension-operator-runbook.md).

## Registration flow

1. Configure and mount the operator-approved, signed plugin release on every
   API/Worker replica. Validate the signature, final artifact SHA-256 and all
   migration plans using the runbook; do not mount writable upload directories.
2. Apply any approved physical migrations using the maintenance-only consent
   flow **before** the release is activated. Take and verify a signed backup.
3. In Admin → Plugins, the platform operator selects **Add Plugin**. Only
   approved manifests not already registered are listed, with their requested
   capabilities. The operator explicitly acknowledges the request.
4. Press **Register trusted plugin**. This calls only
   `POST /api/admin/v1/plugins/register-trusted`, validated and operator
   authorized server-side; registration does not execute the plugin.
5. Activate the registered plugin separately. Publication enablement remains
   a distinct, scoped action.

Non-operator Staff cannot see the installer and cannot use the server endpoint.
Changing the selected publication closes any open installer and clears pending
choices. The normal /plugins listing and activation remain backward compatible.

## Disposable staging acceptance (manual, NOT evidence of a production deploy)

The staging operator, not the Admin browser, must provision a disposable
PostgreSQL database, three test Members across two test publications, staging
HTTPS origins and isolated operator signing keys. Never reuse production Member
cookies or customer data. Follow the signature and migration commands in the
runbook, then install and register LMS through Add Plugin.

With the **already installed** signed LMS pilot active:

```bash
cd vibress-lms
npm run verify:local
export LMS_HOST_SITE_A='https://site-a.staging.example'
export LMS_HOST_SITE_B='https://site-b.staging.example'
export LMS_HOST_COOKIE_A1='<staging Member A1 cookie>'
export LMS_HOST_COOKIE_A2='<staging Member A2 cookie>'
export LMS_HOST_COOKIE_B1='<staging Member B1 cookie>'
# Remote staging is an explicit opt-in.
export LMS_HOST_ALLOW_REMOTE_STAGING=1
npm run host:acceptance               # Read-only baseline
LMS_HOST_ALLOW_WRITES=1 npm run host:acceptance  # Disposable test Members only
```

Then, in the same running Fastify/API process, repeat the platform-operator
**Deactivate → Activate** cycle three times. Verify:

- The public catalog and authenticated member routes deny requests while
  globally inactive and resume after reactivation.
- Member enrollment and progress remain consistent across deactivation.
- Cross-publication tokens are rejected; wrong-origin writes fail.
- A changed signed release requires runtime restart; tampered files do not run.
- Database backup and restore recover plugin migration ledger and Member
  records, with matching signed release bytes.

Finally repeat on a multi-replica disposable deployment, during an approved
rolling upgrade, and with a full service restart and restore. Track successful
commands, HTTP statuses and timestamped logs without collecting credentials.
**No staging test has been executed by this documentation change.**

## Boundaries / next milestone

EXT-507's initial Admin registration workflow does **not** support ZIP or GitHub
installation, automatic physical migrations, LMS course authoring or a production
release. These require separate trusted build/approval and backward-compatible
LMS content models, Staff authorization, publication-scoped APIs and bilingual
RTL UI. Do not mark the LMS MVP complete based on this change.
