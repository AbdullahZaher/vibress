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

### PLUG-OPS-01 multi-replica receipt comparison (offline acceptance)

For the **two-API, two-Worker** acceptance drill, run the existing `dist/plugins-admit.js` inside **each actual replica/image** against its local read-only operator release mount, using the same externally pinned expected lockfile and signer fingerprints. Save its stdout as four distinct JSON receipts in operator-only storage outside plugin writable paths. The evidence must originate from each replica independently; copying the same receipt four times is not an acceptable operational drill.

From a trusted operator workstation with the same environment pins:

```bash
export VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256='<operator-approved-SPKI-SHA256>'
export VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256='<operator-approved-lockfile-SHA256>'
pnpm exec tsx scripts/plugins/check-replica-receipts.ts \
  api:api-a=/operator-secure/api-a.json \
  api:api-b=/operator-secure/api-b.json \
  worker:worker-a=/operator-secure/worker-a.json \
  worker:worker-b=/operator-secure/worker-b.json
```

The read-only comparator rejects unsigned/malformed receipt data, duplicate replica labels, fewer than two distinct API or Worker labels, mismatched artifact summaries, trust roots, or lockfile digests. Nonzero exit **blocks rollout**; it never executes a plugin, changes database state, or automatically recovers a deployment. It prints only aggregate counts and pinned public digests. The tool **compares assertions**, and cannot prove that four receipt files were actually produced on four different hosts or that a replica stayed unchanged after checking. Independently retain the signed operator review, raw scanner output, replica identity/command logs and original admission results. Keep mounts immutable, complete draining/restart checks, and obtain operator sign-off before calling the fleet drill accepted.

3. For updates **first** disable affected publication delivery, drain/deactivate the **old active plugin while its old signed lockfile is still mounted**, and safely quiesce Worker/API replicas. Only then replace the operator-owned approved snapshot in all replicas, deploy/restart API and Worker against the new identical snapshot, review/install approved schema migrations through the existing controlled DB process, and register/activate the new plugin globally. Never hot-swap a signed lockfile under an active module: the Host intentionally refuses mismatched release deactivation, and you may need isolated operator recovery. Enable it individually for authorized publications. Do not advance while workers still run the previous ABI/release.
4. Verify API and Worker startup, queue retry/idempotency and publication isolation; monitor failed events and metrics. A mismatched replica, failed signature, invalid scanner finding or migration conflict blocks deployment.

## PLUG-OPS-05 — signer rotation and revocation (bounded operator policy)

`VIBRESS_TRUSTED_PLUGIN_REVOKED_PUBLIC_KEYS_SHA256` is an **optional**
operator-controlled comma-separated list of at most 32 lowercase SHA-256
fingerprints of **SPKI DER Ed25519 signing public keys**. Each entry must be
exactly 64 hexadecimal characters. Missing policy retains legacy compatibility;
an explicitly malformed/empty list, duplicate, unknown format, or a revoked
current signer fails the attestation check closed. When a denylist is configured,
an unsigned lockfile is also rejected. The verifier reads this policy from
**operator environment only**, not from the plugin bundle or catalog.

This environment variable is **not automatically propagated** by Compose.
For a strict self-hosted deployment with at least one revoked signer, add the
opt-in `compose.plugins.signer-revocation.yml` override **after**
`compose.plugins.strict.yml`. It injects the independently managed denylist
into **both** API and Worker and rejects a missing/empty operator setting at
Compose-render time:

```bash
export VIBRESS_TRUSTED_PLUGIN_REVOKED_PUBLIC_KEYS_SHA256='<revoked-SPKI-DER-sha256>'
docker compose -f compose.prod.yml -f compose.plugins.yml \
  -f compose.plugins.strict.yml -f compose.plugins.signer-revocation.yml config --quiet
# Use --quiet: printing resolved Compose config can expose deployment secrets.
# After quiescence, repeat the same full -f sequence on every deploy and
# verify the denylist is present inside every actual API/Worker process.
```

**Do not** put private signing keys in Compose or release directories. A
revoked signer policy configured only in an operator shell, or omitted from
an API/Worker replica, does not enforce revocation in that replica.

