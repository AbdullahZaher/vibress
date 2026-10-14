# Vibress Theme Storage: Architecture, Concurrency & Generation Retention

## 1. Overview

Vibress supports cloud object storage (AWS S3, Cloudflare R2, Google Cloud Storage, MinIO) for theme packages via `StorageProviderThemeStorageAdapter`.

Theme packages contain template code (`.liquid`, `.html`), stylesheets (`.css`), configuration (`theme.json`), scripts, and static media assets. Because theme packages are actively read during website request rendering, storage operations must ensure strict atomicity, tenant isolation, and read consistency without introducing unbounded storage growth.

---

## 2. Directory Layout & Generation Isolation

Theme packages are isolated by publication and version, and stored within immutable generation directories:

```
themes/
  publications/
    {publicationId}/
      {themeId}/
        {version}/
          __files.json                                     <-- Authoritative manifest
          generations/
            gen_1728923450000_a1b2c3d4/                    <-- Current active generation (Gn)
              theme.json
              assets/style.css
              templates/index.liquid
            gen_1728921100000_e5f6g7h8/                    <-- Deferred previous generation (Gn-1)
              theme.json
              assets/style.css
              templates/index.liquid
```

Legacy flat packages (from v1 or default publication installations) are stored at:
```
themes/{themeId}/{version}/
  __files.json
  generations/{generationId}/... (v2 layout)
  theme.json                     (v1 layout)
```

---

## 3. The N-1 Bounded Generation Retention Contract

### The Guarantee
Vibress enforces an **N-1 Bounded Generation Retention** contract for cloud theme storage:
1. **Authoritative Active Generation ($G_n$)**: Always preserved in storage and referenced by `manifest.generation`.
2. **Immediate Previous Generation ($G_{n-1}$)**: Explicitly retained in storage and referenced by `manifest.previousGeneration`.
3. **Generations Older than $G_{n-1}$ ($G_{\le n-2}$)**: Pruned during package replacement once $G_n$ is confirmed authoritative.

### Why N-1 Retention?
- **Read Isolation**: An in-flight reader that resolves a theme snapshot immediately before an administrative update is pinned to $G_{n-1}$. Because $G_{n-1}$ is retained in storage, the in-flight read completes without 404 errors or torn templates.
- **Bounded Storage Footprint**: Object storage usage is strictly capped at $O(2 \times \text{package\_size})$ per theme version, eliminating orphaned file accumulation in S3 buckets without requiring separate background GC cron jobs.
- **Real-World CMS Dynamics**: Theme deployments are discrete administrative events (minutes, hours, or days apart), whereas HTTP render requests complete within 50ms–250ms. An in-flight reader will practically never span across two consecutive manual replacements.

### Consumer Guidance for Long-Running Operations
For long-running processes (e.g. static site exports, multi-minute batch renders) or automated deployment loops with rapid successive replacements:
- Pinned file reads should handle 404s by refreshing the manifest snapshot (`getThemeFilesMap` or `readIndexManifest`).
- Production edge deployments should front static theme assets with a CDN or reverse-proxy cache.

---

## 4. Concurrency & Protection Invariants

### Atomicity & Last-Writer-Wins
When two administrative writers deploy concurrently:
1. Both writers upload their assets into distinct, globally unique generation directories (`gen_<timestamp>_<hex>`).
2. Assets never interleave, even if both writers deploy different versions of the same file.
3. The writer that successfully commits `__files.json` becomes authoritative.

### Superseded Generation Protection
If Writer A publishes $G_1$, and concurrent Writer B immediately reads $G_1$ and commits $G_2$ with `previousGeneration = G_1`:
- Writer A's post-activation check observes that $G_2$ is active and $G_1$ is recorded as `previousGeneration`.
- Writer A **does not delete** its staged files, because $G_1$ is actively referenced and retained for in-flight readers.
- Superseded writes are never synchronously deleted if referenced by the active manifest.

### Ambiguous Write Recovery (Data Preservation)
If writing `__files.json` fails due to a network timeout or TCP socket reset:
- The adapter performs a recovery read of `__files.json`.
- If the recovery read confirms the generation was committed, the operation succeeds.
- If the recovery read is indeterminate or fails due to network partition, the adapter **never deletes staged files**.
- Staged files are only cleaned up when an unambiguous read proves the generation was completely unreferenced.

### Snapshot Pinning in `getThemeFilesMap`
- `getThemeFilesMap` resolves the manifest once at the start of the read operation and pins `manifest.generation` and `manifest.root`.
- Every file in the package is loaded using the pinned generation snapshot, eliminating torn reads across concurrent replacements.
- Authorized legacy-root v2 packages resolve files using `manifest.root` directly, ensuring non-default publications correctly access fallback packages.

---

## 5. Security & SSRF Hardening

1. **Path Validation**: Theme IDs, versions, and publication IDs are strictly validated (`^[a-z0-9_-]+$`) to prevent S3 prefix escaping and filesystem directory traversal.
2. **Relative Path Containment**: Relative file paths are normalized and forbidden from using `..`, absolute paths, leading slashes, Windows drive letters, or reserved metadata files (`__files.json`).
3. **Connection-Time SSRF Defense**:
   - Native `getObjectBuffer` byte reads are prioritized over signed URLs.
   - For signed URLs, destinations are verified against configured endpoint origins (`STORAGE_S3_ENDPOINT`, `MINIO_ENDPOINT`, or known cloud domains).
   - Connection-time DNS validation resolves IP addresses in Node's socket connection hook, blocking DNS rebinding (`TTL=0`) to private RFC 1918, link-local, carrier-grade NAT, or cloud metadata (`169.254.169.254`) ranges before TCP connection.
   - HTTP redirects are disabled (`redirect: "error"`).
