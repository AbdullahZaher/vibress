# P0-3 — Secure operator release admission

**State:** Implemented on branch `feat/plugin-platform-trust-catalog-20261024`; focused tests added, full CI/replica drills not yet verified. This is an **operator** workflow, not a staff-accessible or plugin-SDK API. Compatible with existing `schemaVersion: 1` lockfiles: the **old runtime preflight** still accepts operator-controlled unsigned legacy installations when policy allows, but the **new admission command** intentionally refuses to certify unsigned packages.

## Trust boundaries

- The operator reviews/builds all code in a separate disposable build environment, not in API or Worker containers. No `npm install`, ZIP extraction, source cloning, `eval` or `import()` is ever triggered by the admission checker.
- Downloading or copying an external ZIP/repository is a separate **untrusted source acquisition step**. Never deploy it directly. Inspect full dependency tree, licenses, declared postinstall hooks, native modules, credentials and malicious sources before making a standalone reviewed `.mjs` bundle. Review/scan the **final staged bytes** and retain the scanner results; a pinned SBOM/provenance JSON document is evidence, not proof of safety.
- The operator keeps the detached Ed25519 private key **outside** the stage, runtime images and uploaded content. Store only the public key, detached signature and SHA-256-pinned lockfile/artifacts on read-only runtime mounts; a plugin cannot nominate a trust root.
- The new admission gate requires **all** approved plugins in that lockfile to have versioned `release` metadata plus SHA-256-pinned, valid JSON-object SBOM, provenance and operator security-review report. Storage models must have one or more pinned migration plans. Preflight verifies the plan IDs and their **actual contents** against the exact approved plugin version, artifact digest and physical storage schema. Applying a migration remains a separate, authorized operator action.
- A signature proves this operator approved the exact lockfile bytes. It does **not** certify the publisher, execute vulnerability scanning or sandbox a trusted JavaScript module. Operator-supplied SBOM and provenance claims must be reviewed independently.

## Staging (offline, before deployment)