Rotation and revocation have different operational semantics:

1. Obtain a separately reviewed replacement Ed25519 public/private key pair
   in offline operator custody. Never distribute the private key to API,
   Worker, plugins, CMS storage or container images.
2. Stage the **same independently reviewed immutable release bytes** with a
   newly signed lockfile, preserving the operator's recorded SBOM, provenance,
   security review and compatible migrations. Compute the new SPKI fingerprint
   and complete the strict admission check before changing the live fleet.
3. Quiesce **all** API and Worker replicas, disable plugin traffic and drain
   durable event queues. In the coordinated release snapshot update, change
   `VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE`,
   `VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE`,
   `VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256` and
   `VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256` together. Include the
   compromised/retired signer in
   `VIBRESS_TRUSTED_PLUGIN_REVOKED_PUBLIC_KEYS_SHA256`. All four runtime
   admission receipts must agree on the new signer/digest.
4. Independently test the **old valid signature + old signer + old lockfile**
   against the new denylist: it MUST fail. Test missing/malformed policy,
   a wrong new signer and mixed-key replicas as separate go/no-go cases.
   Never waive signature or clear revocation policy as a repair.
5. Restore only the new fully approved snapshot. **Rollback must be signed
   again by an allowed signer**, and must respect already-applied DB migrations
   and immutable plugin event receipts. A valid but revoked old signature is
   not a safe rollback artifact. Record operator sign-off and exact CI/deploy
   evidence before restoring traffic.

The denylist is **configuration-based fencing**, not a centralized durable
revocation service. A restored or compromised deployment that omits the
denylist can reauthorize old trust; preserve this policy in protected,
independently backed-up operator configuration, and verify it on every
replica after restoration. Rotation is not cluster-atomic by itself.

## PLUG-OPS-05 — key-versioned AES-GCM plugin secrets (opt-in)

The signing keyring above is **not** the secrets encryption keyring. Current
installed secrets use the original `VIBRESS_ENCRYPTION_KEY` AES-256-GCM
`v: 1` payload. That format has no key identifier. To migrate existing
plugin settings safely, the Host now supports **additive** `v: 2` envelopes
with a `kid` (key ID) and AES-GCM additional authenticated data binding the
key ID and ciphertext to the exact plugin ID, publication ID (when scoped),
and setting key. These are private encrypted settings, not SDK-visible values.

By default both plugin settings tables still write and read v1 exactly as
before. To **opt in**, set these variables for **every** API and Worker
instance after deploying the v2-capable binaries:

- `VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID`: 1–32 ASCII letters/digits/`_`/`-`.
- `VIBRESS_PLUGIN_SECRET_KEYS_JSON`: JSON object of 1–16 named **independent,
  randomly generated 32-byte keys** as 64 hexadecimal characters each.
  Keep the active key and every older still-in-use v2 key in this ring.
  A missing/invalid/partially deployed keyring fails closed.
- Keep the **original** `VIBRESS_ENCRYPTION_KEY` unchanged for all legacy v1
  ciphertext and unrelated CMS integrations throughout migration.

Do **not** reuse the Ed25519 signing key or derive the new AES keys from the
old installation key. Never commit the JSON keyring, put it in URLs, give it
to plugins, or print resolved Docker Compose configuration (use
`docker compose ... config --quiet`). Operator-managed environment or
secret-management facilities must provide the same protected keyring to all
replicas. Compose environments can be inspected by authorized Docker
administrators; harden operator access accordingly.

Add the **optional** `compose.plugins.secret-rotation.yml` override only
after all Host images support v2. A database holding v2 ciphertext **cannot**
be used with older Host binaries that only understand v1, even when you still
possess the keys. The rollout order and tested rollback image are part of the
migration approval.

### Resumable offline migration procedure

1. Take and authenticate **PostgreSQL + Redis + storage + release** backups,
   with a separately protected copy of the old encryption key **and** the
   complete new keyring. Verify restoration on a populated disposable clone.
