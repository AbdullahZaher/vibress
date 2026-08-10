# S3-Compatible Storage Architecture & Integration

## Single Adapter, Multiple Providers

Vibress uses a single generic S3-compatible storage adapter (`@vibress/storage-s3`) backed by provider presets:

Official presets:

- **AWS S3**: Standard AWS virtual-host or path-style object storage
- **Cloudflare R2**: Zero-egress fee S3-compatible storage requiring custom account endpoint
- **DigitalOcean Spaces**: S3-compatible spaces (e.g. `https://nyc3.digitaloceanspaces.com`)
- **Wasabi**: Low-cost hot cloud storage (e.g. `https://s3.wasabisys.com`)
- **Backblaze B2 S3**: Low-cost S3 API (e.g. `https://s3.us-west-004.backblazeb2.com`)
- **Hetzner Object Storage**: European S3-compatible storage (e.g. `https://hel1.your-objectstorage.com`)
- **MinIO**: High-performance self-hosted / local S3 object storage
- **Custom S3**: Any standard S3-compatible endpoint

## Plugin Location

```text
vibress-plugins/storage/s3/
├── src/
│   ├── types.ts
│   ├── presets.ts
│   ├── s3-storage-provider.ts
│   ├── index.ts
│   └── __tests__/
│       ├── s3-presets.test.ts
│       └── s3-minio-integration.test.ts
├── package.json
└── tsconfig.json
```

## Security & Credential Encryption

- **Encryption**: Secrets (`accessKeyId`, `secretAccessKey`) are encrypted at rest using **AES-256-GCM** via `@vibress/security`.
- **Master Key**: Requires `VIBRESS_ENCRYPTION_KEY` env var. Fail-closed if missing when loading external S3 configurations.
- **Redaction**: Secrets are never returned by API or logged in audit events (`hasCredentials: true` boolean returned instead).

## Direct Upload Flow

```text
Browser
  │ 1. POST /api/admin/v1/media/uploads/direct/initiate (filename, expectedSize, mime)
  ▼
Vibress API
  │ 2. Create pending upload_sessions row & generate presigned S3 PUT URL
  ▼
Browser ─── 3. Direct HTTP PUT ───→ S3 / MinIO / R2 Bucket
  │
  │ 4. POST /api/admin/v1/media/uploads/direct/complete (uploadSessionId)
  ▼
Vibress API
  │ 5. HEAD check + byte range signature detection (magic bytes validation)
  ▼
Media Asset Record Finalized
```

## Multipart Upload Flow (Large Files)

```text
Browser ─── 1. POST /media/uploads/multipart/initiate ───→ Vibress API
Browser ─── 2. POST /media/uploads/multipart/part-url ───→ Signed Part PUT URLs
Browser ─── 3. Upload Parts 5MB+ ───→ S3 Bucket
Browser ─── 4. POST /media/uploads/multipart/complete ───→ Vibress API
Vibress API ─── 5. Complete S3 Multipart + Verify ───→ Media Asset Finalized
```

## Provider Switching & Historical Asset Resolution

- Switching active provider does **not** perform byte migration.
- `media_assets.storage_provider` records the specific provider that owns the asset.
- Read and delete operations dynamically resolve `asset.storageProvider` from `StorageRegistry`.
- Mixed-provider deletions correctly route to their respective storage provider instance.

## Bucket CORS Configuration (Direct Upload)

Direct browser-to-bucket uploads require CORS enabled on the target bucket:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://admin.yourdomain.com"],
      "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
      "AllowedHeaders": ["Content-Type", "x-amz-meta-*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

## Backup & Restoration Implications

> **Important**: Backing up PostgreSQL alone is **not** a complete site backup when using Local or self-hosted MinIO storage. External S3 object storage buckets must be included in disaster recovery backup plans alongside database snapshots.
