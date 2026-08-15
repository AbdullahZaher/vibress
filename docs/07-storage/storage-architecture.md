# Storage Core Architecture (Updated Batch 4)

## StorageProvider Interface

```ts
interface StorageProvider {
  readonly name: string;
  getCapabilities(): StorageCapabilities;
  put(input: PutObjectInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): Promise<string>;
  getSignedUrl?(key: string, options?: SignedUrlOptions): Promise<string>;
}
```

## StorageCapabilities

```ts
interface StorageCapabilities {
  signedUrls: boolean;
  directUpload: boolean;
  multipartUpload: boolean;
  privateObjects: boolean;
  publicObjects: boolean;
}
```

## StorageRegistry

Central provider registration and resolution:

```ts
class StorageRegistry {
  register(provider: StorageProvider): void;
  setActiveProvider(name: string): void;
  getActiveProvider(): StorageProvider;
  getProvider(name: string): StorageProvider;
}
```

## LocalStorageProvider (Batch 4)

Implements `StorageProvider` for local filesystem storage.

### Configuration

- Root directory: `content/media/` (configurable via `storageRoot`)
- Temp directory: `content/temp/` (atomic writes)
- Base URL: `/content/media` (configurable)

### Capabilities

```text
signedUrls: false
directUpload: false
multipartUpload: false
privateObjects: false
publicObjects: true
```

### Path Safety

Storage keys are validated for:

- Non-empty strings
- No null bytes
- No path traversal (`..`, `.`)
- No absolute paths
- Resolved path must be within `storageRoot`

### Atomic Writes

Files are written to a temp file first, then atomically renamed to the target path. On failure, temp files are cleaned up.

### Public URL

Public URL is resolved from baseUrl + key. Never expose filesystem paths.

## Active Provider Configuration

Default: `local`

For Batch 5, the active provider can be changed to an S3-compatible provider via configuration.

## Batch 5 Extension

S3-compatible providers (AWS S3, Cloudflare R2, etc.) will implement the same `StorageProvider` interface. The Media domain will not require changes.

## Backup Note

For local-provider deployments, `content/media/` must be backed up alongside PostgreSQL. Backing up DB without media content is an incomplete site backup.
