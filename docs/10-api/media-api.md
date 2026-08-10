# Media API (Updated Batch 4)

Base path: `/api/admin/v1`

## Endpoints

### Upload Media
```
POST /media
Content-Type: multipart/form-data
```
Accepts a single file per request. Returns `201` with asset metadata + public URL.

### List Media
```
GET /media?limit=20&offset=0&assetType=image&search=...
```
Paginated, filterable list. Supports: `assetType`, `mimeType`, `uploadedBy`, `search` (display name), `sortBy`, `sortOrder`.

### Get Media
```
GET /media/:id
```
Returns single asset with URL.

### Update Media Metadata
```
PATCH /media/:id
Content-Type: application/json
{ "displayName": "New Name" }
```
Updates display name and/or metadata. Does not modify stored bytes.

### Delete Media
```
DELETE /media/:id
```
Soft-deletes unreferenced assets. Returns `409 MEDIA_IN_USE` if asset has active content references.

### Get Media References
```
GET /media/:id/references
```
Returns reference summary: count + list of `{ resourceType, resourceId, fieldPath }`.

## Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| MEDIA_TOO_LARGE | 413 | File exceeds per-type size limit |
| MEDIA_TYPE_NOT_ALLOWED | 422 | File extension/MIME is blocked |
| MEDIA_MIME_MISMATCH | 422 | Declared MIME doesn't match detected signature |
| MEDIA_INVALID_FILE | 422 | File content is invalid (e.g. zero-byte image) |
| MEDIA_NOT_FOUND | 404 | Asset ID not found |
| MEDIA_IN_USE | 409 | Asset has active references; cannot delete |
| MEDIA_STORAGE_ERROR | 500 | Storage backend operation failed |
| MEDIA_UPLOAD_FAILED | 400 | Upload processing failed |
