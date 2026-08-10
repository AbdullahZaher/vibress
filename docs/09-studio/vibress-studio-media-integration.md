# Studio Media Integration (Batch 4)

## Architecture

```
Vibress Studio (independent, no Vibress Core deps)
      │ requestMedia callback
      ▼
Vibress Admin PostEditor / PageEditor
      │
      ▼
MediaPicker Component (reusable modal)
      │
      ▼
Media API (REST)
      │
      ▼
Media Domain + Storage Core
```

## Key Principles

### Studio Remains Core-Independent
Studio imports no Vibress packages (`@vibress/database`, `@vibress/media`, `@vibress/storage-core`, `@vibress/domains/*`). Communication flows through generic callbacks.

### MediaPicker Belongs to Vibress Admin
The MediaPicker component lives in `apps/admin/src/components/MediaPicker.tsx`. It uses the Media API via `listMediaApi` and `uploadMediaApi`.

### Host Adapter via requestMedia
The `VibressStudio` component accepts `requestMedia` prop:

```ts
requestMedia?: (req: { cardType: string }) => Promise<Record<string, unknown> | null>
```

When a media card (image, video, audio, file, gallery) is inserted, Vibress Admin's PostEditor/PageEditor opens the MediaPicker, resolves the selection, and returns card data.

### assetId is Stable Identity
All media card schemas (Image, Video, Audio, File) support optional `assetId`:

```ts
export const ImageCardSchema = z.object({
    assetId: z.string().optional(),  // <-- Added in Batch 4
    src: z.string(),
    alt: z.string().default(''),
    ...
});
```

Gallery card images also support `assetId` per image.

### URL-Only Backward Compatibility
Cards without `assetId` (URL-only from Batch 3) continue to load, render, and save without errors. `assetId` is optional.

### Media Reference Extraction
On content save, `extractMediaReferencesFromDocument()` walks the Studio document tree and extracts all `assetId` values, creating `media_references` rows.

## Gallery Integration

Gallery card uses multi-select mode in MediaPicker:
1. User clicks "Insert Card" → "Gallery"
2. MediaPicker opens in multi-select image mode
3. User clicks multiple images
4. "Select N Asset(s)" button confirms
5. Gallery card created with `{ images: [{ assetId, src, alt }, ...] }`

## Card Data Flow

```
Image insertion:
  MediaPicker → { assetId, src, url, alt, width, height } → StudioCardNode

Video insertion:
  MediaPicker → { assetId, src, caption } → StudioCardNode

Audio insertion:
  MediaPicker → { assetId, src, title } → StudioCardNode

File insertion:
  MediaPicker → { assetId, src, fileName, fileSize } → StudioCardNode

Gallery insertion:
  MediaPicker (multi) → { images: [{ assetId, src, alt }] } → StudioCardNode
```