2. Upgrade API and Worker binaries to v2 readers on **every** replica
   without initially enabling new keyring writes. Verify legacy v1 reads.
   Quiesce API/Worker replicas and all writers for migration; the maintenance
   env flags below do **not** prove the fleet is actually stopped.
3. On the isolated clone, configure both legacy and new keys and the active
   key ID. Run the **read-only** preflight, which decrypts and authenticates
   every existing plugin secret before reporting aggregate counts:

   ```bash
   export VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1
   export VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE=1
   # VIBRESS_ENCRYPTION_KEY, VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID and
   # VIBRESS_PLUGIN_SECRET_KEYS_JSON are supplied privately by the operator
   pnpm exec tsx scripts/plugins/rotate-secrets.ts
   ```

4. When preflight passes, explicitly approve the same protected snapshot and
   run the idempotent migration on the **isolated clone first**:

   ```bash
   export VIBRESS_PLUGIN_SECRET_ROTATION_APPLY=1
   pnpm exec tsx scripts/plugins/rotate-secrets.ts --apply
   pnpm exec tsx scripts/plugins/rotate-secrets.ts
   ```

   The final dry-run must report `needed: 0`. The migration kernel enforces
   maintenance and write-approval guards independently of the CLI. It is
   regression-tested against **actual seeded PostgreSQL fixtures**, including
   interrupted partial application/resumption, stale ciphertext CAS, invalid
   data, key rollover and wrong publication identity; this is not a completed
   live production DR drill. The script traverses both
   `plugin_settings` and `plugin_publication_settings` in bounded ID order
   (default maximum 100,000 secret rows; `VIBRESS_PLUGIN_SECRET_ROTATION_SCAN_LIMIT`
   can lower this ceiling). It updates each ciphertext using an exact-row
   owner/scope **compare-and-swap**, so concurrent replacements/revocations
   fail rather than being overwritten. Batch failure is safely resumable with
   the same ring; it never changes permissions, creates secret rows or
   exposes member IDs, raw values, ciphertext or key names in output.
5. Repeat the approved procedure on the quiesced production snapshot,
   re-run dry-run and validate normal authorized plugin `getSecret` reads,
   publication boundaries and old global bundled plugins. Capture **counts
   only** in operator audit records, plus masked test outcomes and run/commit
   provenance. New writes use the active v2 key only after all replicas have
   the new keyring; no key is automatically deleted.
6. For another key rotation, add the next key to the ring on **all** replicas
   first, advance active ID, quiesce writers and re-run migration, check
   `needed: 0`, test a backup restore, then explicitly approve removal of
   old v2 keys. Removing a key early is irrecoverable without restoring it.
   Keep the original v1 key until **all other CMS ciphertext consumers**
   have their own independently verified migration plan. The v1 key is not
   rotated by this plugin-only procedure.

Rollback after v2 writes requires a **v2-compatible Host** and every key
used in the snapshot. Never use an old image that only understands v1, or
restore a previous keyring without checking the ciphertext corpus. There is
no automated reverse migration to v1. Failed decryptions, malformed keyring,
wrong tenant AAD, missing key, CAS conflict, or scan limit breach abort with
a nonzero exit; retain all old keys and maintenance mode, then investigate
before retrying. Passing CI tests alone is not production DR acceptance.

## Failure and rollback

- Missing signing key/signature, unknown operator key fingerprint, unsigned lockfile, malformed JSON evidence, missing/failed security review, changed artifact, missing/mismatched plan or wrong expected SHA causes the checker to exit nonzero without executing plugin code or DB mutations.
- A rollback requires restoring the matching full signed operator release directory to **all** replicas and examining any already-applied DB migrations; do not assume migration rollback is reversible.
- A long-running cluster cannot be made atomic by a digest comparison alone. Automatic staged distribution, fleet-wide barriers, coordinated traffic draining and recovery are separate P0-4/P1 deliverables.

## Explicitly not included

No remote download or ZIP parser, no dependency-scanner engine, no automatic private key generation, no registry publishing, no direct browser installation, no out-of-band server executor, no automatic migration application, no sandbox for malicious Node ESM, and no automated deployment scheduler. These steps must not be claimed as implemented by the verifier.