1. Build and inspect in a disposable non-production environment. Run dependency/license and supply-chain scanners (e.g. Trivy with an up-to-date vulnerability database) on the untrusted source and staged artifacts; stop on unresolved critical/high findings, report exceptions explicitly and have a human operator approve any exception. Do not treat the CLI itself as a vulnerability scanner.
2. Stage the reviewed self-contained `.mjs` bundle and optional UI assets outside uploads and persistent CMS content. Generate the P0-2 `release` metadata with exact SHA-256 checksums, plus schema-bound physical migration plans when storage is requested. SBOM/provenance content must be valid UTF-8 JSON objects. Do not put any secrets in evidence.
3. Produce a separate `securityReview` evidence document using the same local JSON path/digest structure as SBOM. Its **operator-reviewed** JSON must declare `schemaVersion: 1`, `artifactSha256` (the compiled ESM digest), `reviewer`, `scanner`, `scannedAt` (offset-aware ISO timestamp), `criticalFindings: 0`, `highFindings: 0`, and `decision: "approved"`. Pin its SHA-256 under `release.securityReview`. This is a signed review assertion, **not proof that the scanner ran**; retain signed raw scan logs in private operator custody and never trust plugin-produced reports.
4. Sign **the exact final lockfile bytes** with your operator Ed25519 private key using the [existing signing procedure](external-extension-operator-runbook.md#optional-signed-release-approval-ext-404-additive). Do not sign before the last edit.
5. Independently pin the trusted Ed25519 **SPKI DER** public key fingerprint in operator deployment configuration. Compute it outside the plugin release mount and compare against your known authorized key:
```bash
openssl pkey -pubin -in /operator-secure/operator-public.pem -outform DER | shasum -a 256
```
Point an isolated operator-only process at the staged immutable directory:

```bash
export VIBRESS_TRUSTED_PLUGIN_LOCKFILE=/absolute/release/trusted-plugins.json
export VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE=/absolute/release/operator-public.pem
export VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE=/absolute/release/operator.sig
export VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1
export VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256='<verified-64-hex-SPKI-DER-digest>'

pnpm exec tsx scripts/plugins/admit.ts > /operator-secure/admission-receipt.json
```

A successful command prints **one JSON object** with `schemaVersion`, `lockfileSha256`, `publicKeySha256`, `signatureVerified: true`, and verified release IDs/versions/SHA-256. It prints no operator file paths, credentials, content or member data. A nonzero exit must stop the rollout; never override the verifier or change signed metadata to match unreviewed code.

## Deployment and replica consistency

1. Back up DB, Redis queue state, CMS assets and exact operator-controlled release snapshot. Build the production API and Worker images and mount the **same read-only release directory** through `compose.plugins.yml` **plus the new opt-in `compose.plugins.strict.yml` override**. Do not silently add strict validation to an existing legacy installation before reviewing and staging its metadata. For each host, copy the matched snapshot to a protected immutable location first.
2. Read `lockfileSha256` from the offline receipt and pass **that same expected SHA-256** to both image checks. Example with the existing production Compose project environment:

```bash
export VIBRESS_PLUGIN_RELEASE_DIR=/srv/vibress/operator-plugins
export VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256='<verified-64-hex-SPKI-DER-digest>'
export VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256='<64-hex-sha256-from-offline-receipt>'
docker compose -f compose.prod.yml -f compose.plugins.yml -f compose.plugins.strict.yml build api worker
docker compose -f compose.prod.yml -f compose.plugins.yml -f compose.plugins.strict.yml \
  run --rm --no-deps --entrypoint node api \
  dist/plugins-admit.js --expected-lockfile-sha256 "$VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256"
docker compose -f compose.prod.yml -f compose.plugins.yml -f compose.plugins.strict.yml \
  run --rm --no-deps --entrypoint node worker \
  dist/plugins-admit.js --expected-lockfile-sha256 "$VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256"
```

Run those checks on **each physical/virtual replica**, not only once against shared CI artifacts. Each check re-authenticates the signature and independently verifies its own mounted ESM, UI, evidence and migration-plan bytes. The receipt proves that observed lockfile and files were valid **at verification time**; it does not lock the filesystem or guarantee an atomic cluster rollout. Keep immutable mounts until the coordinated rollout/restart is completed.

3. For updates **first** disable affected publication delivery, drain/deactivate the **old active plugin while its old signed lockfile is still mounted**, and safely quiesce Worker/API replicas. Only then replace the operator-owned approved snapshot in all replicas, deploy/restart API and Worker against the new identical snapshot, review/install approved schema migrations through the existing controlled DB process, and register/activate the new plugin globally. Never hot-swap a signed lockfile under an active module: the Host intentionally refuses mismatched release deactivation, and you may need isolated operator recovery. Enable it individually for authorized publications. Do not advance while workers still run the previous ABI/release.
4. Verify API and Worker startup, queue retry/idempotency and publication isolation; monitor failed events and metrics. A mismatched replica, failed signature, invalid scanner finding or migration conflict blocks deployment.

## Failure and rollback

- Missing signing key/signature, unknown operator key fingerprint, unsigned lockfile, malformed JSON evidence, missing/failed security review, changed artifact, missing/mismatched plan or wrong expected SHA causes the checker to exit nonzero without executing plugin code or DB mutations.
- A rollback requires restoring the matching full signed operator release directory to **all** replicas and examining any already-applied DB migrations; do not assume migration rollback is reversible.
- A long-running cluster cannot be made atomic by a digest comparison alone. Automatic staged distribution, fleet-wide barriers, coordinated traffic draining and recovery are separate P0-4/P1 deliverables.

## Explicitly not included

No remote download or ZIP parser, no dependency-scanner engine, no automatic private key generation, no registry publishing, no direct browser installation, no out-of-band server executor, no automatic migration application, no sandbox for malicious Node ESM, and no automated deployment scheduler. These steps must not be claimed as implemented by the verifier.
