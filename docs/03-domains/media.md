# Media Domain

## Overview

The Media domain manages upload, validation, storage, retrieval, metadata, and safe deletion of media assets. It is storage-provider-neutral — all storage operations go through `StorageCore`.

## MediaAsset Entity

| Field | Type | Description |
|---|---|---|
| id | string (UUID) | Primary identity |
| storageProvider | string | Provider name (e.g. `local`) |
| storageKey | string (unique) | Opaque object key in storage backend |
| originalFilename | string | Sanitized original filename (display only) |
| displayName | string | User-editable display name |
| mimeType | string | Detected MIME type (magic bytes) |
| extension | string | File extension (lowercased) |
| sizeBytes | number | File size in bytes |
| checksum | string | SHA-256 hash of the uploaded content |
| assetType | `image` \| `video` \| `audio` \| `file` | Broad media category |
| width | number? | Image/video width in pixels |
| height | number? | Image/video height in pixels |
| durationMs | number? | Audio/video duration |
| metadata | jsonb? | Arbitrary metadata payload |
| uploadedBy | string? (FK → users) | Staff user who uploaded |
| createdAt | timestamp | Creation time |
| updatedAt | timestamp | Last modification |
| deletedAt | timestamp? | Soft-delete timestamp |

## Asset Types

- `image` — JPEG, PNG, WebP, GIF
- `video` — MP4, WebM (no transcoding)
- `audio` — MPEG, MP4, OGG, WAV (no transcoding)
- `file` — Generic/safe file downloads

## Key Design Decisions

### Storage Key != URL
`storageKey` is an opaque identifier like `media/<uuid>/<original-filename>`. The public URL is computed at render time via `StorageProvider.getUrl()`. This allows future CDN/provider migrations without changing database records.

### assetId is the Stable Identity
`assetId` (UUID) is the canonical media reference. URL is derived/fallback data. Cards store both `assetId` and `src` for backwards compatibility.

### Local Asset Immutability
Uploaded byte content is immutable. Replacing a file creates a new asset with a new ID. Display name/metadata edits don't change the underlying stored object.

### Soft Delete
Deletion sets `deletedAt`. Normal queries exclude deleted assets. Physical purge is future work.

### Original Filename Handling
Original filenames are sanitized (null bytes, control chars, path separators removed). Filenames are metadata, never used as storage paths.

## Reference Model

Media references are explicitly tracked in `media_references`:

```
media_references
├── media_id → media_assets.id
├── resource_type ('post' | 'page')
├── resource_id
└── field_path
```

### Reference Lifecycle
- Created on content save via `extractMediaReferencesFromDocument()`
- Replaced transactionally when content is updated
- Removed when cards are removed from content
- Used to protect referenced assets from deletion (409 MEDIA_IN_USE)

### Revision Safety
Historical revisions may reference assets no longer in the current document version. These references keep assets safe from physical deletion. Restoring a revision is safe because referenced media assets are protected.

## Delete Protection
Delete attempts on referenced assets return `409 MEDIA_IN_USE` with a `referenceCount`. There is no force-delete API in Batch 4.

## Permissions
- `media.read` — View media library/list assets
- `media.upload` — Upload new assets
- `media.edit` — Edit metadata (display name)
- `media.delete` — Soft-delete unreferenced assets
